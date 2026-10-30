"""Read only the public browsing index for queue planning, within a fixed budget.
Failure falls back to registered seeds, never blocks the recruitment pipeline.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import time
import urllib.parse
import urllib.request

from collect_reputation import atomic_json


def download(site, budget=40):
    if not re.fullmatch(r'https://[A-Za-z0-9.-]+', site):
        raise ValueError('Expected a public HTTPS origin')
    deadline = time.monotonic() + budget
    host = urllib.parse.urlsplit(site).hostname

    def read(path):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('opportunity_input_budget_reached')
        request = urllib.request.Request(site + path, headers={'User-Agent': 'JobRadarReputationQueue/1.0', 'Cache-Control': 'no-cache'})
        with urllib.request.urlopen(request, timeout=min(8, remaining)) as response:
            if urllib.parse.urlsplit(response.url).hostname != host or not response.url.startswith('https://'):
                raise ValueError('Public index redirected to an unexpected origin')
            raw = response.read(25 * 1024 * 1024 + 1)
        if len(raw) > 25 * 1024 * 1024:
            raise ValueError('Public index asset too large')
        return raw

    snapshot = json.loads(read('/jobs.json'))
    browse = snapshot.get('browse_index') or {}
    paths = browse.get('shards') if browse.get('version') == 1 else snapshot.get('index_shards')
    expected = browse.get('count') if browse.get('version') == 1 else snapshot.get('index_count')
    if paths:
        if not isinstance(expected, int) or not 1 <= expected <= 200000 or len(paths) > 128:
            raise ValueError('Invalid public index declaration')

        def part(path):
            match = re.fullmatch(r'/job-assets/index-([a-f0-9]{20})\.json', path)
            if not match:
                raise ValueError('Invalid public index path')
            raw = read(path)
            if hashlib.sha256(raw).hexdigest()[:20] != match[1]:
                raise ValueError('Public index checksum mismatch')
            return json.loads(raw)['jobs']

        with ThreadPoolExecutor(max_workers=4) as pool:
            jobs = [job for rows in pool.map(part, paths) for job in rows]
        if len(jobs) != expected or len({row['id'] for row in jobs}) != len(jobs):
            raise ValueError('Public index count or identity mismatch')
    else:
        jobs = snapshot.get('jobs')
        if not isinstance(jobs, list):
            raise ValueError('Public index missing')
    return dict(generated_at=snapshot.get('generated_at'), jobs=jobs)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--site', default='https://sites-project.job-radar.workers.dev')
    parser.add_argument('--output', default='data/reputation/jobs.json')
    args = parser.parse_args()
    target = Path(args.output)
    # A hard process timeout also leaves a valid empty fallback on disk.
    atomic_json(target, dict(jobs=[], input_error='Public opportunity input incomplete'))
    try:
        result = download(args.site)
    except Exception as error:
        result = dict(jobs=[], input_error=str(error)[:160])
        print('::warning::Public opportunity input unavailable; using the registered enterprise queue')
    atomic_json(target, result)
    print(json.dumps(dict(opportunities=len(result['jobs']), generated_at=result.get('generated_at'))))


if __name__ == '__main__':
    main()
