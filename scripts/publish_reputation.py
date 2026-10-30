"""Publish validated public data atomically to a dedicated GitHub data branch.

Invoked only by the independent workflow. Never updates the code branch,
deploys the website, or publishes the collector's state/diagnostic files.
"""
import argparse
import base64
import hashlib
import json
import os
import re
import shutil
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from tempfile import TemporaryDirectory
import urllib.error
import urllib.request
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).resolve().parents[1]


class GitHub:
    def __init__(self, repository, token):
        self.base = f'https://api.github.com/repos/{repository}'
        self.token = token

    def request(self, path, method='GET', body=None, missing=False, timeout=20):
        request = urllib.request.Request(self.base + path, method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={'Authorization': 'Bearer ' + self.token, 'Accept': 'application/vnd.github+json',
                     'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28'})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.loads(response.read(12000000))
        except urllib.error.HTTPError as error:
            if missing and error.code == 404:
                return None
            raise RuntimeError(f'GitHub data publication failed (HTTP {error.code})') from None


def prepare_history(directory, seed_directory, delivery, api, budget=40):
    """Recover published evidence even after an Actions state-cache eviction.

    Unread history protects that firm's old publication instead of replacing it
    with a shorter partial list. Fixed GitHub metadata paths, no source crawl.
    """
    if delivery['directory'] != 'public/reputation' or delivery['branch'] in ('main', 'master'):
        raise ValueError('History must use the dedicated public data branch')
    deadline = time.monotonic() + budget
    def read(path, missing=False):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('history_budget_reached')
        return api.request(path, missing=missing, timeout=min(8, remaining))
    ref = read('/git/ref/heads/' + delivery['branch'], missing=True)
    incoming = json.loads((directory / 'index.json').read_text(encoding='utf-8'))
    previous = dict(incoming, entities=[])
    commit = ref['object']['sha'] if ref else None
    if commit:
        value = read(f"/contents/public/reputation/index.json?ref={commit}")
        previous = json.loads(base64.b64decode(value['content']))
    if not isinstance(previous.get('entities'), list) or len(previous['entities']) > 1000:
        raise ValueError('Invalid published history index')
    with TemporaryDirectory(prefix='reputation-history-') as temp:
        target = Path(temp)
        def recover(row):
            file = row['file']
            if not re.fullmatch(r'entity-(?:(?:nowcoder|kanzhun|maimai)-)?[A-Za-z0-9_-]{1,80}-[a-f0-9]{20}\.json', file):
                raise ValueError('Invalid published history filename')
            try:
                local = next((root / file for root in (directory, seed_directory) if (root / file).exists()), None)
                if local:
                    raw = local.read_bytes()
                else:
                    value = read(f'/contents/public/reputation/{file}?ref={commit}')
                    raw = base64.b64decode(value['content'])
                if len(raw) > 2000000 or not file.endswith('-' + hashlib.sha256(raw).hexdigest()[:20] + '.json'):
                    raise ValueError('Published history checksum mismatch')
                (target / file).write_bytes(raw)
                return row, None
            except (RuntimeError, TimeoutError, ValueError, KeyError, OSError):
                return None, row['id']
        with ThreadPoolExecutor(max_workers=4) as pool:
            recovered = list(pool.map(recover, previous['entities']))
        blocked = [identifier for _, identifier in recovered if identifier]
        (target / 'index.json').write_text(json.dumps(dict(previous, entities=[row for row, _ in recovered if row])), encoding='utf-8')
        (target / 'blocked.json').write_text(json.dumps(blocked), encoding='utf-8')
        result = subprocess.run(['node', '--experimental-strip-types', str(ROOT / 'scripts/merge_reputation_history.mjs'),
            str(directory.resolve()), str(target), str(seed_directory.resolve()), str(target / 'blocked.json')],
            capture_output=True, text=True, encoding='utf-8', timeout=20)
        if result.returncode:
            raise ValueError('History merge validation failed; publication stopped: ' + result.stderr[-500:])
        return json.loads(result.stdout)


def merge_index(current, incoming):
    if current is None:
        return incoming
    if current.get('schema_version') not in (1, 2) or current.get('policy_version') != incoming.get('policy_version'):
        raise ValueError('Refuse to combine incompatible reputation policies')
    entities = {row['id']: row for row in current['entities']}
    for row in incoming['entities']:
        old = entities.get(row['id'])
        if not old or datetime.fromisoformat(row['collected_at']) >= datetime.fromisoformat(old['collected_at']):
            entities[row['id']] = row
    return {**incoming, 'schema_version': max(current['schema_version'], incoming['schema_version']), 'entities': list(entities.values())}


def publish(directory, delivery, api, seed_directory=None):
    if delivery['branch'] in ('main', 'master') or not re.fullmatch(r'[A-Za-z0-9_-]+', delivery['branch']) or not re.fullmatch(r'[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+', delivery['repository']):
        raise ValueError('A dedicated data branch is required')
    incoming = json.loads((directory / 'index.json').read_text(encoding='utf-8'))
    if incoming.get('schema_version') not in (1, 2) or not isinstance(incoming.get('entities'), list):
        raise ValueError('Invalid reputation publication')
    root = delivery['directory']
    if root != 'public/reputation':
        raise ValueError('Unexpected data directory')
    if seed_directory and (seed_directory / 'index.json').exists():
        seed = json.loads((seed_directory / 'index.json').read_text(encoding='utf-8'))
        incoming = merge_index(seed, incoming)
    def asset(file):
        local = directory / file
        if local.exists():
            return local
        if seed_directory and (seed_directory / file).exists():
            return seed_directory / file
        raise ValueError('Reputation asset missing')
    for item in incoming['entities']:
        file = item['file']
        if not re.fullmatch(r'entity-(?:(?:nowcoder|kanzhun|maimai)-)?[A-Za-z0-9_-]{1,80}-[a-f0-9]{20}\.json', file):
            raise ValueError('Unexpected reputation filename')
        raw = asset(file).read_bytes()
        if len(raw) > 2000000 or not file.endswith('-' + hashlib.sha256(raw).hexdigest()[:20] + '.json'):
            raise ValueError('Reputation asset checksum mismatch')
    ref = api.request('/git/ref/heads/' + delivery['branch'], missing=True)
    old_commit = ref['object']['sha'] if ref else None
    old_index = None
    tree_sha = None
    old_paths = []
    if old_commit:
        tree_sha = api.request('/git/commits/' + old_commit)['tree']['sha']
        tree = api.request('/git/trees/' + tree_sha + '?recursive=1')
        if tree.get('truncated'):
            raise ValueError('Data branch tree is too large')
        old_paths = [item['path'] for item in tree['tree'] if item['type'] == 'blob']
        old = api.request(f'/contents/{root}/index.json?ref={old_commit}', missing=True)
        if old:
            old_index = json.loads(base64.b64decode(old['content']))
    # A cold/evicted Actions cache or source outage cannot erase previously
    # published firms. Source timestamps and score expiry remain unchanged.
    merged = merge_index(old_index, incoming)
    if not merged['entities']:
        return {'published': False, 'reason': 'no_valid_source_data'}
    keep = {f'{root}/index.json'} | {f"{root}/{row['file']}" for row in merged['entities']}
    if old_index:
        keep |= {f"{root}/{row['file']}" for row in old_index['entities']}
    updates = [{'path': f'{root}/index.json', 'mode': '100644', 'type': 'blob',
                'content': json.dumps(merged, ensure_ascii=False, separators=(',', ':'))}]
    for row in incoming['entities']:
        updates.append({'path': f"{root}/{row['file']}", 'mode': '100644', 'type': 'blob',
                        'content': asset(row['file']).read_text(encoding='utf-8')})
    for path in old_paths:
        if re.fullmatch(r'public/reputation/entity-(?:(?:nowcoder|kanzhun|maimai)-)?[A-Za-z0-9_-]{1,80}-[a-f0-9]{20}\.json', path) and path not in keep:
            updates.append({'path': path, 'mode': '100644', 'type': 'blob', 'sha': None})
    tree = api.request('/git/trees', 'POST', {'tree': updates, **({'base_tree': tree_sha} if tree_sha else {})})
    commit = api.request('/git/commits', 'POST', {'message': 'data: update public employer reputation',
        'tree': tree['sha'], 'parents': [old_commit] if old_commit else []})
    if ref:
        api.request('/git/refs/heads/' + delivery['branch'], 'PATCH', {'sha': commit['sha'], 'force': False})
    else:
        api.request('/git/refs', 'POST', {'ref': 'refs/heads/' + delivery['branch'], 'sha': commit['sha']})
    rows = merged['entities']
    return {'published': True, 'enterprises': len(rows), 'branch': delivery['branch'],
            'with_content': sum(any(row.get(key, 0) for key in ('experience_count', 'interview_count', 'question_count', 'unattributed_count')) for row in rows),
            'experiences': sum(row.get('experience_count', 0) for row in rows),
            'interviews': sum(row.get('interview_count', 0) for row in rows),
            'questions': sum(row.get('question_count', 0) for row in rows),
            'unattributed': sum(row.get('unattributed_count', 0) for row in rows),
            'scored': sum(row.get('score') is not None for row in rows)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--public-dir', required=True)
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    token = os.environ.get('GITHUB_TOKEN')
    if not token:
        parser.error('GITHUB_TOKEN is required only for workflow publication')
    delivery = json.loads((ROOT / 'config/reputation-delivery.json').read_text(encoding='utf-8'))
    api = GitHub(delivery['repository'], token)
    directory = Path(args.public_dir)
    history = prepare_history(directory, ROOT / 'public/reputation', delivery, api)
    result = dict(publish(directory, delivery, api), history=history)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
