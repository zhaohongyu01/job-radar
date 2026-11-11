"""Shared immutable snapshot paths and bounded JSON chunks."""
import json
import re

ASSET = re.compile(r'/job-assets/(?:detail-[0-9a-f]{2}|search|index|coverage)-([0-9a-f]{20})\.json')
EXAM_DETAIL_ASSET = re.compile(r'^/exam-assets/detail-[0-9a-z]{2}-([0-9a-f]{20})\.json$')
EXAM_POSITIONS_ASSET = re.compile(r'^/exam-assets/positions-([0-9a-f]{20})\.json$')
EXAM_ASSET = re.compile(r'^/exam-assets/(?:detail-[0-9a-z]{2}|positions)-([0-9a-f]{20})\.json$')
MAX_ASSET_BYTES = 25 * 1024 * 1024
CHUNK_BYTES = 4 * 1024 * 1024
FIRST_INDEX_BYTES = 256 * 1024


def asset_paths(snapshot):
    browse = snapshot.get('browse_index') or {}
    return {*snapshot['detail_shards'].values(), snapshot['search_url'],
            *snapshot.get('index_shards', []), *snapshot.get('search_shards', []),
            *browse.get('shards', []), *browse.get('search_shards', []),
            *([snapshot['coverage_url']] if snapshot.get('coverage_url') else [])}


def exam_asset_paths(exam_snapshot):
    snap = exam_snapshot or {}
    shards = snap.get('detail_shards') or {}
    if not isinstance(shards, dict):
        raise ValueError('Invalid exam detail_shards map')
    paths = set(shards.values())
    positions_url = snap.get('positions_url')
    if positions_url is not None:
        if not isinstance(positions_url, str) or not EXAM_POSITIONS_ASSET.fullmatch(positions_url):
            raise ValueError('Invalid exam positions_url')
        paths.add(positions_url)
    return paths


def hydrate_exam_snapshot(exam_snapshot, load):
    snap = dict(exam_snapshot or {})
    exams = [dict(e) for e in (snap.get('exams') or []) if isinstance(e, dict)]
    detail_shards = snap.get('detail_shards') or {}
    shard_cache = {}
    for prefix, rel_path in detail_shards.items():
        if not EXAM_DETAIL_ASSET.fullmatch(rel_path):
            raise ValueError(f'Invalid exam detail shard path: {rel_path}')
        shard_cache[prefix] = (load(rel_path) or {}).get('exams') or {}

    positions_by_exam = {}
    positions_url = snap.get('positions_url')
    if positions_url:
        if not EXAM_POSITIONS_ASSET.fullmatch(positions_url):
            raise ValueError(f'Invalid exam positions_url: {positions_url}')
        pos_data = load(positions_url) or {}
        positions_by_exam = pos_data.get('positions_by_exam') or {}

    for ex in exams:
        eid = str(ex.get('id') or '')
        cleaned = re.sub(r'[^0-9a-z]', '0', eid.lower())
        prefix = (cleaned + '00')[:2]
        detail_entry = (shard_cache.get(prefix) or {}).get(eid) or (shard_cache.get(eid[:2]) or {}).get(eid) or {}
        for field in ('body', 'attachments', 'links', 'positions'):
            if ex.get(field) is None and detail_entry.get(field) is not None:
                ex[field] = detail_entry[field]
        if ex.get('positions') is None:
            ex['positions'] = list(positions_by_exam.get(eid) or [])
    snap['exams'] = exams
    return snap


def chunks(rows, budget=CHUNK_BYTES, *, first_budget=None):
    batch, size = [], 32
    limit = first_budget if first_budget is not None else budget
    for row in rows:
        length = len(json.dumps(row, ensure_ascii=False, separators=(',', ':')).encode('utf-8')) + 1
        if batch and size + length > limit:
            yield batch
            batch, size = [], 32
            limit = budget
        batch.append(row)
        size += length
    if batch:
        yield batch


def hydrate_index(snapshot, load):
    if not snapshot.get('index_shards'):
        return snapshot
    rows = []
    for path in snapshot['index_shards']:
        if not re.fullmatch(r'/job-assets/index-[0-9a-f]{20}\.json', path):
            raise ValueError('Invalid index shard path')
        rows.extend(load(path)['jobs'])
    if len(rows) != snapshot.get('index_count') or len({j['id'] for j in rows}) != len(rows):
        raise ValueError('Listing index is incomplete or contains duplicate identities')
    return dict(snapshot, jobs=rows)
