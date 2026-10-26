"""Strict local snapshot loading shared by audits and offline reprojection."""
import hashlib
import json
from pathlib import Path
from snapshot_assets import ASSET, asset_paths, hydrate_index


def read_public(directory):
    directory = Path(directory).resolve()
    raw = (directory / 'jobs.json').read_bytes()
    manifest = json.loads((directory / 'snapshot-manifest.json').read_bytes())
    if hashlib.sha256(raw).hexdigest() != manifest.get('index_sha256'):
        raise ValueError('Snapshot manifest mismatch')
    snapshot = json.loads(raw)
    cache = {}

    def load(path):
        match = ASSET.fullmatch(path)
        target = (directory / path.lstrip('/')).resolve()
        if not match or not target.is_relative_to(directory):
            raise ValueError('Invalid snapshot asset path')
        if path not in cache:
            content = target.read_bytes()
            if hashlib.sha256(content).hexdigest()[:20] != match[1]:
                raise ValueError('Snapshot asset hash mismatch: ' + path)
            cache[path] = json.loads(content)
        return cache[path]

    # Validate every referenced asset, including search and optional reports.
    for path in asset_paths(snapshot):
        load(path)
    return hydrate_index(snapshot, load), load
