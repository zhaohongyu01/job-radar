"""Audit actual publication freshness, source coverage and upcoming talks without fetching detail pages."""
import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import urllib.request

TZ = dt.timezone(dt.timedelta(hours=8))
ASSET = re.compile(r'^/job-assets/index-([0-9a-f]{20})\.json$')


def audit(snapshot, now=None):
    now = now or dt.datetime.now(TZ)
    today = now.date().isoformat()
    jobs = snapshot.get('jobs', [])
    dates = [job.get('published_at') for job in jobs if
             re.fullmatch(r'20\d{2}-\d{2}-\d{2}', str(job.get('published_at') or ''))]
    future = [value for value in dates if value > today]
    valid_dates = [value for value in dates if value <= today]
    recent_cutoff = (now - dt.timedelta(days=6)).date().isoformat()
    sources = []
    for source in snapshot.get('sources', []):
        stamp = source.get('last_list_read_at') or source.get('head_scan_at') or (
            source.get('last_attempt_at') if source.get('pages', 0) else None) or source.get('last_success_at')
        try:
            age = round((now - dt.datetime.fromisoformat(stamp)).total_seconds() / 3600, 1)
        except (TypeError, ValueError):
            age = None
        sources.append({'id': source['id'], 'name': source.get('name', source['id']),
            'status': source.get('status', 'unknown'), 'last_list_read_at': stamp, 'age_hours': age,
            'pending_details': source.get('pending_details', 0), 'coverage': source.get('coverage', ''),
            'error': (source.get('errors') or [{}])[0].get('reason', '')})
    events = {}
    for job in jobs:
        for event in job.get('talk_events') or ([job['talk_event']] if job.get('talk_event') else []):
            try:
                end = dt.datetime.fromisoformat(f"{event['date']}T{event.get('end_time') or '23:59'}:00+08:00")
            except (KeyError, ValueError):
                continue
            if end >= now:
                events.setdefault(event.get('id') or (event['date'], event.get('school'), event.get('venue'), job.get('company')), event)
    checked = sum(s['age_hours'] is not None and 0 <= s['age_hours'] <= 24 for s in sources)
    warnings = []
    if sources and checked * 2 < len(sources):
        warnings.append(f'24 小时内仅巡检 {checked}/{len(sources)} 个来源；请检查来源休眠、网络和采集预算。')
    if not valid_dates or max(valid_dates) < recent_cutoff:
        warnings.append('全站最新明确发布日期已超过 7 天；快照生成成功不代表岗位数据仍然新鲜。')
    return {'schema_version': 1, 'audited_at': now.isoformat(timespec='seconds'),
        'snapshot_generated_at': snapshot.get('generated_at'), 'records': len(jobs),
        'latest_publication': max(valid_dates, default=None),
        'published_last_7_days': sum(recent_cutoff <= value <= today for value in valid_dates),
        'future_publication_dates': len(future),
        'sources_total': len(sources),
        'sources_checked_last_24_hours': checked,
        'source_statuses': dict(Counter(s['status'] for s in sources)),
        'pending_details': sum(s['pending_details'] or 0 for s in sources),
        'upcoming_talks': len(events),
        'talk_cities': dict(Counter(e.get('city') or '地点待核实' for e in events.values())),
        'warnings': warnings, 'sources': sources}


def load_snapshot(site='', public_dir=Path('public')):
    if site and not re.fullmatch(r'https://[a-zA-Z0-9.-]+', site):
        raise ValueError('Site must be a plain HTTPS origin')
    def read(path):
        if not site:
            return (public_dir / path.lstrip('/')).read_bytes()
        request = urllib.request.Request(site + path, headers={'User-Agent': 'JobRadar-freshness-audit', 'Cache-Control': 'no-cache'})
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read(25 * 1024 * 1024 + 1)
        if len(raw) > 25 * 1024 * 1024:
            raise ValueError('Snapshot asset exceeds 25 MiB')
        return raw
    snapshot = json.loads(read('/jobs.json'))
    def part(path):
        match = ASSET.fullmatch(path)
        if not match:
            raise ValueError('Invalid snapshot index path')
        raw = read(path)
        if hashlib.sha256(raw).hexdigest()[:20] != match[1]:
            raise ValueError('Snapshot index hash mismatch')
        return json.loads(raw)['jobs']
    if snapshot.get('index_shards'):
        with ThreadPoolExecutor(max_workers=4) as pool:
            snapshot['jobs'] = [job for rows in pool.map(part, snapshot['index_shards']) for job in rows]
        if len(snapshot['jobs']) != snapshot.get('index_count'):
            raise ValueError('Snapshot index is incomplete')
    return snapshot


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site', default='')
    parser.add_argument('--public-dir', type=Path, default=Path('public'))
    parser.add_argument('--output', type=Path, default=Path('data/freshness-report.json'))
    args = parser.parse_args()
    report = audit(load_snapshot(args.site, args.public_dir))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({key: value for key, value in report.items() if key != 'sources'}, ensure_ascii=False, indent=2))
    for warning in report['warnings']:
        print('::warning::' + warning)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as handle:
            handle.write('\n## 实际数据新鲜度与覆盖\n\n'
                f"- 最新明确发布：{report['latest_publication'] or '未知'}；近 7 天发布：{report['published_last_7_days']} 条。\n"
                f"- 24 小时内巡检：{report['sources_checked_last_24_hours']}/{report['sources_total']} 个来源。\n"
                f"- 已知待补详情：{report['pending_details']}；后续宣讲：{report['upcoming_talks']} 场。\n"
                '- 每个来源的巡检时间、失败原因和待续详情见产物 freshness-report.json。\n')
