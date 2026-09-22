"""Download the exact published snapshot for a deployment without collection."""
import argparse
import hashlib
import json
from pathlib import Path
import re
from urllib.request import Request, urlopen

try:
    from stage_public import ASSET, asset_paths
except ImportError:
    from scripts.stage_public import ASSET, asset_paths

USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'


def download(site, public):
    if not re.fullmatch(r'https://[a-zA-Z0-9.-]+', site):
        raise ValueError('Expected a plain HTTPS origin')
    public = Path(public)

    def fetch(path):
        request = Request(site + path, headers={'User-Agent': USER_AGENT, 'Cache-Control': 'no-cache'})
        with urlopen(request, timeout=30) as response:
            return response.read()

    metadata_raw = fetch('/snapshot-manifest.json')
    metadata = json.loads(metadata_raw)
    index = fetch('/jobs.json')
    if metadata.get('schema_version') != 1 or hashlib.sha256(index).hexdigest() != metadata.get('index_sha256'):
        raise ValueError('Published snapshot manifest mismatch; deployment stopped')
    snapshot = json.loads(index)
    paths = asset_paths(snapshot)
    from concurrent.futures import ThreadPoolExecutor

    def fetch_asset(path):
        match = ASSET.fullmatch(path)
        if not match:
            raise ValueError('Invalid published asset path')
        raw = fetch(path)
        if hashlib.sha256(raw).hexdigest()[:20] != match[1]:
            raise ValueError('Published asset hash mismatch')
        target = public / path.lstrip('/')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)

    # Never fall back to the older files checked into the repository.
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(fetch_asset, sorted(paths)))
    public.mkdir(parents=True, exist_ok=True)
    (public / 'jobs.json').write_bytes(index)
    (public / 'snapshot-manifest.json').write_bytes(metadata_raw)
    print(f'Reused published snapshot with {snapshot.get("index_count", len(snapshot["jobs"]))} records; no collection performed')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site', required=True)
    parser.add_argument('--public-dir', type=Path, required=True)
    args = parser.parse_args()
    download(args.site, args.public_dir)
