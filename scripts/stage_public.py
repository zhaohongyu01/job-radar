"""Bind the validated current snapshot to a separately built Cloudflare worker."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

try:
    from snapshot_assets import ASSET, asset_paths, MAX_ASSET_BYTES
except ImportError:
    from scripts.snapshot_assets import ASSET, asset_paths, MAX_ASSET_BYTES


def stage(public, dist):
    public, dist = Path(public).resolve(), Path(dist).resolve()
    config = json.loads((dist/'server/wrangler.json').read_text(encoding='utf-8'))
    destination = (dist/'server'/config['assets']['directory']).resolve()
    if not destination.is_relative_to(dist) or destination == dist:
        raise ValueError('Worker asset directory must stay inside dist')
    snapshot = json.loads((public/'jobs.json').read_text(encoding='utf-8'))
    metadata = json.loads((public/'snapshot-manifest.json').read_text(encoding='utf-8'))
    if hashlib.sha256((public/'jobs.json').read_bytes()).hexdigest() != metadata['index_sha256']:
        raise ValueError('Snapshot manifest mismatch')
    paths = asset_paths(snapshot)
    for path in ['jobs.json', 'snapshot-manifest.json', *paths]:
        source = public/path.lstrip('/')
        if not source.resolve().is_relative_to(public):
            raise ValueError('Asset path escaped public directory')
        if source.stat().st_size > MAX_ASSET_BYTES:
            raise ValueError(f'Asset exceeds 25 MiB: {path}')
    for path in paths:
        match = ASSET.fullmatch(path)
        if not match:
            raise ValueError('Unexpected snapshot asset path')
        source = public/path.lstrip('/')
        if not source.resolve().is_relative_to(public) or hashlib.sha256(source.read_bytes()).hexdigest()[:20] != match[1]:
            raise ValueError('Snapshot asset is missing or corrupt: ' + path)
    assets = destination/'job-assets'
    assets.mkdir(parents=True, exist_ok=True)
    # Remove only generated obsolete JSON files, after checking their resolved
    # targets. Frontend bundles, logos and other public assets are untouched.
    for old in assets.glob('*.json'):
        if not old.resolve().is_relative_to(destination):
            raise ValueError('Asset path escaped the built client directory')
        if ASSET.fullmatch('/job-assets/'+old.name) and '/job-assets/'+old.name not in paths:
            old.unlink()
    for path in paths:
        shutil.copy2(public/path.lstrip('/'), destination/path.lstrip('/'))
    for name in ('jobs.json', 'snapshot-manifest.json'):
        shutil.copy2(public/name, destination/name)
    for path in destination.rglob('*'):
        if path.is_file() and path.stat().st_size > MAX_ASSET_BYTES:
            raise ValueError(f'Built asset exceeds 25 MiB: {path.relative_to(destination)}')
    print(f'Staged {snapshot.get("index_count", len(snapshot["jobs"]))} announcements and {len(paths)} immutable data assets')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--public-dir', type=Path, default=Path('public'))
    parser.add_argument('--dist-dir', type=Path, default=Path('dist'))
    args = parser.parse_args()
    stage(args.public_dir, args.dist_dir)
