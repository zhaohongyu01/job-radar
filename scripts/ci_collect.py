"""Recover the published baseline and validate partial collection before CI deploys."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.request

from collect import ROOT, TZ, atomic_json

ASSET = re.compile(r'^/job-assets/detail-[0-9a-f]{2}-([0-9a-f]{20})\.json$')
HISTORY_FIELDS = {'fingerprint', 'first_seen_at', 'updated_at', 'last_verified_at', 'revision',
                  'duplicate_ids', 'duplicate_sources', 'search_text', 'details_available'}


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def download_json(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'JobRadar-CI/1.0', 'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read(25_000_001)
    if len(raw) > 25_000_000:
        raise ValueError('Published asset exceeds size limit')
    return raw


def snapshot_state(snapshot, load_asset):
    """Recreate every record, including reposts, without inventing a newer read time."""
    if snapshot.get('schema_version') != 2 or not snapshot.get('jobs') or not snapshot.get('detail_shards'):
        raise ValueError('Published snapshot is empty or unsupported')
    shards = snapshot['detail_shards']
    sources = {source['id']: source for source in snapshot['sources']}
    source_ids = {source['name']: source['id'] for source in snapshot['sources']}
    paths = set(shards.values())
    if any(not isinstance(path, str) or not ASSET.fullmatch(path) for path in paths):
        raise ValueError('Invalid detail asset path')
    with ThreadPoolExecutor(max_workers=4) as pool:
        payloads = dict(zip(paths, pool.map(load_asset, paths)))
    jobs = {}
    for summary in snapshot['jobs']:
        identifier = summary['id']
        full = payloads[shards[identifier[:2]]]['jobs'][identifier]
        if full.get('id') != identifier or not isinstance(full.get('body'), str):
            raise ValueError('Incomplete published detail')
        copies = full.get('duplicate_sources', [])
        copy_ids = full.get('duplicate_ids', [])
        if len(copies) != len(copy_ids):
            raise ValueError('Repost identities do not match their sources')
        rows = [full]
        for copy_id, source in zip(copy_ids, copies):
            rows.append(dict(full, id=copy_id, source_url=source['url'], source_name=source['title'],
                             source_id=source_ids.get(source['title'], full['source_id']),
                             application_url=source.get('application_url') or full.get('application_url')))
        for item in rows:
            row = {k: v for k, v in item.items() if k not in {'duplicate_ids', 'duplicate_sources'}}
            if row['id'] in jobs:
                raise ValueError('Published identities overlap')
            facts = {k: v for k, v in row.items() if k not in HISTORY_FIELDS}
            row['fingerprint'] = hashlib.sha256(json.dumps(facts, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
            jobs[row['id']] = row
    if len(jobs) != snapshot.get('raw_records'):
        raise ValueError('Published baseline record count is incomplete')
    return {'jobs': jobs, 'sources': sources, 'last_run_at': snapshot['generated_at']}


def combine_states(*states):
    result = {'jobs': {}, 'sources': {}, 'last_run_at': ''}
    for state in states:
        if not isinstance(state.get('jobs'), dict) or not isinstance(state.get('sources'), dict):
            raise ValueError('Invalid collector state')
        for identifier, job in state['jobs'].items():
            if job.get('id') != identifier or not job.get('fingerprint'):
                raise ValueError('Invalid retained job identity')
            old = result['jobs'].get(identifier)
            if not old or job['last_verified_at'] > old['last_verified_at']:
                result['jobs'][identifier] = job
        for identifier, source in state['sources'].items():
            old = result['sources'].get(identifier)
            if not old or source.get('last_attempt_at', '') > old.get('last_attempt_at', ''):
                result['sources'][identifier] = source
        result['last_run_at'] = max(result['last_run_at'], state['last_run_at'])
    return result


def prepare(public_dir, data_dir, site):
    local_snapshot = read_json(public_dir / 'jobs.json')
    def local_asset(path):
        if not ASSET.fullmatch(path):
            raise ValueError('Invalid local detail path')
        return read_json(public_dir / path.lstrip('/'))
    states = [snapshot_state(local_snapshot, local_asset)]
    state_path = data_dir / 'state.json'
    if state_path.exists():
        states.append(read_json(state_path))
    # A cache can be evicted: compare against the live site as well as the git snapshot.
    if site:
        if not re.fullmatch(r'https://[a-zA-Z0-9.-]+', site):
            raise ValueError('Site must be a plain HTTPS origin')
        live = json.loads(download_json(site + '/jobs.json'))
        def remote_asset(path):
            match = ASSET.fullmatch(path)
            if not match:
                raise ValueError('Invalid remote detail path')
            cached = public_dir / path.lstrip('/')
            raw = cached.read_bytes() if cached.exists() else download_json(site + path)
            if hashlib.sha256(raw).hexdigest()[:20] != match[1]:
                raise ValueError('Detail content hash mismatch')
            return json.loads(raw)
        states.append(snapshot_state(live, remote_asset))
    state = combine_states(*states)
    atomic_json(state_path, state)
    atomic_json(data_dir / 'ci-baseline.json', {'ids': sorted(state['jobs']), 'generated_at': state['last_run_at']})
    print(f"Restored {len(state['jobs'])} retained records from git, cache and published baseline", flush=True)


def validate_result(code, state, snapshot, baseline_ids, started):
    if code not in {0, 2}:
        raise ValueError(f'Collector crashed (exit {code}); deployment blocked')
    if not state.get('jobs') or not snapshot.get('jobs'):
        raise ValueError('Empty collection; deployment blocked')
    if dt.datetime.fromisoformat(state['last_run_at']) < started or snapshot['generated_at'] != state['last_run_at']:
        raise ValueError('Collector did not finish generating a fresh snapshot')
    published = {identifier for job in snapshot['jobs'] for identifier in [job['id'], *job.get('duplicate_ids', [])]}
    if not set(baseline_ids).issubset(state['jobs']) or published != set(state['jobs']):
        raise ValueError('Historical records are missing; deployment blocked')
    attempted = [s for s in state['sources'].values()
                 if dt.datetime.fromisoformat(s['last_attempt_at']) >= started]
    usable = [s for s in attempted if s.get('parsed', 0) or s.get('cached', 0) or s.get('status') == 'ok']
    if not usable:
        raise ValueError('No source produced a usable verification; deployment blocked')
    return attempted


def write_report(data_dir, code, state, error=''):
    sources = list(state.get('sources', {}).values())
    report = {'collector_exit_code': code, 'records': len(state.get('jobs', {})),
              'deployment_blocked': bool(error), 'error': error, 'sources': sources}
    atomic_json(data_dir / 'ci-report.json', report)
    lines = ['## 招聘数据采集', f"保留记录：{report['records']}；采集器退出码：{code}。",
             '允许构建发布；部分来源问题见下表。' if not error else '阻止发布：' + error,
             '', '| 来源 | 状态 | 列表页 | 解析 | 缓存复用 | 问题数 |', '|---|---|---:|---:|---:|---:|']
    for source in sources:
        name = source['name'].replace('|', ' ')
        lines.append(f"| {name} | {source['status']} | {source.get('pages', 0)} | {source.get('parsed', 0)} | {source.get('cached', 0)} | {len(source.get('errors', []))} |")
    for source in sources:
        if source.get('errors'):
            lines.extend(['', f"### {source['name']}", source.get('coverage', '')])
            for issue in source['errors'][:3]:
                lines.append('- ' + issue['reason'].replace('\n', ' '))
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a', encoding='utf-8') as handle:
            handle.write('\n'.join(lines) + '\n')
    if code == 2 and not error:
        print('::warning::部分来源覆盖不完整；已保留历史记录，通过完整性检查后继续发布。', flush=True)


def collect(args):
    started = dt.datetime.now(TZ).replace(microsecond=0)
    baseline = read_json(args.data_dir / 'ci-baseline.json')
    command = [sys.executable, '-u', str(ROOT / 'scripts/collect.py'), '--data-dir', str(args.data_dir),
               '--public-dir', str(args.public_dir), '--pages', str(args.pages), '--days', str(args.days),
               '--offerjack-pages', '1', '--refresh-hours', str(args.refresh_hours)]
    code = subprocess.run(command, check=False).returncode
    state = read_json(args.data_dir / 'state.json')
    try:
        snapshot = read_json(args.public_dir / 'jobs.json')
        validate_result(code, state, snapshot, baseline['ids'], started)
        # Validate every referenced detail and repost before uploading a deployment.
        snapshot_state(snapshot, lambda path: read_json(args.public_dir / path.lstrip('/')))
        search_path = snapshot.get('search_url', '')
        if not re.fullmatch(r'/job-assets/search-[0-9a-f]{20}\.json', search_path):
            raise ValueError('Invalid full-text search asset')
        search = read_json(args.public_dir / search_path.lstrip('/'))['jobs']
        if set(search) != {job['id'] for job in snapshot['jobs']} or any(not isinstance(body, str) for body in search.values()):
            raise ValueError('Full-text search index is incomplete')
    except (ValueError, KeyError, OSError) as error:
        write_report(args.data_dir, code, state, str(error))
        raise
    write_report(args.data_dir, code, state)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['prepare', 'collect'])
    parser.add_argument('--public-dir', type=Path, default=ROOT / 'public')
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'data')
    parser.add_argument('--site', default='')
    parser.add_argument('--pages', type=int, default=5)
    parser.add_argument('--days', type=int, default=14)
    parser.add_argument('--refresh-hours', type=int, default=72,
                        help='reuse recently verified detail pages for this many hours')
    args = parser.parse_args()
    try:
        if args.operation == 'prepare':
            prepare(args.public_dir, args.data_dir, args.site)
        else:
            collect(args)
    except (ValueError, KeyError, OSError) as error:
        message = str(error).replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
        print(f'::error::{message}', file=sys.stderr)
        raise SystemExit(1)
