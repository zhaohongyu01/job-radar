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
        self.operation = '初始化'

    def request(self, path, method='GET', payload=None, retries=2):
        self.operation = f'{method} {path.split("?")[0]}'
        request = urllib.request.Request(self.base + path,
            data=json.dumps(payload).encode() if payload is not None else None,
            method=method, headers={'Authorization': 'Bearer ' + self.token,
                'Accept': 'application/vnd.github+json', 'User-Agent': 'JobRadar-NAS',
                'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28'})
        for attempt in range(retries + 1):
            try:
                with urllib.request.build_opener(NoRedirect()).open(request, timeout=20) as response:
                    data = response.read(MAX_ARCHIVE + 1)
                if len(data) > MAX_ARCHIVE:
                    raise ValueError('GitHub response too large')
                return json.loads(data) if data else {}
            except urllib.error.HTTPError as error:
                if error.code < 500 or attempt >= retries:
                    raise
                time.sleep(2 ** attempt)
            except (urllib.error.URLError, TimeoutError, OSError) as error:
                if attempt >= retries:
                    raise
                time.sleep(2 ** attempt)

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
            self.operation = '下载 NAS 结果文件'
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


def handoff(api, ref, sha, parent_id, attempt, queue_seconds=90, run_seconds=2100,
            now=time.monotonic, sleep=time.sleep, diagnostic=None):
    diagnostic = diagnostic if diagnostic is not None else {}
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
                    diagnostic['child_id'] = child_id
                    print(f'NAS 子任务已创建：run {child_id}')
            if child_id is not None:
                run = api.request(f'/actions/runs/{child_id}')
                if run['status'] == 'completed':
                    complete = True
                    artifacts = api.request(f'/actions/runs/{child_id}/artifacts')['artifacts']
                    matches = [a for a in artifacts if a['name'] == ARTIFACT and not a.get('expired')]
                    if len(matches) == 1:
                        return api.download(matches[0]['id'])
                    diagnostic['reason'] = 'NAS 子任务已结束，但没有唯一的有效采集产物；请检查子任务日志。'
                    return None
                if active_at is None:
                    # A workflow may say in_progress while its self-hosted job
                    # still waits for an offline runner. Inspect the job itself.
                    jobs = api.request(f'/actions/runs/{child_id}/jobs')['jobs']
                    if any(j.get('status') == 'in_progress' and j.get('runner_name') for j in jobs):
                        active_at = now()
            if active_at is None and now() - started >= queue_seconds:
                diagnostic['reason'] = ('等待 NAS 接单超时；请检查 Runner 是否在线及标签是否匹配。'
                                        if child_id else '派发请求已接受，但未找到对应子任务。')
                return None
            if now() - started >= queue_seconds + run_seconds or (active_at is not None and now() - active_at >= run_seconds):
                diagnostic['reason'] = 'NAS 已接单，但执行超过等待期限；请检查子任务日志。'
                return None
            sleep(10)
    except urllib.error.HTTPError as error:
        error.nas_operation = getattr(api, 'operation', 'GitHub API')
        raise
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
    diagnostic = {}
    try:
        archive = handoff(api, os.environ['GITHUB_REF_NAME'], os.environ['GITHUB_SHA'],
                          os.environ['GITHUB_RUN_ID'], os.environ['GITHUB_RUN_ATTEMPT'], diagnostic=diagnostic)
        if archive is not None:
            unpack_state(archive, args.output)
            print('NAS 高校分片已返回，等待主流程完整性核验。')
            return
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        # Never print exception URLs: a storage redirect can contain a signature.
        if isinstance(error, urllib.error.HTTPError):
            operation = getattr(error, 'nas_operation', api.operation)
            diagnostic['reason'] = f'NAS 交接接口失败：{operation}，HTTP {error.code}。'
            if error.code in (404, 422):
                diagnostic['reason'] += ' 请检查 nas-universities.yml 是否有效并已推送到默认分支。'
            elif error.code in (401, 403):
                diagnostic['reason'] += ' 请检查工作流令牌权限与仓库 Actions 策略。'
        else:
            diagnostic['reason'] = f'NAS 交接失败（{type(error).__name__}）；请检查连接及子任务产物。'
    reason = diagnostic.get('reason', 'NAS 未返回可用分片。')
    print(f'::warning::{reason} 本轮保留高校历史记录；其他分片继续。')
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a', encoding='utf-8') as file:
            file.write(f'## NAS 高校采集\n{reason}\n\n本轮保留高校历史记录；其他分片继续。\n')
            if diagnostic.get('child_id'):
                file.write(f"\n[查看 NAS 子任务](https://github.com/{os.environ['GITHUB_REPOSITORY']}/actions/runs/{diagnostic['child_id']})\n")


if __name__ == '__main__':
    main()
