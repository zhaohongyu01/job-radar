"""Provision Cloudflare D1 database, run quota-safe incremental diff sync, and bind wrangler.json."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple
import urllib.error
import urllib.parse
import urllib.request

CF_API_BASE = 'https://api.cloudflare.com/client/v4'
MAX_SINGLE_STMT_BYTES = 50_000
MAX_REQUEST_SQL_BYTES = 200_000
MAX_ROWS_PER_INSERT = 15

D1_SCHEMA_STMTS = [
    """
    CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    """,
    """
    CREATE TABLE IF NOT EXISTS jobs (
        seq INTEGER NOT NULL,
        id TEXT PRIMARY KEY,
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
        row_json TEXT NOT NULL,
        row_hash TEXT NOT NULL DEFAULT ''
    );
    """,
    'CREATE INDEX IF NOT EXISTS idx_jobs_seq ON jobs(seq ASC);',
    'CREATE INDEX IF NOT EXISTS idx_jobs_deadline ON jobs(deadline ASC);',
    'CREATE INDEX IF NOT EXISTS idx_jobs_education ON jobs(education);',
    'CREATE INDEX IF NOT EXISTS idx_jobs_kind ON jobs(kind);',
    """
    CREATE TABLE IF NOT EXISTS exams (
        seq INTEGER NOT NULL,
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        organizer TEXT NOT NULL,
        cities_pipe TEXT NOT NULL,
        exam_category TEXT NOT NULL,
        stage TEXT NOT NULL,
        published_at TEXT NOT NULL,
        reg_end TEXT NOT NULL,
        total_headcount INTEGER,
        search_text TEXT NOT NULL,
        row_json TEXT NOT NULL,
        row_hash TEXT NOT NULL DEFAULT ''
    );
    """,
    'CREATE INDEX IF NOT EXISTS idx_exams_seq ON exams(seq ASC);',
]


def sql_literal(value: Any) -> str:
    if value is None:
        return 'NULL'
    if isinstance(value, bool):
        return '1' if value else '0'
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value).replace("'", "''")
    return f"'{text}'"


def compute_row_hash(cols: Sequence[Any]) -> str:
    raw = '|'.join('' if c is None else str(c) for c in cols)
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()[:16]


def build_bounded_upsert_statements(
    table: str,
    columns: Sequence[str],
    rows_with_hash: Sequence[Tuple[Any, ...]],
) -> List[str]:
    if not rows_with_hash:
        return []
    col_list = ','.join(columns)
    prefix = f'INSERT OR REPLACE INTO {table} ({col_list}) VALUES '
    statements: List[str] = []
    current_vals: List[str] = []
    current_bytes = len(prefix.encode('utf-8')) + 2

    for row in rows_with_hash:
        tuple_sql = f"({','.join(sql_literal(v) for v in row)})"
        tuple_bytes = len(tuple_sql.encode('utf-8')) + 1
        if current_vals and (
            len(current_vals) >= MAX_ROWS_PER_INSERT
            or current_bytes + tuple_bytes > MAX_SINGLE_STMT_BYTES
        ):
            statements.append(prefix + ','.join(current_vals) + ';')
            current_vals = []
            current_bytes = len(prefix.encode('utf-8')) + 2
        current_vals.append(tuple_sql)
        current_bytes += tuple_bytes

    if current_vals:
        statements.append(prefix + ','.join(current_vals) + ';')
    return statements


def build_delete_statements(table: str, ids_to_delete: Sequence[str], batch_size: int = 100) -> List[str]:
    stmts: List[str] = []
    sorted_ids = sorted(ids_to_delete)
    for idx in range(0, len(sorted_ids), batch_size):
        chunk = sorted_ids[idx : idx + batch_size]
        in_list = ','.join(sql_literal(i) for i in chunk)
        stmts.append(f'DELETE FROM {table} WHERE id IN ({in_list});')
    return stmts


def compute_table_diff_sql(
    table: str,
    columns_without_hash: Sequence[str],
    local_rows: Sequence[Tuple[Any, ...]],
    remote_hashes: Dict[str, str],
    id_col_index: int = 1,
) -> Tuple[List[str], Dict[str, int]]:
    local_ids: set[str] = set()
    to_upsert: List[Tuple[Any, ...]] = []

    for row in local_rows:
        row_id = str(row[id_col_index])
        local_ids.add(row_id)
        r_hash = compute_row_hash(row)
        if remote_hashes.get(row_id) != r_hash:
            to_upsert.append((*row, r_hash))

    to_delete = [rid for rid in remote_hashes if rid not in local_ids]
    stmts: List[str] = []
    stmts.extend(build_delete_statements(table, to_delete))
    stmts.extend(
        build_bounded_upsert_statements(
            table,
            [*columns_without_hash, 'row_hash'],
            to_upsert,
        )
    )
    stats = {
        'local_total': len(local_rows),
        'remote_total': len(remote_hashes),
        'upserted': len(to_upsert),
        'deleted': len(to_delete),
        'unchanged': len(local_rows) - len(to_upsert),
    }
    return stmts, stats


def pack_sql_batches(statements: Sequence[str]) -> List[str]:
    batches: List[str] = []
    cur: List[str] = []
    cur_bytes = 0
    for s in statements:
        stmt = s.strip()
        if not stmt:
            continue
        b_len = len(stmt.encode('utf-8')) + 1
        if cur and cur_bytes + b_len > MAX_REQUEST_SQL_BYTES:
            batches.append('\n'.join(cur))
            cur = []
            cur_bytes = 0
        cur.append(stmt)
        cur_bytes += b_len
    if cur:
        batches.append('\n'.join(cur))
    return batches


def patch_wrangler_d1_binding(
    wrangler_path: Path,
    db_name: str,
    db_id: str,
    binding: str = 'DB',
) -> bool:
    if not wrangler_path.is_file():
        return False
    cfg = json.loads(wrangler_path.read_text(encoding='utf-8'))
    cfg['d1_databases'] = [
        {
            'binding': binding,
            'database_name': db_name,
            'database_id': db_id,
        }
    ]
    tmp = wrangler_path.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(tmp, wrangler_path)
    return True


class CloudflareD1Client:
    def __init__(self, account_id: str, api_token: str):
        self.account_id = account_id.strip()
        self.api_token = api_token.strip()

    def _request(self, method: str, path: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        url = f'{CF_API_BASE}/accounts/{self.account_id}{path}'
        data = json.dumps(payload, ensure_ascii=False).encode('utf-8') if payload is not None else None
        headers = {
            'Authorization': f'Bearer {self.api_token}',
            'Content-Type': 'application/json',
            'User-Agent': 'job-radar-d1-sync/1.0',
        }
        last_err: Optional[Exception] = None
        for attempt in range(3):
            req = urllib.request.Request(url, data=data, headers=headers, method=method)
            try:
                with urllib.request.urlopen(req, timeout=45) as resp:
                    return json.loads(resp.read().decode('utf-8'))
            except urllib.error.HTTPError as exc:
                body_text = ''
                try:
                    body_text = exc.read().decode('utf-8', 'replace')
                except Exception:
                    pass
                if exc.code in (429, 500, 502, 503, 504) and attempt < 2:
                    time.sleep(1.5 * (attempt + 1))
                    last_err = RuntimeError(f'HTTP {exc.code}: {body_text[:240]}')
                    continue
                raise PermissionError(f'Cloudflare D1 HTTP {exc.code}: {body_text[:300]}') from exc
            except Exception as exc:
                last_err = exc
                if attempt < 2:
                    time.sleep(1.5 * (attempt + 1))
                    continue
                raise
        raise RuntimeError(f'Cloudflare D1 request failed: {last_err}')

    def ensure_database(self, db_name: str, configured_id: str = '') -> str:
        if configured_id:
            return configured_id
        qs = urllib.parse.urlencode({'name': db_name})
        listed = self._request('GET', f'/d1/database?{qs}')
        for item in listed.get('result') or []:
            if isinstance(item, dict) and item.get('name') == db_name and item.get('uuid'):
                return str(item['uuid'])
        created = self._request('POST', '/d1/database', {'name': db_name})
        uuid = (created.get('result') or {}).get('uuid')
        if not uuid:
            raise RuntimeError(f'Failed to create D1 database {db_name}: {created}')
        return str(uuid)

    def query(self, db_id: str, sql: str) -> List[Dict[str, Any]]:
        res = self._request('POST', f'/d1/database/{db_id}/query', {'sql': sql})
        if not res.get('success'):
            raise RuntimeError(f"D1 query error: {res.get('errors')}")
        return list(res.get('result') or [])


JOB_COLS = (
    'seq',
    'id',
    'title',
    'company',
    'cities_pipe',
    'has_cities',
    'nationwide',
    'kind',
    'types_pipe',
    'sectors_pipe',
    'education',
    'salary_min',
    'published_at',
    'deadline',
    'listing_status',
    'search_text',
    'row_json',
)

EXAM_COLS = (
    'seq',
    'id',
    'title',
    'organizer',
    'cities_pipe',
    'exam_category',
    'stage',
    'published_at',
    'reg_end',
    'total_headcount',
    'search_text',
    'row_json',
)


def sync_sqlite_to_d1(
    sqlite_path: Path,
    client: CloudflareD1Client,
    db_id: str,
    mode: str = 'all',
) -> Dict[str, Any]:
    conn = sqlite3.connect(str(sqlite_path))
    try:
        meta_rows = conn.execute('SELECT key, value FROM meta').fetchall()
        exam_rows = conn.execute(f"SELECT {','.join(EXAM_COLS)} FROM exams ORDER BY seq ASC").fetchall()
        job_rows = (
            conn.execute(
                f"SELECT {','.join(JOB_COLS)} FROM jobs WHERE listing_status != 'withdrawn' ORDER BY seq ASC"
            ).fetchall()
            if mode == 'all'
            else []
        )
    finally:
        conn.close()

    # Ensure tables & check if row_hash column exists on existing tables
    client.query(db_id, '\n'.join(s.strip() for s in D1_SCHEMA_STMTS))
    for tbl in ('jobs', 'exams'):
        info_res = client.query(db_id, f'PRAGMA table_info({tbl});')
        cols = {r.get('name') for r in (info_res[0].get('results') or [])} if info_res else set()
        if cols and 'row_hash' not in cols:
            client.query(db_id, f'DROP TABLE IF EXISTS {tbl};')
            client.query(db_id, '\n'.join(s.strip() for s in D1_SCHEMA_STMTS))

    all_stmts: List[str] = []
    summary: Dict[str, Any] = {'db_id': db_id, 'mode': mode}

    if mode == 'all':
        rem_jobs_res = client.query(db_id, 'SELECT id, row_hash FROM jobs;')
        rem_jobs = {
            str(r['id']): str(r.get('row_hash') or '')
            for r in ((rem_jobs_res[0].get('results') or []) if rem_jobs_res else [])
            if r.get('id')
        }
        job_stmts, job_stats = compute_table_diff_sql('jobs', JOB_COLS, job_rows, rem_jobs, id_col_index=1)
        all_stmts.extend(job_stmts)
        summary['jobs'] = job_stats

    rem_exams_res = client.query(db_id, 'SELECT id, row_hash FROM exams;')
    rem_exams = {
        str(r['id']): str(r.get('row_hash') or '')
        for r in ((rem_exams_res[0].get('results') or []) if rem_exams_res else [])
        if r.get('id')
    }
    exam_stmts, exam_stats = compute_table_diff_sql('exams', EXAM_COLS, exam_rows, rem_exams, id_col_index=1)
    all_stmts.extend(exam_stmts)
    summary['exams'] = exam_stats

    # Update meta keys last so readers only see new generated_at once rows are committed
    filtered_meta = [
        (k, v)
        for k, v in meta_rows
        if mode == 'all' or k in ('schema_version', 'exams_generated_at', 'exams_total')
    ]
    if filtered_meta:
        meta_vals = ','.join(f'({sql_literal(k)},{sql_literal(v)})' for k, v in filtered_meta)
        all_stmts.append(f'INSERT OR REPLACE INTO meta (key, value) VALUES {meta_vals};')

    batches = pack_sql_batches(all_stmts)
    for idx, sql_batch in enumerate(batches, 1):
        client.query(db_id, sql_batch)
        if idx % 20 == 0 or idx == len(batches):
            print(f'Executed D1 batch {idx}/{len(batches)} ({len(sql_batch.encode("utf-8")) // 1024} KiB)')

    summary['batches_executed'] = len(batches)
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sqlite-path', type=Path, required=True)
    parser.add_argument('--wrangler-config', type=Path, default=None)
    parser.add_argument('--mode', choices=('all', 'exams-only'), default='all')
    parser.add_argument('--db-name', default=os.environ.get('CF_D1_DATABASE_NAME') or 'job-radar-db')
    parser.add_argument('--db-id', default=os.environ.get('CF_D1_DATABASE_ID') or '')
    args = parser.parse_args()

    token = (os.environ.get('CLOUDFLARE_API_TOKEN') or '').strip()
    account_id = (os.environ.get('CLOUDFLARE_ACCOUNT_ID') or '').strip()
    db_name = (args.db_name or 'job-radar-db').strip()
    configured_id = (args.db_id or '').strip()

    if not token or not account_id:
        print('Skipping Cloudflare D1 sync: CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID is not set.')
        return

    client = CloudflareD1Client(account_id=account_id, api_token=token)
    try:
        db_id = client.ensure_database(db_name=db_name, configured_id=configured_id)
        print(f'Resolved Cloudflare D1 database: {db_name} ({db_id})')
        summary = sync_sqlite_to_d1(
            sqlite_path=args.sqlite_path,
            client=client,
            db_id=db_id,
            mode=args.mode,
        )
        print(f'Cloudflare D1 incremental sync complete: {json.dumps(summary, ensure_ascii=False)}')
        if args.wrangler_config is not None:
            patched = patch_wrangler_d1_binding(args.wrangler_config, db_name=db_name, db_id=db_id)
            if patched:
                print(f'Bound D1 database {db_name} ({db_id}) into {args.wrangler_config}')
    except PermissionError as exc:
        print(
            f'::warning::Cloudflare API Token lacks D1 permission ({exc}). '
            'Add Account -> D1 -> Edit permission to CLOUDFLARE_API_TOKEN in Cloudflare Dashboard to enable D1.'
        )
    except Exception as exc:
        print(f'::warning::Cloudflare D1 sync skipped due to error (static fallback remains active): {exc}')


if __name__ == '__main__':
    main()
