"""Bounded NAS workflow handoff; missing NAS output never blocks other packs."""
import argparse
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

WORKFLOW = 'nas-universities.yml'
ARTIFACT = 'nas-universities-b'
MAX_ARCHIVE = 100 * 1024 * 1024
MAX_STATE = 250 * 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class GitHub:
    def __init__(self, repository, token):
        if not re.fullmatch(r'[\w.-]+/[\w.-]+', repository):
            raise ValueError('Invalid repository')
        self.base = 'https://api.github.com/repos/' + repository
        self.token = token

    def request(self, path, method='GET', payload=None):
        request = urllib.request.Request(self.base + path,
            data=json.dumps(payload).encode() if payload is not None else None,
            method=method, headers={'Authorization': 'Bearer ' + self.token,
                'Accept': 'application/vnd.github+json', 'User-Agent': 'JobRadar-NAS',
                'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28'})
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=20) as response:
            data = response.read(MAX_ARCHIVE + 1)
        if len(data) > MAX_ARCHIVE:
            raise ValueError('GitHub response too large')
        return json.loads(data) if data else {}

    def download(self, artifact_id):
        try:
            self.request(f'/actions/artifacts/{int(artifact_id)}/zip')
        except urllib.error.HTTPError as error:
            if error.code != 302:
                raise
            location = error.headers.get('Location', '')
            error.close()
            if urllib.parse.urlsplit(location).scheme != 'https':
                raise ValueError('Invalid artifact redirect')
            # Signed storage URL gets NO GitHub token.
            with urllib.request.urlopen(location, timeout=30) as response:
                data = response.read(MAX_ARCHIVE + 1)
            if len(data) > MAX_ARCHIVE:
                raise ValueError('NAS archive too large')
            return data
        raise ValueError('Missing artifact redirect')


def unpack_state(data, output):
    files = {}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        for entry in archive.infolist():
            path = PurePosixPath(entry.filename)
            if path.is_absolute() or '..' in path.parts or '\\' in entry.filename:
                raise ValueError('Unsafe NAS artifact path')
            if entry.is_dir():
                continue
            if entry.filename not in {'state.json', 'ci-report.json', 'data/state.json', 'data/ci-report.json'}:
                raise ValueError('Unexpected NAS artifact member')
            if entry.file_size > MAX_STATE or path.name in files:
                raise ValueError('Oversized or duplicate NAS artifact')
            files[path.name] = archive.read(entry)
    state = json.loads(files['state.json'])
    if state.get('delta_version') != 1 or state.get('source_pack') != 'universities-b':
        raise ValueError('NAS artifact is not a universities-b delta')
    # Existing merge_shards checks exact baseline generation and source ownership.
    output.mkdir(parents=True, exist_ok=True)
    for name, content in files.items():
        temporary = output / (name + '.tmp')
        temporary.write_bytes(content)
        temporary.replace(output / name)


def handoff(api, ref, sha, parent_id, attempt, queue_seconds=90, run_seconds=1100,
            now=time.monotonic, sleep=time.sleep):
    request_id = f'{parent_id}-{attempt}'
    title = f'NAS universities-b {request_id}'
    workflow_path = f'/actions/workflows/{WORKFLOW}'
    started = now()
    child_id = None
    active_at = None
    complete = False
    try:
        api.request(workflow_path + '/dispatches', 'POST', {'ref': ref, 'inputs': {
            'request_id': request_id, 'parent_run_id': str(parent_id),
            'parent_attempt': str(attempt), 'source_sha': sha,
            'expires_at': str(int(time.time() + queue_seconds + run_seconds))}})
        while True:
            if child_id is None:
                runs = api.request(workflow_path + '/runs?event=workflow_dispatch&per_page=100')['workflow_runs']
                matches = [r for r in runs if r.get('display_title') == title and r.get('head_branch') == ref]
                if len(matches) > 1:
                    raise ValueError('Ambiguous NAS run; no result accepted')
                if matches:
                    child_id = matches[0]['id']
            if child_id is not None:
                run = api.request(f'/actions/runs/{child_id}')
                if run['status'] == 'completed':
                    complete = True
                    artifacts = api.request(f'/actions/runs/{child_id}/artifacts')['artifacts']
                    matches = [a for a in artifacts if a['name'] == ARTIFACT and not a.get('expired')]
                    if len(matches) == 1:
                        return api.download(matches[0]['id'])
                    return None
                if active_at is None:
                    # A workflow may say in_progress while its self-hosted job
                    # still waits for an offline runner. Inspect the job itself.
                    jobs = api.request(f'/actions/runs/{child_id}/jobs')['jobs']
                    if any(j.get('status') == 'in_progress' and j.get('runner_name') for j in jobs):
                        active_at = now()
            if active_at is None and now() - started >= queue_seconds:
                return None
            if now() - started >= queue_seconds + run_seconds or (active_at is not None and now() - active_at >= run_seconds):
                return None
            sleep(10)
    finally:
        if child_id is not None and not complete:
            try:
                api.request(f'/actions/runs/{child_id}/cancel', 'POST')
            except (OSError, ValueError):
                print('::warning::NAS 子任务取消未确认；过期校验和任务超时仍生效。')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('data'))
    args = parser.parse_args()
    if (args.output / 'state.json').exists():
        raise ValueError('NAS handoff output must not contain a baseline or old state')
    api = GitHub(os.environ['GITHUB_REPOSITORY'], os.environ['GH_TOKEN'])
    try:
        archive = handoff(api, os.environ['GITHUB_REF_NAME'], os.environ['GITHUB_SHA'],
                          os.environ['GITHUB_RUN_ID'], os.environ['GITHUB_RUN_ATTEMPT'])
        if archive is not None:
            unpack_state(archive, args.output)
            print('NAS 高校分片已返回，等待主流程完整性核验。')
            return
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        # Never print exception URLs: a storage redirect can contain a signature.
        print(f'::warning::NAS 分片交接失败（{type(error).__name__}），保留历史数据。')
    print('::warning::NAS 未及时返回可用分片；其他来源继续，高校历史记录保留。')
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a', encoding='utf-8') as file:
            file.write('## NAS 高校采集\n未及时取得 NAS 结果，本轮保留高校历史记录；其他分片继续。\n')


if __name__ == '__main__':
    main()
