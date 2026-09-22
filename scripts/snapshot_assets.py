"""Shared immutable snapshot paths and bounded JSON chunks."""
import json
import re

ASSET = re.compile(r'/job-assets/(?:detail-[0-9a-f]{2}|search|index)-([0-9a-f]{20})\.json')
MAX_ASSET_BYTES = 25 * 1024 * 1024
CHUNK_BYTES = 4 * 1024 * 1024


def asset_paths(snapshot):
    return {*snapshot['detail_shards'].values(), snapshot['search_url'],
            *snapshot.get('index_shards', []), *snapshot.get('search_shards', [])}


def chunks(rows, budget=CHUNK_BYTES):
    batch, size = [], 32
    for row in rows:
        length = len(json.dumps(row, ensure_ascii=False, separators=(',', ':')).encode('utf-8')) + 1
        if batch and size + length > budget:
            yield batch
            batch, size = [], 32
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
