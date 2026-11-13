"""Build static first-screen edge snapshot and portable local SQLite database from validated snapshots."""
from __future__ import annotations

import argparse
from collections import Counter
import datetime as dt
import json
import os
from pathlib import Path
import re
import sqlite3
from typing import Any, Dict, Iterable, List, Optional

ROOT = Path(__file__).resolve().parents[1]
TZ = dt.timezone(dt.timedelta(hours=8))

NATIONWIDE_RE = re.compile(r'全国|各地|多地|不限地点|省内各地|全省|山东各地|山东省内')
FIRST_SCREEN_PAGE_SIZE = 60
_DATE_ONLY_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
_POS_READY_RE = re.compile(r'就绪|首次提取')


def _parse_iso_ms(value: Any) -> Optional[int]:
    if not value:
        return None
    s = str(value).strip()
    if not s:
        return None
    try:
        if _DATE_ONLY_RE.match(s):
            parsed = dt.datetime.fromisoformat(f'{s}T00:00:00+08:00')
        else:
            parsed = dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=TZ)
        return int(parsed.timestamp() * 1000)
    except Exception:
        return None


def shanghai_day(value: Any) -> str:
    if not value:
        return ''
    s = str(value).strip()
    if _DATE_ONLY_RE.match(s):
        return s
    ms = _parse_iso_ms(s)
    if ms is None:
        return ''
    return dt.datetime.fromtimestamp(ms / 1000, tz=TZ).date().isoformat()


def healed_publication_day(job: Dict[str, Any], snap_day: str) -> str:
    """Mirror frontend publicationDate() self-healing for silent ATS date refreshes."""
    raw_day = shanghai_day(job.get('published_at'))
    if not raw_day or (snap_day and raw_day > snap_day):
        return ''
    first_seen_day = shanghai_day(job.get('first_seen_at'))
    verified_day = shanghai_day(job.get('last_verified_at'))
    if first_seen_day and verified_day > first_seen_day and raw_day > first_seen_day:
        timeline = job.get('timeline')
        if isinstance(timeline, list):
            pub_days = sorted(
                d
                for d in (
                    shanghai_day(evt.get('date'))
                    for evt in timeline
                    if isinstance(evt, dict) and evt.get('type') == 'published'
                )
                if d and d <= first_seen_day
            )
            if pub_days:
                return pub_days[0]
        return first_seen_day
    return raw_day


def is_substantive_reopen_change(change: Any) -> bool:
    """Mirror frontend isSubstantiveReopenChange()."""
    if not isinstance(change, dict):
        return False
    ctype = change.get('type')
    label = str(change.get('label') or '')
    detail = str(change.get('detail') or '')
    if ctype == 'supplemental':
        return True
    if ctype == 'deadline_extended':
        if label == '明确截止时间' or detail.startswith('明确报名截止时间'):
            return False
        if label == '截止调整' or detail.startswith('报名截止时间调整为'):
            return False
        return True
    if ctype == 'positions_updated':
        return not _POS_READY_RE.search(label + detail) and '为 0 个职位' not in detail
    if ctype == 'content_updated':
        return label == '地点调整' and '新增' in detail
    return False


def substantive_boost_day(job: Dict[str, Any], snap_day: str) -> str:
    change = job.get('recent_change')
    if not is_substantive_reopen_change(change):
        return ''
    change_day = shanghai_day(change.get('date'))
    if not change_day or (snap_day and change_day > snap_day):
        return ''
    return change_day


def effective_job_newest_key(job: Dict[str, Any], snap_day: str) -> tuple[str, int]:
    pub_day = healed_publication_day(job, snap_day)
    boost_day = substantive_boost_day(job, snap_day)
    eff_day = boost_day if boost_day > pub_day else pub_day
    if not eff_day:
        return ('', 0)
    if eff_day > pub_day:
        tie_ms = _parse_iso_ms(job.get('updated_at')) or 0
    else:
        tie_ms = _parse_iso_ms(job.get('first_seen_at'))
        if tie_ms is None:
            tie_ms = _parse_iso_ms(job.get('published_at')) or 0
    return (eff_day, tie_ms)


def sort_jobs_by_newest(jobs: List[Dict[str, Any]], snap_day: str) -> List[Dict[str, Any]]:
    ordered = sorted(jobs, key=lambda r: str(r.get('id') or ''))
    ordered.sort(key=lambda r: effective_job_newest_key(r, snap_day), reverse=True)
    return ordered


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding='utf-8'))


def load_browsing_jobs_and_search(
    public_dir: Path,
    include_search: bool = True,
) -> tuple[Dict[str, Any], List[Dict[str, Any]], Dict[str, str]]:
    jobs_file = public_dir / 'jobs.json'
    if not jobs_file.is_file():
        raise FileNotFoundError(f'Missing {jobs_file}')
    snapshot = _load_json(jobs_file)

    browse = snapshot.get('browse_index') or {}
    rows: List[Dict[str, Any]] = []
    if isinstance(browse.get('shards'), list) and browse['shards']:
        for rel in browse['shards']:
            shard_obj = _load_json(public_dir / str(rel).lstrip('/'))
            rows.extend(shard_obj.get('jobs') or [])
    elif isinstance(snapshot.get('index_shards'), list) and snapshot['index_shards']:
        for rel in snapshot['index_shards']:
            shard_obj = _load_json(public_dir / str(rel).lstrip('/'))
            rows.extend(shard_obj.get('jobs') or [])
    else:
        rows = list(snapshot.get('jobs') or [])

    search_map: Dict[str, str] = {}
    if not include_search:
        return snapshot, rows, search_map

    search_paths: List[str] = []
    if isinstance(browse.get('search_shards'), list) and browse['search_shards']:
        search_paths = [str(p) for p in browse['search_shards']]
    elif isinstance(snapshot.get('search_shards'), list) and snapshot['search_shards']:
        search_paths = [str(p) for p in snapshot['search_shards']]
    elif snapshot.get('search_url'):
        search_paths = [str(snapshot['search_url'])]

    for rel in search_paths:
        p = public_dir / rel.lstrip('/')
        if p.is_file():
            obj = _load_json(p)
            for jid, text in (obj.get('jobs') or {}).items():
                if isinstance(text, str):
                    search_map[str(jid)] = text

    return snapshot, rows, search_map


def load_exams(public_dir: Path) -> tuple[Optional[Dict[str, Any]], List[Dict[str, Any]]]:
    exams_file = public_dir / 'exams.json'
    if not exams_file.is_file():
        return None, []
    snap = _load_json(exams_file)
    return snap, list(snap.get('exams') or [])


def _sql_literal(value: Any) -> str:
    if value is None:
        return 'NULL'
    if isinstance(value, bool):
        return '1' if value else '0'
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value).replace("'", "''")
    return f"'{text}'"


def _batched(items: List[tuple], size: int = 80) -> Iterable[List[tuple]]:
    for idx in range(0, len(items), size):
        yield items[idx : idx + size]


SCHEMA_STATEMENTS = [
    'DROP TABLE IF EXISTS meta;',
    'DROP TABLE IF EXISTS jobs_fts;',
    'DROP TABLE IF EXISTS jobs;',
    'DROP TABLE IF EXISTS exams;',
    """
    CREATE TABLE meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    """,
    """
    CREATE TABLE jobs (
        seq INTEGER PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        company TEXT NOT NULL,
        cities_pipe TEXT NOT NULL,
        has_cities INTEGER NOT NULL,
        nationwide INTEGER NOT NULL,
        kind TEXT NOT NULL,
        types_pipe TEXT NOT NULL,
        sectors_pipe TEXT NOT NULL,
        education TEXT NOT NULL,
        salary_min REAL,
        published_at TEXT NOT NULL,
        deadline TEXT NOT NULL,
        listing_status TEXT NOT NULL,
        search_text TEXT NOT NULL,
        row_json TEXT NOT NULL
    );
    """,
    'CREATE INDEX idx_jobs_published ON jobs(published_at DESC, seq ASC);',
    'CREATE INDEX idx_jobs_deadline ON jobs(deadline ASC);',
    'CREATE INDEX idx_jobs_education ON jobs(education);',
    'CREATE INDEX idx_jobs_kind ON jobs(kind);',
    """
    CREATE VIRTUAL TABLE jobs_fts USING fts5(
        id UNINDEXED,
        search_head,
        tokenize='trigram'
    );
    """,
    """
    CREATE TABLE exams (
        seq INTEGER PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        organizer TEXT NOT NULL,
        cities_pipe TEXT NOT NULL,
        exam_category TEXT NOT NULL,
        stage TEXT NOT NULL,
        published_at TEXT NOT NULL,
        reg_end TEXT NOT NULL,
        total_headcount INTEGER,
        search_text TEXT NOT NULL,
        row_json TEXT NOT NULL
    );
    """,
    'CREATE INDEX idx_exams_published ON exams(published_at DESC, seq ASC);',
]


def _slim_job_for_row(job: Dict[str, Any]) -> Dict[str, Any]:
    slim = {
        k: v
        for k, v in job.items()
        if k not in ('body', 'timeline', 'duplicate_sources', 'classification_note', 'structured', 'search_text')
    }
    if 'location_evidence' in slim and slim.get('listing_facts'):
        slim['location_evidence'] = []
    return slim


def build_radar_sqlite(
    public_dir: Path,
    output_sqlite: Optional[Path] = None,
    output_d1_sql: Optional[Path] = None,
    *,
    first_screen_only: bool = False,
    write_first_screen: bool = True,
) -> Dict[str, Any]:
    public_dir = Path(public_dir).resolve()
    need_sqlite = (not first_screen_only) and (output_sqlite is not None)
    if need_sqlite and output_sqlite is not None:
        output_sqlite = Path(output_sqlite).resolve()
        output_sqlite.parent.mkdir(parents=True, exist_ok=True)

    snapshot, job_rows, search_map = load_browsing_jobs_and_search(
        public_dir,
        include_search=need_sqlite,
    )
    snap_day = shanghai_day(snapshot.get('generated_at')) or dt.datetime.now(TZ).date().isoformat()
    job_rows = sort_jobs_by_newest(job_rows, snap_day)
    exam_snap, exam_rows = load_exams(public_dir) if need_sqlite else (None, [])

    city_counts: Counter[str] = Counter()
    type_counts: Counter[str] = Counter()
    sector_counts: Counter[str] = Counter()
    edu_counts: Counter[str] = Counter()
    kind_counts: Counter[str] = Counter()

    prepared_jobs: List[tuple] = []
    prepared_fts: List[tuple] = []
    first_screen_jobs: List[Dict[str, Any]] = []
    active_jobs_count = 0
    total_jobs_seen = 0

    seen_ids: set[str] = set()
    for job in job_rows:
        jid = str(job.get('id') or '').strip()
        if not jid or jid in seen_ids:
            continue
        seen_ids.add(jid)
        total_jobs_seen += 1
        seq = total_jobs_seen
        title = str(job.get('title') or '')
        company = str(job.get('company') or '')
        cities = [str(c) for c in (job.get('cities') or []) if c]
        kind = str(job.get('kind') or '招聘公告')
        types_list = [str(t) for t in (job.get('types') or []) if t]
        sectors_list = [str(s) for s in (job.get('sectors') or []) if s]
        education = str(job.get('education') or '未明确')
        listing_status = str(job.get('listing_status') or 'active')

        slim_job: Optional[Dict[str, Any]] = None
        if listing_status != 'withdrawn':
            active_jobs_count += 1
            for c_name in cities:
                city_counts[c_name] += 1
            for t_name in (types_list or ['未明确']):
                type_counts[t_name] += 1
            for s_name in (sectors_list or ['未明确']):
                sector_counts[s_name] += 1
            edu_counts[education] += 1
            kind_counts[kind] += 1
            if len(first_screen_jobs) < FIRST_SCREEN_PAGE_SIZE:
                slim_job = _slim_job_for_row(job)
                first_screen_jobs.append(slim_job)

        if not need_sqlite:
            continue

        cities_pipe = f"|{'|'.join(cities)}|" if cities else ''
        has_cities = 1 if cities else 0
        raw_loc = f"{title} {job.get('excerpt') or ''}"
        nationwide = 1 if (
            job.get('province_possible')
            or bool(job.get('possible_cities'))
            or (not cities and NATIONWIDE_RE.search(raw_loc))
        ) else 0

        types_pipe = f"|{'|'.join(types_list)}|" if types_list else ''
        sectors_pipe = f"|{'|'.join(sectors_list)}|" if sectors_list else ''
        published_at, _ = effective_job_newest_key(job, snap_day)
        deadline = str(job.get('deadline') or '')

        salary_min: Optional[float] = None
        lf_sal = ((job.get('listing_facts') or {}).get('salary') or {}).get('min')
        if isinstance(lf_sal, (int, float)):
            salary_min = float(lf_sal)

        majors_str = ' '.join(str(m) for m in (job.get('majors') or [])[:12] if m)
        directions_str = ' '.join(str(d) for d in (job.get('directions') or [])[:8] if d)
        sample_pos = ' '.join(str(p) for p in (job.get('sample_positions') or [])[:6] if p)
        search_head = ' '.join(
            part
            for part in (
                title,
                company,
                ' '.join(cities),
                majors_str,
                directions_str,
                sample_pos,
            )
            if part
        ).lower()[:240]

        full_search_tail = (search_map.get(jid) or '')[:320]
        search_text = f"{search_head} {str(job.get('excerpt') or '').lower()} {full_search_tail}".strip()[:480]

        if slim_job is None:
            slim_job = _slim_job_for_row(job)
        row_json = json.dumps(slim_job, ensure_ascii=False, separators=(',', ':'))
        prepared_jobs.append(
            (
                seq,
                jid,
                title,
                company,
                cities_pipe,
                has_cities,
                nationwide,
                kind,
                types_pipe,
                sectors_pipe,
                education,
                salary_min,
                published_at,
                deadline,
                listing_status,
                search_text,
                row_json,
            )
        )
        prepared_fts.append((jid, search_head))

    facets_payload = {
        'cities': dict(city_counts.most_common(60)),
        'types': dict(type_counts),
        'sectors': dict(sector_counts),
        'educations': dict(edu_counts),
        'kinds': dict(kind_counts),
    }

    first_screen_bytes = 0
    if write_first_screen:
        first_screen_payload = {
            'ok': True,
            'engine': 'static-edge',
            'generated_at': str(snapshot.get('generated_at') or ''),
            'total': active_jobs_count,
            'page': 1,
            'pageSize': FIRST_SCREEN_PAGE_SIZE,
            'jobs': first_screen_jobs,
            'facets': facets_payload,
        }
        raw_first = json.dumps(first_screen_payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        first_screen_path = public_dir / 'first-screen.json'
        tmp_first = public_dir / f'first-screen.json.tmp-{os.getpid()}'
        tmp_first.write_bytes(raw_first)
        os.replace(tmp_first, first_screen_path)
        first_screen_bytes = len(raw_first)

    if not need_sqlite or output_sqlite is None:
        return {
            'jobs_count': total_jobs_seen,
            'active_jobs_count': active_jobs_count,
            'exams_count': 0,
            'sqlite_bytes': 0,
            'first_screen_bytes': first_screen_bytes,
            'jobs_generated_at': str(snapshot.get('generated_at') or ''),
        }

    prepared_exams: List[tuple] = []
    seen_exam_ids: set[str] = set()
    for ex in exam_rows:
        eid = str(ex.get('id') or '').strip()
        if not eid or eid in seen_exam_ids:
            continue
        seen_exam_ids.add(eid)
        seq = len(prepared_exams) + 1
        title = str(ex.get('title') or '')
        organizer = str(ex.get('organizer') or '')
        cities = [str(c) for c in (ex.get('cities') or []) if c]
        cities_pipe = f"|{'|'.join(cities)}|" if cities else ''
        exam_category = str(ex.get('exam_category') or '')
        stage = str(ex.get('stage') or 'unknown')
        published_at = str(ex.get('published_at') or '')
        reg_end = str(((ex.get('schedule') or {}).get('reg_end')) or '')
        hc = ex.get('total_headcount')
        total_headcount = int(hc) if isinstance(hc, (int, float)) else None
        search_text = ' '.join(
            part
            for part in (
                title,
                organizer,
                exam_category,
                ' '.join(cities),
                ' '.join(str(m) for m in (ex.get('majors') or [])[:15] if m),
                str(ex.get('excerpt') or ''),
            )
            if part
        ).lower()[:360]
        row_json = json.dumps(ex, ensure_ascii=False, separators=(',', ':'))
        prepared_exams.append(
            (
                seq,
                eid,
                title,
                organizer,
                cities_pipe,
                exam_category,
                stage,
                published_at,
                reg_end,
                total_headcount,
                search_text,
                row_json,
            )
        )

    meta_rows = [
        ('schema_version', '1'),
        ('jobs_generated_at', str(snapshot.get('generated_at') or '')),
        ('jobs_total', str(len(prepared_jobs))),
        ('exams_generated_at', str((exam_snap or {}).get('generated_at') or '')),
        ('exams_total', str(len(prepared_exams))),
        ('facets_json', json.dumps(facets_payload, ensure_ascii=False, separators=(',', ':'))),
    ]

    tmp_sqlite = output_sqlite.with_suffix('.sqlite.tmp')
    if tmp_sqlite.exists():
        tmp_sqlite.unlink()

    conn = sqlite3.connect(str(tmp_sqlite))
    try:
        conn.execute('PRAGMA journal_mode = OFF;')
        conn.execute('PRAGMA synchronous = OFF;')
        for stmt in SCHEMA_STATEMENTS:
            conn.execute(stmt)
        conn.executemany('INSERT INTO meta (key, value) VALUES (?, ?);', meta_rows)
        conn.executemany(
            """
            INSERT INTO jobs (
                seq, id, title, company, cities_pipe, has_cities, nationwide,
                kind, types_pipe, sectors_pipe, education, salary_min,
                published_at, deadline, listing_status, search_text, row_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """,
            prepared_jobs,
        )
        conn.executemany('INSERT INTO jobs_fts (id, search_head) VALUES (?, ?);', prepared_fts)
        conn.executemany(
            """
            INSERT INTO exams (
                seq, id, title, organizer, cities_pipe, exam_category,
                stage, published_at, reg_end, total_headcount, search_text, row_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """,
            prepared_exams,
        )
        conn.commit()
        conn.execute('PRAGMA journal_mode = DELETE;')
        conn.execute('VACUUM;')
    finally:
        conn.close()

    os.replace(tmp_sqlite, output_sqlite)

    if output_d1_sql is not None:
        output_d1_sql = Path(output_d1_sql).resolve()
        output_d1_sql.parent.mkdir(parents=True, exist_ok=True)
        lines: List[str] = [stmt.strip() for stmt in SCHEMA_STATEMENTS]
        for batch in _batched(meta_rows, 50):
            vals = ','.join(f"({_sql_literal(k)},{_sql_literal(v)})" for k, v in batch)
            lines.append(f'INSERT INTO meta (key, value) VALUES {vals};')
        for batch in _batched(prepared_jobs, 40):
            vals = ','.join(f"({','.join(_sql_literal(col) for col in row)})" for row in batch)
            lines.append(
                'INSERT INTO jobs (seq,id,title,company,cities_pipe,has_cities,nationwide,'
                'kind,types_pipe,sectors_pipe,education,salary_min,published_at,deadline,listing_status,search_text,row_json) '
                f'VALUES {vals};'
            )
        for batch in _batched(prepared_fts, 60):
            vals = ','.join(f"({_sql_literal(jid)},{_sql_literal(st)})" for jid, st in batch)
            lines.append(f'INSERT INTO jobs_fts (id, search_head) VALUES {vals};')
        for batch in _batched(prepared_exams, 40):
            vals = ','.join(f"({','.join(_sql_literal(col) for col in row)})" for row in batch)
            lines.append(
                'INSERT INTO exams (seq,id,title,organizer,cities_pipe,exam_category,'
                'stage,published_at,reg_end,total_headcount,search_text,row_json) '
                f'VALUES {vals};'
            )
        output_d1_sql.write_text('\n'.join(lines) + '\n', encoding='utf-8')

    return {
        'jobs_count': len(prepared_jobs),
        'active_jobs_count': active_jobs_count,
        'exams_count': len(prepared_exams),
        'sqlite_bytes': output_sqlite.stat().st_size,
        'first_screen_bytes': first_screen_bytes,
        'jobs_generated_at': str(snapshot.get('generated_at') or ''),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--public-dir', type=Path, default=ROOT / 'public')
    parser.add_argument('--output-sqlite', type=Path, default=ROOT / 'data' / 'radar.sqlite')
    parser.add_argument('--output-d1-sql', type=Path, default=None)
    parser.add_argument(
        '--first-screen-only',
        action='store_true',
        help='Write static public/first-screen.json without building local radar.sqlite',
    )
    args = parser.parse_args()

    res = build_radar_sqlite(
        public_dir=args.public_dir,
        output_sqlite=None if args.first_screen_only else args.output_sqlite,
        output_d1_sql=args.output_d1_sql,
        first_screen_only=args.first_screen_only,
    )
    if args.first_screen_only:
        print(
            f"Built static first-screen.json: active_jobs={res['active_jobs_count']}, "
            f"size={res['first_screen_bytes'] / 1024:.1f} KiB, generated_at={res['jobs_generated_at']}"
        )
    else:
        print(
            f"Built radar.sqlite & first-screen.json: jobs={res['jobs_count']}, exams={res['exams_count']}, "
            f"sqlite={res['sqlite_bytes'] / (1024 * 1024):.2f} MiB, "
            f"first_screen={res['first_screen_bytes'] / 1024:.1f} KiB, generated_at={res['jobs_generated_at']}"
        )


if __name__ == '__main__':
    main()
