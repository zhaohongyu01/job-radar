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

from collect import ROOT, TZ, SOURCE_PACKS, atomic_json, export_snapshot, source_pack_ids

ASSET = re.compile(r'^/job-assets/detail-[0-9a-f]{2}-([0-9a-f]{20})\.json$')
HISTORY_FIELDS = {'fingerprint', 'first_seen_at', 'updated_at', 'last_verified_at', 'revision',
                  'duplicate_ids', 'duplicate_sources', 'search_text', 'details_available',
                  'timeline', 'recent_change', 'lifecycle_stage'}


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
        if copies and not copy_ids:
            raise ValueError('Repost identities do not match their sources')
        primary_record = dict(full)
        if 'primary_facts' in full and isinstance(full['primary_facts'], dict):
            # primary_facts is the source-specific snapshot.  Apply explicit
            # nulls as well as values: otherwise an old aggregate deadline,
            # URL, or position table leaks into a source whose current facts
            # explicitly say that field is absent.
            primary_record.update(full['primary_facts'])
            primary_record['id'] = identifier
        rows = [primary_record]
        copies_by_id = {s['id']: s for s in copies if isinstance(s, dict) and s.get('id')}
        for idx, copy_id in enumerate(copy_ids):
            source = copies_by_id.get(copy_id) or (copies[idx] if idx < len(copies) else (copies[-1] if copies else {}))
            source_name = source.get('source_name') or source.get('title') or full['source_name']
            source_facts = source.get('facts') or {}
            source_title = source_facts.get('title') or source.get('announcement_title') or (source.get('title') if source.get('title') != source_name else '') or full['title']
            source_identity = source.get('identity') or source_facts.get('identity')
            restored = dict(full)
            # Restore the duplicate's complete source snapshot, including
            # null values and verification/history fields.  Reconstructing a
            # copy from the parent aggregate loses per-source deadlines,
            # URLs, and probe timestamps.
            if isinstance(source_facts, dict):
                restored.update(source_facts)
            restored.update(
                id=copy_id,
                title=source_title,
                source_url=source.get('url') or source_facts.get('source_url') or full['source_url'],
                source_name=source_name,
                source_id=source_facts.get('source_id') or source_ids.get(source_name, full.get('source_id', '')),
            )
            if source_identity:
                restored['identity'] = source_identity
            if 'published_at' in source and 'published_at' not in source_facts:
                restored['published_at'] = source['published_at']
            rows.append(restored)
        for item in rows:
            row = {k: v for k, v in item.items() if k not in {'duplicate_ids', 'duplicate_sources', 'primary_facts'}}
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
    job_priorities = {}
    source_priorities = {}
    for state in states:
        if not isinstance(state.get('jobs'), dict) or not isinstance(state.get('sources'), dict):
            raise ValueError('Invalid collector state')
        state_prio = state.get('priority', 1)
        for identifier, job in state['jobs'].items():
            if job.get('id') != identifier or not job.get('fingerprint'):
                raise ValueError('Invalid retained job identity')
            old = result['jobs'].get(identifier)
            old_prio = job_priorities.get(identifier, 0)
            if not old or job['last_verified_at'] > old['last_verified_at'] or (
                job['last_verified_at'] == old['last_verified_at'] and state_prio >= old_prio
            ):
                result['jobs'][identifier] = job
                job_priorities[identifier] = state_prio
        for identifier, source in state['sources'].items():
            old = result['sources'].get(identifier)
            old_prio = source_priorities.get(identifier, 0)
            cur_time = source.get('last_attempt_at', '')
            old_time = old.get('last_attempt_at', '') if old else ''
            if not old or cur_time > old_time or (
                cur_time == old_time and state_prio >= old_prio
            ):
                result['sources'][identifier] = source
                source_priorities[identifier] = state_prio
        result['last_run_at'] = max(result['last_run_at'], state['last_run_at'])
    return result


def prepare(public_dir, data_dir, site):
    local_snapshot = read_json(public_dir / 'jobs.json')
    def local_asset(path):
        if not ASSET.fullmatch(path):
            raise ValueError('Invalid local detail path')
        return read_json(public_dir / path.lstrip('/'))
    local_state = snapshot_state(local_snapshot, local_asset)
    local_state['priority'] = 1
    states = [local_state]
    state_path = data_dir / 'state.json'
    if state_path.exists():
        raw_state = read_json(state_path)
        raw_state['priority'] = 2
        states.append(raw_state)
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
        remote_state = snapshot_state(live, remote_asset)
        remote_state['priority'] = 1
        states.append(remote_state)
    state = combine_states(*states)
    state.pop('priority', None)
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


def write_report(data_dir, code, state, error='', source_filter=None, pack_name=''):
    all_sources = list(state.get('sources', {}).values())
    if source_filter:
        sources = [s for s in all_sources if s['id'] in source_filter]
    else:
        sources = all_sources
    report = {'collector_exit_code': code, 'records': len(state.get('jobs', {})),
              'deployment_blocked': bool(error), 'error': error, 'sources': sources}
    atomic_json(data_dir / 'ci-report.json', report)
    title = f"## 招聘数据采集（分片：{pack_name}）" if pack_name else "## 招聘数据采集"
    lines = [title, f"保留记录：{report['records']}；采集器退出码：{code}。",
             '允许构建发布；部分来源问题见下表。' if not error else '阻止发布：' + error,
             '', '| 来源 | 状态 | 列表页 | 解析 | 缓存复用 | 老公告复检 | 详情失败 | 详情跳过 | 问题数 |', '|---|---|---:|---:|---:|---:|---:|---:|---:|']
    for source in sources:
        name = source['name'].replace('|', ' ')
        lines.append(f"| {name} | {source['status']} | {source.get('pages', 0)} | {source.get('parsed', 0)} | {source.get('cached', 0)} | {source.get('probed', 0)} | {source.get('detail_failed', 0)} | {source.get('detail_skipped', 0)} | {len(source.get('errors', []))} |")
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


def _snapshot_checks(snapshot, public_dir):
    """Validate every generated asset before the merge job is allowed to publish."""
    snapshot_state(snapshot, lambda path: read_json(public_dir / path.lstrip('/')))
    search_path = snapshot.get('search_url', '')
    if not re.fullmatch(r'/job-assets/search-[0-9a-f]{20}\.json', search_path):
        raise ValueError('Invalid full-text search asset')
    search = read_json(public_dir / search_path.lstrip('/')).get('jobs', {})
    if set(search) != {job['id'] for job in snapshot['jobs']} or any(not isinstance(body, str) for body in search.values()):
        raise ValueError('Full-text search index is incomplete')


def _state_change_summary(before, after):
    """Return the small top-level change summary used by the public snapshot."""
    before_jobs = before.get('jobs', {})
    after_jobs = after.get('jobs', {})
    before_run = before.get('last_run_at', '')
    new_ids = set(after_jobs) - set(before_jobs)
    changed_ids = {
        identifier for identifier, job in after_jobs.items()
        if identifier in before_jobs and (
            job.get('updated_at', '') > before_jobs[identifier].get('updated_at', '') or
            job.get('last_verified_at', '') > before_run and job.get('content_fingerprint') != before_jobs[identifier].get('content_fingerprint')
        )
    }
    return {
        'new': len(new_ids),
        'changed': len(changed_ids),
        'unchanged': max(0, len(after_jobs) - len(new_ids) - len(changed_ids)),
    }


def _shard_state_paths(shards_dir):
    shards_dir = Path(shards_dir)
    if not shards_dir.exists():
        return {}
    paths = {}
    for path in sorted(shards_dir.rglob('state.json')):
        pack_name = path.parent.name
        if pack_name.startswith('collector-shard-'):
            pack_name = pack_name[len('collector-shard-'):]
        paths[pack_name] = path
    return paths


def merge_shards(public_dir, data_dir, shards_dir, days=30, expected_shards=None):
    """Merge independent collector states and produce one guarded publication."""
    baseline_path = Path(data_dir) / 'state.json'
    if not baseline_path.exists():
        raise ValueError('Collector baseline state is missing')
    baseline = read_json(baseline_path)
    shard_paths = _shard_state_paths(shards_dir)
    expected_shards = list(expected_shards or SOURCE_PACKS)
    missing_shards = [pack for pack in expected_shards if pack not in shard_paths]
    if missing_shards:
        raise ValueError('Missing collector shard artifacts: ' + ', '.join(missing_shards))

    states = [dict(baseline, priority=1)]
    for pack in expected_shards:
        state = read_json(shard_paths[pack])
        if not isinstance(state.get('jobs'), dict) or not isinstance(state.get('sources'), dict):
            raise ValueError(f'Invalid state artifact for source pack: {pack}')
        state['priority'] = 2
        states.append(state)
    merged = combine_states(*states)
    merged.pop('priority', None)
    if not set(baseline.get('jobs', {})).issubset(merged.get('jobs', {})):
        raise ValueError('Historical records are missing after shard merge')

    baseline_sources = baseline.get('sources', {})
    fresh_source_ids = {
        identifier for identifier, source in merged.get('sources', {}).items()
        if source.get('last_attempt_at', '') > baseline_sources.get(identifier, {}).get('last_attempt_at', '')
    }
    expected_source_ids = {
        source_id for pack in expected_shards for source_id in source_pack_ids(pack)
    }
    missing_sources = sorted(expected_source_ids - fresh_source_ids)
    if missing_sources:
        raise ValueError('Collector shards did not refresh sources: ' + ', '.join(missing_sources))

    atomic_json(baseline_path, merged)
    snapshot = export_snapshot(
        merged,
        Path(public_dir),
        days,
        _state_change_summary(baseline, merged),
    )
    _snapshot_checks(snapshot, Path(public_dir))
    fresh_attempts = [
        source.get('last_attempt_at') for identifier, source in merged.get('sources', {}).items()
        if identifier in fresh_source_ids and source.get('last_attempt_at')
    ]
    started = min(dt.datetime.fromisoformat(value) for value in fresh_attempts)
    code = 2 if any(
        merged['sources'].get(identifier, {}).get('status') != 'ok'
        for identifier in expected_source_ids
    ) else 0
    validate_result(code, merged, snapshot, list(baseline.get('jobs', {})), started)
    write_report(Path(data_dir), code, merged)
    print(json.dumps({
        'shards': expected_shards,
        'sources': len(expected_source_ids),
        'records': len(merged.get('jobs', {})),
        'changes': snapshot.get('changes', {}),
    }, ensure_ascii=False), flush=True)
    return 0


def collect(args):
    started = dt.datetime.now(TZ).replace(microsecond=0)
    baseline = read_json(args.data_dir / 'ci-baseline.json')
    command = [sys.executable, '-u', str(ROOT / 'scripts/collect.py'), '--data-dir', str(args.data_dir),
               '--public-dir', str(args.public_dir), '--pages', str(args.pages), '--days', str(args.days),
               '--offerjack-pages', '1', '--refresh-hours', str(args.refresh_hours),
               '--probe-budget', str(getattr(args, 'probe_budget', 10)),
               '--detail-timeout', str(getattr(args, 'detail_timeout', 8)),
               '--detail-retries', str(getattr(args, 'detail_retries', 1)),
               '--detail-failure-limit', str(getattr(args, 'detail_failure_limit', 6))]
    source_pack = getattr(args, 'source_pack', '') or ''
    sources = getattr(args, 'sources', '') or ''
    if source_pack:
        command.extend(['--source-pack', source_pack])
    elif sources:
        command.extend(['--sources', sources])
    source_filter = None
    if source_pack:
        source_filter = set(source_pack_ids(source_pack))
    elif sources:
        source_filter = set(filter(None, sources.split(',')))
    code = subprocess.run(command, check=False).returncode
    state = read_json(args.data_dir / 'state.json')
    try:
        snapshot = read_json(args.public_dir / 'jobs.json')
        validate_result(code, state, snapshot, baseline['ids'], started)
        # Validate every referenced detail and repost before uploading a deployment.
        _snapshot_checks(snapshot, args.public_dir)
    except (ValueError, KeyError, OSError) as error:
        write_report(args.data_dir, code, state, str(error), source_filter=source_filter, pack_name=source_pack)
        raise
    write_report(args.data_dir, code, state, source_filter=source_filter, pack_name=source_pack)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['prepare', 'collect', 'merge'])
    parser.add_argument('--public-dir', type=Path, default=ROOT / 'public')
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'data')
    parser.add_argument('--site', default='')
    parser.add_argument('--pages', type=int, default=5)
    parser.add_argument('--days', type=int, default=30)
    parser.add_argument('--sources', default='', help='comma-separated source ids for one collection shard')
    parser.add_argument('--source-pack', choices=sorted(SOURCE_PACKS), default='', help='predefined source pack for one collection shard')
    parser.add_argument('--shards-dir', type=Path, default=ROOT / 'data' / 'shards', help='downloaded collector shard artifact directory')
    parser.add_argument('--expected-shards', default='', help='comma-separated source pack names expected during merge')
    parser.add_argument('--refresh-hours', type=int, default=72,
                        help='reuse recently verified detail pages for this many hours')
    parser.add_argument('--probe-budget', type=int, default=10,
                        help='maximum number of active historical announcements to probe/re-check per source')
    parser.add_argument('--detail-timeout', type=float, default=8,
                        help='network timeout in seconds for individual detail pages')
    parser.add_argument('--detail-retries', type=int, default=1,
                        help='number of retries for an individual detail page')
    parser.add_argument('--detail-failure-limit', type=int, default=6,
                        help='open a source circuit after this many consecutive detail failures')
    args = parser.parse_args()
    try:
        if args.operation == 'prepare':
            prepare(args.public_dir, args.data_dir, args.site)
        elif args.operation == 'collect':
            collect(args)
        else:
            expected = [value for value in args.expected_shards.split(',') if value]
            merge_shards(args.public_dir, args.data_dir, args.shards_dir, args.days, expected or None)
    except (ValueError, KeyError, OSError) as error:
        message = str(error).replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
        print(f'::error::{message}', file=sys.stderr)
        raise SystemExit(1)
