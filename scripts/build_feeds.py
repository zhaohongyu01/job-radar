"""Generate static RSS 2.0 feeds and subscribable iCalendar (.ics) feeds from validated snapshots."""
from __future__ import annotations

import argparse
import datetime as dt
from email.utils import format_datetime
import hashlib
import json
from pathlib import Path
from typing import Any, Dict, List, Tuple
from xml.sax.saxutils import escape as xml_escape

try:
    from build_radar_sqlite import healed_publication_day, shanghai_day, sort_jobs_by_newest
except ImportError:
    from scripts.build_radar_sqlite import healed_publication_day, shanghai_day, sort_jobs_by_newest

ROOT = Path(__file__).resolve().parents[1]
TZ = dt.timezone(dt.timedelta(hours=8))
DEFAULT_SITE = 'https://sites-project.job-radar.workers.dev'


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding='utf-8'))


def _parse_dt(date_str: str | None, fallback: dt.datetime) -> dt.datetime:
    if not date_str:
        return fallback
    s = str(date_str).strip()
    try:
        if len(s) == 10 and s[4] == '-' and s[7] == '-':
            return dt.datetime.fromisoformat(f'{s}T09:00:00+08:00')
        parsed = dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=TZ)
        return parsed
    except Exception:
        return fallback


def _ics_escape(value: str) -> str:
    return (
        (value or '')
        .replace('\\', '\\\\')
        .replace(';', '\\;')
        .replace(',', '\\,')
        .replace('\r\n', '\\n')
        .replace('\n', '\\n')
    )


def _fold_ics_line(line: str) -> str:
    # RFC 5545 75-octet soft fold (safe UTF-8 character boundary)
    raw = line.encode('utf-8')
    if len(raw) <= 73:
        return line
    parts: List[str] = []
    cur = ''
    cur_bytes = 0
    limit = 73
    for ch in line:
        b_len = len(ch.encode('utf-8'))
        if cur_bytes + b_len > limit and cur:
            parts.append(cur)
            cur = ' ' + ch
            cur_bytes = 1 + b_len
            limit = 73
        else:
            cur += ch
            cur_bytes += b_len
    if cur:
        parts.append(cur)
    return '\r\n'.join(parts)


def _build_rss_document(
    *,
    title: str,
    link: str,
    self_url: str,
    description: str,
    now_dt: dt.datetime,
    items: List[Dict[str, str]],
) -> str:
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
        '  <channel>',
        f'    <title>{xml_escape(title)}</title>',
        f'    <link>{xml_escape(link)}</link>',
        f'    <atom:link href="{xml_escape(self_url)}" rel="self" type="application/rss+xml" />',
        f'    <description>{xml_escape(description)}</description>',
        '    <language>zh-CN</language>',
        f'    <lastBuildDate>{xml_escape(format_datetime(now_dt))}</lastBuildDate>',
    ]
    for it in items:
        lines.extend(
            [
                '    <item>',
                f"      <title>{xml_escape(it['title'])}</title>",
                f"      <link>{xml_escape(it['link'])}</link>",
                f"      <guid isPermaLink=\"false\">{xml_escape(it['guid'])}</guid>",
                f"      <pubDate>{xml_escape(it['pubDate'])}</pubDate>",
                f"      <description>{xml_escape(it['description'])}</description>",
                '    </item>',
            ]
        )
    lines.extend(['  </channel>', '</rss>', ''])
    return '\n'.join(lines)


def _load_jobs_for_feed(public_dir: Path) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    jobs_file = public_dir / 'jobs.json'
    if not jobs_file.is_file():
        return {}, []
    snap = _load_json(jobs_file)
    browse = snap.get('browse_index') or {}
    if isinstance(browse.get('shards'), list) and browse['shards']:
        # First 2 browse shards already hold newest opportunities
        rows: List[Dict[str, Any]] = []
        for rel in browse['shards'][:2]:
            p = public_dir / str(rel).lstrip('/')
            if p.is_file():
                rows.extend((_load_json(p).get('jobs') or []))
        return snap, rows
    if isinstance(snap.get('index_shards'), list) and snap['index_shards']:
        rows = []
        for rel in snap['index_shards'][:2]:
            p = public_dir / str(rel).lstrip('/')
            if p.is_file():
                rows.extend((_load_json(p).get('jobs') or []))
        return snap, rows
    return snap, list(snap.get('jobs') or [])


def build_feeds(public_dir: Path, site_origin: str = DEFAULT_SITE) -> Dict[str, int]:
    public_dir = Path(public_dir).resolve()
    site = site_origin.rstrip('/')
    feeds_dir = public_dir / 'feeds'
    feeds_dir.mkdir(parents=True, exist_ok=True)

    now_dt = dt.datetime.now(TZ)
    dtstamp = now_dt.astimezone(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')

    # 1. Exams RSS + Subscribable iCalendar (.ics)
    exams_file = public_dir / 'exams.json'
    exam_items: List[Dict[str, str]] = []
    ics_events: List[List[str]] = []

    if exams_file.is_file():
        exam_snap = _load_json(exams_file)
        snap_dt = _parse_dt(exam_snap.get('generated_at'), now_dt)
        exams = list(exam_snap.get('exams') or [])
        exams_sorted = sorted(
            exams,
            key=lambda x: (str(x.get('published_at') or ''), str(x.get('id') or '')),
            reverse=True,
        )

        for ex in exams_sorted[:60]:
            eid = str(ex.get('id') or '')
            title = str(ex.get('title') or '')
            org = str(ex.get('organizer') or '')
            cities = '、'.join(str(c) for c in (ex.get('cities') or [])[:4]) or str(ex.get('province') or '山东')
            hc = ex.get('total_headcount')
            hc_str = f'招录 {hc} 人' if hc is not None else '招录人数见公告'
            sched = ex.get('schedule') or {}
            reg_str = f"报名截止：{sched['reg_end']}" if sched.get('reg_end') else (
                '长期招聘' if sched.get('reg_mode') == 'rolling' else '报名时间见公告'
            )
            deep_url = f'{site}/exams?exam={eid}'
            desc = ' · '.join(p for p in (org, cities, hc_str, reg_str, str(ex.get('excerpt') or '')[:160]) if p)
            pub_dt = _parse_dt(ex.get('published_at'), snap_dt)
            exam_items.append(
                {
                    'title': f'[{cities}] {title}',
                    'link': deep_url,
                    'guid': f'job-radar-exam-{eid}',
                    'pubDate': format_datetime(pub_dt),
                    'description': desc,
                }
            )

        # Build subscribable iCalendar events for active/upcoming exam milestones
        milestone_defs = [
            ('reg_end', '【报名截止】'),
            ('payment_end', '【缴费确认截止】'),
            ('admit_card_start', '【准考证打印】'),
            ('written_exam_date', '【笔试】'),
            ('interview_date', '【面试】'),
        ]
        for ex in exams:
            if ex.get('stage') == 'ended':
                continue
            eid = str(ex.get('id') or '')
            title = str(ex.get('title') or '')
            org = str(ex.get('organizer') or '')
            sched = ex.get('schedule') or {}
            deep_url = f'{site}/exams?exam={eid}'
            src_url = str(ex.get('registration_url') or ex.get('source_url') or deep_url)

            for field, prefix in milestone_defs:
                raw_date = str(sched.get(field) or '').strip()[:10]
                if len(raw_date) != 10:
                    continue
                try:
                    start_d = dt.date.fromisoformat(raw_date)
                except ValueError:
                    continue
                end_d = start_d + dt.timedelta(days=1)
                uid_hash = hashlib.sha256(f'{eid}:{field}:{raw_date}'.encode('utf-8')).hexdigest()[:20]
                summary = f'{prefix}{title}'
                desc = f'主办：{org}\n工作台详情：{deep_url}\n官方入口：{src_url}'
                ics_events.append(
                    [
                        'BEGIN:VEVENT',
                        f'UID:exam-{uid_hash}@job-radar.local',
                        f'DTSTAMP:{dtstamp}',
                        f"DTSTART;VALUE=DATE:{start_d.strftime('%Y%m%d')}",
                        f"DTEND;VALUE=DATE:{end_d.strftime('%Y%m%d')}",
                        f'SUMMARY:{_ics_escape(summary)}',
                        f'DESCRIPTION:{_ics_escape(desc)}',
                        f'URL:{_ics_escape(deep_url)}',
                        'END:VEVENT',
                    ]
                )

    exams_rss = _build_rss_document(
        title='职讯雷达 · 山东考公考编招考订阅',
        link=f'{site}/exams',
        self_url=f'{site}/feeds/exams-shandong.xml',
        description='山东省 16 地市及国家级公务员、选调生、事业单位、教师、医疗招考公告实时更新源',
        now_dt=now_dt,
        items=exam_items,
    )
    (feeds_dir / 'exams-shandong.xml').write_text(exams_rss, encoding='utf-8')

    ics_lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Job Radar//Shandong Civil Exams Calendar//CN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:职讯雷达·山东考公考编考务日历',
        'X-WR-TIMEZONE:Asia/Shanghai',
    ]
    for ev in ics_events[:250]:
        ics_lines.extend(ev)
    ics_lines.append('END:VCALENDAR')
    folded_ics = '\r\n'.join(_fold_ics_line(line) for line in ics_lines) + '\r\n'
    (feeds_dir / 'exams-shandong.ics').write_bytes(folded_ics.encode('utf-8'))

    # 2. Jobs RSS
    jobs_snap, job_rows = _load_jobs_for_feed(public_dir)
    jobs_snap_dt = _parse_dt(jobs_snap.get('generated_at'), now_dt)
    jobs_snap_day = shanghai_day(jobs_snap.get('generated_at')) or now_dt.date().isoformat()
    active_jobs = sort_jobs_by_newest(
        [
            j
            for j in job_rows
            if j.get('listing_status') != 'withdrawn' and j.get('kind') != '宣讲会'
        ],
        jobs_snap_day,
    )
    job_items: List[Dict[str, str]] = []
    for j in active_jobs[:60]:
        jid = str(j.get('id') or '')
        title = str(j.get('title') or '')
        company = str(j.get('company') or '')
        cities = '、'.join(str(c) for c in (j.get('cities') or [])[:3]) or '地点见公告'
        dl = f"截止：{j['deadline']}" if j.get('deadline') else ''
        deep_url = f'{site}/?job={jid}'
        desc = ' · '.join(
            p
            for p in (
                company,
                cities,
                ' / '.join(str(t) for t in (j.get('types') or [])[:2]),
                dl,
                str(j.get('excerpt') or '')[:160],
            )
            if p
        )
        healed_day = healed_publication_day(j, jobs_snap_day)
        pub_dt = _parse_dt(healed_day or j.get('first_seen_at'), jobs_snap_dt)
        job_items.append(
            {
                'title': f'{company} · {title}' if company and company not in title else title,
                'link': deep_url,
                'guid': f'job-radar-job-{jid}',
                'pubDate': format_datetime(pub_dt),
                'description': desc,
            }
        )

    jobs_rss = _build_rss_document(
        title='职讯雷达 · 企业校招社招最新机会订阅',
        link=f'{site}/',
        self_url=f'{site}/feeds/jobs-latest.xml',
        description='山东及全国重点国央企、名企、高校就业网最新核验招聘机会更新源',
        now_dt=now_dt,
        items=job_items,
    )
    (feeds_dir / 'jobs-latest.xml').write_text(jobs_rss, encoding='utf-8')

    return {
        'exam_rss_items': len(exam_items),
        'exam_ics_events': len(ics_events[:250]),
        'job_rss_items': len(job_items),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--public-dir', type=Path, default=ROOT / 'public')
    parser.add_argument('--site', default=DEFAULT_SITE)
    args = parser.parse_args()
    res = build_feeds(args.public_dir, site_origin=args.site)
    print(
        f"Built static feeds: exam_rss={res['exam_rss_items']}, "
        f"exam_ics={res['exam_ics_events']}, job_rss={res['job_rss_items']}"
    )


if __name__ == '__main__':
    main()
