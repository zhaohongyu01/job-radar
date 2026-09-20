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
import signal
import time
from tempfile import TemporaryDirectory
import urllib.error
import urllib.parse
import urllib.request

import collect as collector
from collect import ROOT, TZ, SOURCES, SOURCE_PACKS, atomic_json, export_snapshot, source_pack_ids
from collector_runtime import bounded_read, bounded_request, remaining, retry_request

ASSET = re.compile(r'^/job-assets/detail-[0-9a-f]{2}-([0-9a-f]{20})\.json$')
HISTORY_FIELDS = {'fingerprint', 'first_seen_at', 'updated_at', 'last_verified_at', 'revision',
                  'duplicate_ids', 'duplicate_sources', 'search_text', 'details_available',
                  'timeline', 'recent_change', 'lifecycle_stage'}


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


@bounded_request
def download_json(url, timeout=40, retries=2):
    request = urllib.request.Request(url, headers={'User-Agent': collector.DEFAULT_USER_AGENT, 'Cache-Control': 'no-cache'})
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(request, timeout=remaining(timeout)) as response:
                return bounded_read(response, 50_000_000, timeout)
        except Exception as error:
            if not retry_request(url, error, attempt, retries):
                raise


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
            if collector.requires_position_detail(row) and not row.get('detail_verification'):
                row['detail_verification'] = 'verified'
            if row['id'] in jobs:
                raise ValueError('Published identities overlap')
            facts = {k: v for k, v in row.items() if k not in HISTORY_FIELDS}
            row['fingerprint'] = hashlib.sha256(json.dumps(facts, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
            jobs[row['id']] = row
    if len(jobs) != snapshot.get('raw_records'):
        raise ValueError('Published baseline record count is incomplete')
    return {'jobs': jobs, 'sources': sources, 'last_run_at': snapshot['generated_at']}


def combine_states(*states):
    result = {'jobs': {}, 'sources': {}, 'pending': {}, 'last_run_at': ''}
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
            if old:
                listing = max((old,job), key=lambda value:value.get('listing_checked_at') or '')
                if listing.get('listing_checked_at'):
                    result['jobs'][identifier] = dict(result['jobs'][identifier],
                        **{field:listing.get(field) for field in collector.LISTING_FIELDS})
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
                if identifier in state.get('pending', {}):
                    result['pending'][identifier] = state['pending'][identifier]
        result['last_run_at'] = max(result['last_run_at'], state['last_run_at'])
    return result


def manifest(site):
    try:
        value = json.loads(download_json(site + '/snapshot-manifest.json'))
    except urllib.error.HTTPError as error:
        if error.code == 404:  # First deployment of the manifest-aware collector.
            return None
        raise
    if value.get('schema_version') != 1 or not re.fullmatch(r'[0-9a-f]{64}', value.get('index_sha256', '')):
        raise ValueError('Invalid published manifest')
    return value


def load_live(public_dir, site, metadata=None):
    raw_index = download_json(site + '/jobs.json')
    digest = hashlib.sha256(raw_index).hexdigest()
    if metadata and digest != metadata['index_sha256']:
        raise ValueError('Published index does not match manifest')
    live = json.loads(raw_index)
    def remote_asset(path):
        match = ASSET.fullmatch(path)
        if not match:
            raise ValueError('Invalid remote detail path')
        cached = public_dir / path.lstrip('/')
        raw = cached.read_bytes() if cached.exists() else download_json(site + path)
        if hashlib.sha256(raw).hexdigest()[:20] != match[1]:
            raise ValueError('Detail content hash mismatch')
        return json.loads(raw)
    return snapshot_state(live, remote_asset), digest


def prepare(public_dir, data_dir, site):
    if site and not re.fullmatch(r'https://[a-zA-Z0-9.-]+', site):
        raise ValueError('Site must be a plain HTTPS origin')
    local_snapshot = read_json(public_dir / 'jobs.json')
    def local_asset(path):
        if not ASSET.fullmatch(path):
            raise ValueError('Invalid local detail path')
        return read_json(public_dir / path.lstrip('/'))
    states = []
    state_path = data_dir / 'state.json'
    raw_state = None
    receipt = {}
    if state_path.exists():
        try:
            candidate_state = read_json(state_path)
            combine_states(candidate_state)  # Validate before considering the cache usable.
        except (OSError, ValueError, KeyError, TypeError) as error:
            # A truncated or incompatible cache must not prevent recovery from
            # the checked-in snapshot or the published baseline.  The merge
            # job will still perform its live-baseline guard before publishing.
            print(f'::warning::缓存状态不可用，回退到本地快照继续：{error}', flush=True)
        else:
            raw_state = candidate_state
            receipt_path = data_dir / 'published-baseline.json'
            if receipt_path.exists():
                try:
                    candidate = read_json(receipt_path)
                    if candidate.get('state_sha256') == hashlib.sha256(state_path.read_bytes()).hexdigest():
                        receipt = candidate
                except (OSError, ValueError, KeyError, TypeError) as error:
                    print(f'::warning::缓存收据不可用，将重新校验线上基线：{error}', flush=True)
            raw_state['priority'] = 2
            states.append(raw_state)
    local_ids = {identifier for job in local_snapshot['jobs'] for identifier in [job['id'], *job.get('duplicate_ids', [])]}
    if not raw_state or not local_ids.issubset(raw_state['jobs']) or local_snapshot['generated_at'] > raw_state['last_run_at']:
        states.append(dict(snapshot_state(local_snapshot, local_asset), priority=1))
    verified = not site
    index_hash = ''
    if site:
        try:
            metadata = manifest(site)
            if metadata and raw_state and receipt.get('index_sha256') == metadata['index_sha256'] and receipt.get('generated_at') == metadata['generated_at']:
                index_hash = metadata['index_sha256']
            else:
                remote_state, index_hash = load_live(public_dir, site, metadata)
                states.append(dict(remote_state, priority=1))
            verified = True
        except OSError as error:
            # Continue useful collection from intact retained data. The final
            # merge must recheck the live baseline before any publication.
            print(f'::warning::线上基线暂不可读，先恢复本地记录继续采集；发布前必须复核：{error}', flush=True)
    state = combine_states(*states)
    if not state['jobs']:
        raise ValueError('No usable historical baseline')
    state['jobs'] = collector.repair_sdu_urls(state['jobs'])
    atomic_json(state_path, state)
    atomic_json(data_dir / 'ci-baseline.json', {'ids': sorted(state['jobs']), 'generated_at': state['last_run_at'],
                'site':site, 'live_verified':verified, 'index_sha256':index_hash})
    print(f"Restored {len(state['jobs'])} retained records from git, cache and published baseline", flush=True)


def validate_result(code, state, snapshot, baseline_ids, started):
    if code not in {0, 2}:
        raise ValueError(f'Collector crashed (exit {code}); deployment blocked')
    if not state.get('jobs') or not snapshot.get('jobs'):
        raise ValueError('Empty collection; deployment blocked')
    if dt.datetime.fromisoformat(state['last_run_at']) < started or snapshot['generated_at'] != state['last_run_at']:
        raise ValueError('Collector did not finish generating a fresh snapshot')
    published = {identifier for job in snapshot['jobs'] for identifier in [job['id'], *job.get('duplicate_ids', [])]}
    expected_public = {identifier for identifier, job in state['jobs'].items() if collector.publishable_job(job)}
    if not set(baseline_ids).issubset(state['jobs']) or published != expected_public:
        raise ValueError('Historical records are missing; deployment blocked')
    attempted = [s for s in state['sources'].values()
                 if dt.datetime.fromisoformat(s['last_attempt_at']) >= started]
    usable = [s for s in attempted if s.get('parsed', 0) or s.get('cached', 0) or s.get('status') in {'ok', 'deferred'}]
    if not usable:
        raise ValueError('No source produced a usable verification; deployment blocked')
    return attempted


def write_report(data_dir, code, state, error='', source_filter=None, pack_name='', emit_summary=True):
    all_sources = list(state.get('sources', {}).values())
    if source_filter:
        sources = [s for s in all_sources if s['id'] in source_filter]
    else:
        sources = all_sources
    report = {'collector_exit_code': code, 'records': len(state.get('jobs', {})),
              'deployment_blocked': bool(error), 'error': error, 'sources': sources}
    atomic_json(data_dir / 'ci-report.json', report)
    if not emit_summary:
        return
    title = f"## 招聘数据采集（分片：{pack_name}）" if pack_name else "## 招聘数据采集"
    record_label = '本分片变更记录' if state.get('delta_version') else '保留记录'
    decision = ('分片已保存；是否发布由最终合并核验决定。' if pack_name else
                '已通过合并核验；部分来源问题见下表。')
    if pack_name and not any(s.get('parsed', 0) or s.get('cached', 0) or s.get('status') == 'ok' for s in sources):
        decision = '本分片没有成功核验的来源，历史记录已保留；是否发布由最终合并核验决定。'
    lines = [title, f"{record_label}：{report['records']}；采集器退出码：{code}。",
             decision if not error else '阻止发布：' + error,
             '', '| 来源 | 状态 | 列表页 | 解析 | 缓存复用 | 老公告复检 | 详情失败 | 详情跳过 | 待续详情 | 耗时/秒 | 问题数 |', '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
    for source in sources:
        name = source['name'].replace('|', ' ')
        label = source['status']
        if label == 'blocked':
            label = '共享冷却跳过' if not source.get('errors') or source.get('request_diagnostic', {}).get('stage') == 'shared_cooldown' else '请求被拒绝'
        lines.append(f"| {name} | {label} | {source.get('pages', 0)} | {source.get('parsed', 0)} | {source.get('cached', 0)} | {source.get('probed', 0)} | {source.get('detail_failed', 0)} | {source.get('detail_skipped', 0)} | {source.get('pending_details', 0)} | {source.get('elapsed_seconds', 0)} | {len(source.get('errors', []))} |")
    for source in sources:
        if source.get('errors'):
            lines.extend(['', f"### {source['name']}", source.get('coverage', '')])
            for issue in source['errors'][:3]:
                lines.append('- ' + issue['reason'].replace('\n', ' '))
                request = issue.get('request')
                if request:
                    lines.append('- 请求诊断：' + json.dumps(request, ensure_ascii=False))
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
        try:
            rel_parts = path.relative_to(shards_dir).parts
        except ValueError:
            rel_parts = path.parts
        pack_name = None
        for part in rel_parts:
            if part.startswith('collector-shard-'):
                pack_name = part[len('collector-shard-'):]
                break
            if part in SOURCE_PACKS:
                pack_name = part
                break
        if not pack_name:
            pack_name = path.parent.name
            if pack_name.startswith('collector-shard-'):
                pack_name = pack_name[len('collector-shard-'):]
        if pack_name:
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
        print(f"::warning::部分分片产物未找到：{', '.join(missing_shards)}；已发现分片：{list(shard_paths.keys())}", flush=True)
    states = [dict(baseline, priority=1)]
    for pack in expected_shards:
        owned = set(source_pack_ids(pack))
        if pack not in shard_paths:
            continue
        state = read_json(shard_paths[pack])
        if not isinstance(state.get('jobs'), dict) or not isinstance(state.get('sources'), dict):
            raise ValueError(f'Invalid state artifact for source pack: {pack}')
        combine_states(state)
        if state.get('delta_version'):
            if state.get('base_generation') != baseline['last_run_at'] or state.get('source_pack') != pack:
                raise ValueError(f'Shard was collected from a different baseline: {pack}')
            if any(j.get('source_id') not in owned for j in state['jobs'].values()) or set(state['sources']) - owned:
                raise ValueError(f'Shard writes outside its source pack: {pack}')
        # Compatibility with old full-state artifacts: never accept another
        # shard's inherited copies as newer authority for unowned sources.
        state['jobs'] = {k:v for k,v in state['jobs'].items() if v.get('source_id') in owned}
        state['sources'] = {k:v for k,v in state['sources'].items() if k in owned}
        state['pending'] = {k:v for k,v in state.get('pending', {}).items() if k in owned}
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
    usable_ids = {identifier for identifier in fresh_source_ids if
                  merged['sources'][identifier].get('parsed', 0) or merged['sources'][identifier].get('cached', 0) or
                  merged['sources'][identifier].get('status') == 'ok'}
    if not usable_ids:
        diag = f"fresh_source_ids={len(fresh_source_ids)}, found_shards={list(shard_paths.keys())}, expected_shards={expected_shards}"
        write_report(Path(data_dir), 2, merged, f'No source produced a usable verification ({diag}); deployment blocked')
        raise ValueError(f'No source produced a usable verification ({diag}); deployment blocked')
    for identifier in missing_sources:
        old = merged['sources'].get(identifier, {})
        definition = next(s for s in SOURCES if s['id'] == identifier)
        merged['sources'][identifier] = dict(definition, **{k:v for k,v in old.items() if k not in definition})
        merged['sources'][identifier].update(status='failed', parsed=0, cached=0,
            last_attempt_at=old.get('last_attempt_at') or merged['last_run_at'],
            coverage='本轮分片未完成；保留历史记录，下次继续采集',
            errors=[{'url':definition['url'], 'reason':'分片缺失或未完成此来源'}])

    metadata_path = Path(data_dir) / 'ci-baseline.json'
    metadata = read_json(metadata_path) if metadata_path.exists() else {}
    if metadata.get('site'):
        current = manifest(metadata['site'])
        if not metadata.get('live_verified') or not current or current['index_sha256'] != metadata.get('index_sha256'):
            live, _ = load_live(Path(public_dir), metadata['site'], current)
            baseline = combine_states(baseline, live)
            merged = combine_states(dict(baseline, priority=1), dict(merged, priority=2))
    merged['jobs'] = collector.repair_sdu_urls(merged['jobs'])

    atomic_json(baseline_path, merged)
    previous_snapshot_path = Path(public_dir) / 'jobs.json'
    previous_snapshot = read_json(previous_snapshot_path) if previous_snapshot_path.exists() else None
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
    try:
        from coverage_report import build_coverage_report
    except ImportError:
        from scripts.coverage_report import build_coverage_report
    atomic_json(Path(data_dir) / 'coverage-changes.json',
                build_coverage_report(baseline, merged, snapshot, previous_snapshot=previous_snapshot))
    atomic_json(Path(data_dir) / 'published-baseline.json', {
        'generated_at':snapshot['generated_at'],
        'index_sha256':hashlib.sha256((Path(public_dir)/'jobs.json').read_bytes()).hexdigest(),
        'state_sha256':hashlib.sha256(baseline_path.read_bytes()).hexdigest(),
    })
    write_report(Path(data_dir), code, merged)
    print(json.dumps({
        'shards': expected_shards,
        'sources': len(expected_source_ids),
        'records': len(merged.get('jobs', {})),
        'changes': snapshot.get('changes', {}),
    }, ensure_ascii=False), flush=True)
    return 0


def run_process(command, timeout):
    """Kill the owned process tree at the source deadline, including PDF workers."""
    options = {'start_new_session':True} if os.name != 'nt' else {'creationflags':subprocess.CREATE_NO_WINDOW}
    process = subprocess.Popen(command, **options)
    try:
        return process.wait(timeout=timeout), False
    except subprocess.TimeoutExpired:
        if os.name != 'nt':
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        else:
            subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                           capture_output=True, timeout=10, check=False)
            if process.poll() is None:
                process.kill()
        process.wait(timeout=10)
        return -1, True


def recover_source(directory, definition, prior, started, code, timed_out):
    """Recover complete journal lines even when a worker never reached export."""
    path = directory / 'state.json'
    state = read_json(path)
    if code in {0, 2} and state.get('last_run_at', '') >= started:
        return state
    checkpoint_path = directory / 'checkpoint.json'
    checkpoint = read_json(checkpoint_path) if checkpoint_path.exists() else {}
    if checkpoint and checkpoint.get('source', {}).get('id') != definition['id']:
        raise ValueError('Checkpoint belongs to another source')
    incoming, verified = {}, set()
    journal = directory / 'progress.jsonl'
    if journal.exists():
        for line in journal.read_text(encoding='utf-8').splitlines(keepends=True):
            if not line.endswith('\n'):
                break  # Process termination can leave only the final line incomplete.
            event = json.loads(line)
            job = event['job']
            if job.get('source_id') != definition['id']:
                raise ValueError('Journal belongs to another source')
            incoming[job['id']] = job
            if event.get('verified'):
                verified.add(event['url'])
    pending = [item for item in checkpoint.get('pending', prior.get('pending', {}).get(definition['id'], []))
               if item['url'] not in verified]
    for item in pending:
        identifier = collector.item_id(item)
        if identifier not in state['jobs'] and identifier not in incoming:
            job = collector.parse_detail('<div id="zoom">详情尚未读取，请打开原公告核对岗位与报名要求。</div>',
                                         item, {'id':'fallback','name':definition['name']})
            job.update(source_id=definition['id'], classification_note='仅核实列表标题和发布日期；详情与资格待核对。')
            incoming[identifier] = job
    now = dt.datetime.now(TZ).isoformat(timespec='seconds')
    jobs, _ = collector.merge(state['jobs'], list(incoming.values()), checkpoint.get('run_at', started))
    if definition.get('adapter') in {'zhiye_jobs','haier_jobs','haier_campus'}:
        jobs = collector.reconcile_listings(jobs, definition['id'], set(checkpoint.get('inventory_ids', [])),
                                            checkpoint.get('inventory_complete', False), now)
    status = dict(checkpoint.get('source') or definition)
    reason = '来源达到总时间预算；已恢复采集进度，剩余详情下次继续' if timed_out else f'来源进程异常退出（{code}）；已恢复采集进度'
    status.update(last_attempt_at=started, status='partial' if verified else 'failed',
                  last_success_at=prior.get('sources', {}).get(definition['id'], {}).get('last_success_at'),
                  parsed=len(verified), pending_details=len(pending), coverage=reason)
    status.setdefault('errors', []).append({'url':definition['url'], 'reason':reason})
    return {'jobs':jobs, 'sources':{definition['id']:status}, 'pending':{definition['id']:pending}, 'last_run_at':now}


def run_source(definition, prior, args, budget):
    with TemporaryDirectory(prefix='source-', dir=args.data_dir) as temp:
        directory = Path(temp).resolve()
        if not directory.is_relative_to(args.data_dir.resolve()):
            raise ValueError('Worker directory escaped its state directory')
        atomic_json(directory / 'state.json', prior)
        started = dt.datetime.now(TZ).isoformat(timespec='seconds')
        command = [sys.executable, '-u', str(ROOT/'scripts/collect.py'), '--data-dir', str(directory),
                   '--public-dir', str(directory/'public'), '--state-only', '--sources', definition['id'],
                   '--pages', str(args.pages), '--days', str(args.days), '--offerjack-pages', '1',
                   '--history-days', str(getattr(args, 'history_days', 180)),
                   '--refresh-hours', str(args.refresh_hours), '--probe-budget', str(getattr(args,'probe_budget',10)),
                   '--detail-timeout', str(getattr(args,'detail_timeout',8)),
                   '--detail-retries', str(getattr(args,'detail_retries',1)),
                   '--detail-failure-limit', str(getattr(args,'detail_failure_limit',6))]
        command.extend(['--rate-state', str((args.data_dir / 'host-pacing.sqlite').resolve())])
        if getattr(args, 'deep_scan', False):
            command.append('--deep-scan')
        if getattr(args, 'sdei_group', None) is not None:
            command.extend(['--sdei-group', str(args.sdei_group)])
        if getattr(args, 'force_positions', False):
            command.append('--force-positions')
        before = time.monotonic()
        code, timed_out = run_process(command, budget)
        state = recover_source(directory, definition, prior, started, code, timed_out)
        state['sources'][definition['id']]['elapsed_seconds'] = round(time.monotonic() - before, 2)
        return state


def collect(args):
    """Isolate sources, persist pack deltas and leave public export to the merger."""
    baseline = read_json(args.data_dir / 'state.json')
    baseline['jobs'] = collector.repair_sdu_urls(baseline['jobs'])
    source_pack = getattr(args, 'source_pack', '') or ''
    selected = set(source_pack_ids(source_pack) if source_pack else filter(None, getattr(args,'sources','').split(',')))
    definitions = [source for source in SOURCES if not selected or source['id'] in selected]
    if not definitions or selected - {source['id'] for source in definitions}:
        raise ValueError('Unknown or empty source selection')
    deadline = time.monotonic() + float(getattr(args, 'shard_budget', 1080))
    state = {'jobs':{}, 'sources':{}, 'pending':{}, 'last_run_at':baseline['last_run_at'],
             'delta_version':1, 'base_generation':baseline['last_run_at'], 'source_pack':source_pack}
    atomic_json(args.data_dir / 'state.json', state)
    host_rejections = {}
    is_deep_scan = bool(getattr(args, 'deep_scan', False) or dt.datetime.now(TZ).weekday() == 6)
    active_sdei_schools, sdei_group = collector.get_active_sdei_schools(
        now_dt=dt.datetime.now(TZ),
        force_group=getattr(args, 'sdei_group', None),
        deep_scan=is_deep_scan
    )
    schools_with_new_announcements = set()
    host_blocked_until: dict[str, str] = {}
    for s_id, s_info in baseline.get('sources', {}).items():
        b_until = s_info.get('blocked_until')
        if b_until:
            s_def = next((s for s in SOURCES if s['id'] == s_id), None)
            if s_def:
                s_host = urllib.parse.urlsplit(s_def['url']).netloc
                if s_host not in host_blocked_until or b_until > host_blocked_until[s_host]:
                    host_blocked_until[s_host] = b_until

    def make_idle_source_status(definition, status, last_attempt_at, coverage,
                                last_success_at=None, errors=None, **extra):
        base = dict(definition, status=status, last_attempt_at=last_attempt_at,
                    last_success_at=last_success_at,
                    pages=0, discovered=0, parsed=0, cached=0, probed=0,
                    detail_attempted=0, detail_failed=0, detail_skipped=0,
                    errors=errors if errors is not None else [], coverage=coverage)
        base.update(extra)
        for field in collector.PAGINATION_FIELDS:
            prior_status = baseline.get('sources', {}).get(definition['id'], {})
            if field in prior_status:
                base[field] = prior_status[field]
        return base

    is_single_explicit_source = bool(len(selected) == 1)

    for definition in definitions:
        identifier = definition['id']
        host = urllib.parse.urlsplit(definition['url']).netloc
        budget = min(float(getattr(args, 'source_budget', 180)), deadline - time.monotonic())
        prior = {'jobs':{k:v for k,v in baseline['jobs'].items() if v.get('source_id') == identifier},
                 'sources':{identifier:baseline['sources'][identifier]} if identifier in baseline['sources'] else {},
                 'pending':{identifier:baseline.get('pending', {}).get(identifier, [])},
                 'last_run_at':baseline['last_run_at']}
        prior_source = prior.get('sources', {}).get(identifier, {})
        candidates = [t for t in (prior_source.get('blocked_until'), host_blocked_until.get(host)) if t]
        prior_blocked = max(candidates) if candidates else None
        if prior_blocked:
            try:
                if dt.datetime.fromisoformat(prior_blocked) > dt.datetime.now(TZ):
                    now = dt.datetime.now(TZ).isoformat(timespec='seconds')
                    status = make_idle_source_status(
                        definition, status='blocked', last_attempt_at=now,
                        coverage=f'上游安全策略拦截(HTTP 403/420)；持续冷却至 {prior_blocked[:19]}，保留历史记录',
                        last_success_at=prior_source.get('last_success_at'),
                        blocked_until=prior_blocked
                    )
                    if 'total_items' in prior_source:
                        status['total_items'] = prior_source['total_items']
                    if 'list_complete' in prior_source:
                        status['list_complete'] = prior_source['list_complete']
                    result = dict(prior, sources={identifier: status}, last_run_at=now)
                    combine_states(result)
                    state['sources'][identifier] = status
                    atomic_json(args.data_dir / 'state.json', state)
                    write_report(args.data_dir, 0 if all(s.get('status') in {'ok', 'deferred', 'blocked'} for s in state['sources'].values()) else 2,
                                 state, source_filter=selected, pack_name=source_pack, emit_summary=False)
                    continue
            except Exception:
                pass
        if definition.get('adapter') == 'sdei' and not is_single_explicit_source:
            school = definition['school']
            channel = definition['channel']
            if school not in active_sdei_schools:
                pos_id = f'{school}-positions'
                pos_prior = baseline.get('sources', {}).get(pos_id, {})
                pos_last_succ = pos_prior.get('last_success_at')
                pos_needs_catchup = (
                    pos_prior.get('list_complete') is False or
                    pos_prior.get('status') in {'failed', 'partial'} or
                    bool(pos_prior.get('errors')) or
                    not pos_last_succ or
                    (dt.datetime.now(TZ) - dt.datetime.fromisoformat(pos_last_succ)).total_seconds() > 96 * 3600
                )
                if not (channel == 'positions' and pos_needs_catchup):
                    now = dt.datetime.now(TZ).isoformat(timespec='seconds')
                    status = make_idle_source_status(
                        definition, status='deferred', last_attempt_at=now,
                        coverage=f'高校4组轮转排期本轮休眠（当前活跃：第{sdei_group}组），保留历史数据',
                        last_success_at=prior['sources'].get(identifier, {}).get('last_success_at')
                    )
                    if 'total_items' in prior_source:
                        status['total_items'] = prior_source['total_items']
                    if 'list_complete' in prior_source:
                        status['list_complete'] = prior_source['list_complete']
                    if 'blocked_until' in prior_source:
                        status['blocked_until'] = prior_source['blocked_until']
                    result = dict(prior, sources={identifier: status}, last_run_at=now)
                    combine_states(result)
                    state['sources'][identifier] = status
                    atomic_json(args.data_dir / 'state.json', state)
                    write_report(args.data_dir, 0 if all(s.get('status') in {'ok', 'deferred', 'blocked'} for s in state['sources'].values()) else 2,
                                 state, source_filter=selected, pack_name=source_pack, emit_summary=False)
                    continue
        if budget <= 1 or len(host_rejections.get(host, set())) >= 2:
            now = dt.datetime.now(TZ).isoformat(timespec='seconds')
            is_host_blocked = len(host_rejections.get(host, set())) >= 2
            reason = '分片达到软截止；下次继续' if budget <= 1 else '同主机多个订阅被拒绝，暂停本轮请求并保留历史'
            status = make_idle_source_status(
                definition, status='blocked' if is_host_blocked else 'partial',
                last_attempt_at=now, coverage=reason,
                last_success_at=prior['sources'].get(identifier, {}).get('last_success_at'),
                errors=[{'url': definition['url'], 'reason': reason}]
            )
            if is_host_blocked:
                status['blocked_until'] = (dt.datetime.now(TZ) + dt.timedelta(hours=4)).isoformat(timespec='seconds')
                host_blocked_until[host] = status['blocked_until']
            result = dict(prior, sources={identifier:status}, last_run_at=now)
        else:
            result = run_source(definition, prior, args, budget)
        combine_states(result)
        status = result['sources'][identifier]
        if status.get('blocked_until'):
            if host not in host_blocked_until or status['blocked_until'] > host_blocked_until[host]:
                host_blocked_until[host] = status['blocked_until']
        has_new_or_changed = any(
            v.get('source_id') == identifier and (
                k not in baseline['jobs'] or
                v.get('content_fingerprint') != baseline['jobs'][k].get('content_fingerprint')
            )
            for k, v in result['jobs'].items()
        )
        if definition.get('adapter') == 'sdei' and definition.get('channel') == 'announcements' and has_new_or_changed:
            schools_with_new_announcements.add(definition['school'])
        if any(re.search(r'HTTP Error (?:403|420|429)', issue.get('reason','')) for issue in status.get('errors', [])):
            host_rejections.setdefault(host,set()).add(definition.get('school') or identifier)
        if status.get('total_items') is None and 'total_items' in prior_source:
            status['total_items'] = prior_source['total_items']
        if status.get('list_complete') is None and 'list_complete' in prior_source:
            status['list_complete'] = prior_source['list_complete']
        state['jobs'].update({k:v for k,v in result['jobs'].items() if v != baseline['jobs'].get(k)})
        state['sources'].update(result['sources'])
        state['pending'].update(result.get('pending', {}))
        state['last_run_at'] = max(state['last_run_at'], result['last_run_at'])
        # A job-level interruption still leaves an uploadable delta after each source.
        atomic_json(args.data_dir / 'state.json', state)
        write_report(args.data_dir, 0 if all(s.get('status') in {'ok', 'deferred', 'blocked'} for s in state['sources'].values()) else 2,
                     state, source_filter=selected, pack_name=source_pack, emit_summary=False)
    code = 0 if all(s.get('status') in {'ok', 'deferred', 'blocked'} for s in state['sources'].values()) else 2
    write_report(args.data_dir, code, state, source_filter=selected, pack_name=source_pack)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['prepare', 'collect', 'merge'])
    parser.add_argument('--public-dir', type=Path, default=ROOT / 'public')
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'data')
    parser.add_argument('--site', default='')
    parser.add_argument('--pages', type=int, default=5)
    parser.add_argument('--days', type=int, default=30)
    parser.add_argument('--history-days', type=int, choices=range(1,366), default=180, metavar='1..365')
    parser.add_argument('--sources', default='', help='comma-separated source ids for one collection shard')
    parser.add_argument('--source-pack', choices=sorted(SOURCE_PACKS), default='', help='predefined source pack for one collection shard')
    parser.add_argument('--shards-dir', type=Path, default=ROOT / 'data' / 'shards', help='downloaded collector shard artifact directory')
    parser.add_argument('--expected-shards', default='', help='comma-separated source pack names expected during merge')
    parser.add_argument('--refresh-hours', type=int, default=72,
                        help='reuse recently verified detail pages for this many hours')
    parser.add_argument('--source-budget', type=float, default=180, help='hard wall-clock budget per isolated source process')
    parser.add_argument('--shard-budget', type=float, default=1080, help='stop starting sources before the CI hard timeout')
    parser.add_argument('--probe-budget', type=int, default=10,
                        help='maximum number of active historical announcements to probe/re-check per source')
    parser.add_argument('--detail-timeout', type=float, default=8,
                        help='network timeout in seconds for individual detail pages')
    parser.add_argument('--detail-retries', type=int, default=1,
                        help='number of retries for an individual detail page')
    parser.add_argument('--detail-failure-limit', type=int, default=6,
                        help='open a source circuit after this many consecutive detail failures')
    parser.add_argument('--sdei-group', type=int, default=None, help='override SDEI rotation group index (0..3)')
    parser.add_argument('--deep-scan', action='store_true', help='bypass safe early exit and scan all rotation groups and positions')
    parser.add_argument('--force-positions', action='store_true', help='force scanning SDEI position endpoints')
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
