"""Download the exact published snapshot for a deployment without collection."""
import argparse
import hashlib
import json
from pathlib import Path
import re
from urllib.request import Request, urlopen

try:
    from stage_public import ASSET, asset_paths
    from employer_identity import employer_identity, refine_company_facts
except ImportError:
    from scripts.stage_public import ASSET, asset_paths
    from scripts.employer_identity import employer_identity, refine_company_facts

USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'


def repair_snapshot_zhiye_urls(public, snapshot, metadata):
    repaired_urls = {}
    detail_shards = snapshot.get('detail_shards') or {}
    for prefix, rel_path in list(detail_shards.items()):
        shard_file = public / rel_path.lstrip('/')
        if not shard_file.exists():
            continue
        detail_data = json.loads(shard_file.read_bytes())
        shard_changed = False
        for job_id, job in (detail_data.get('jobs') or {}).items():
            structured_uuid = str((job.get('structured') or {}).get('Id') or '').strip()
            if re.fullmatch(r'[0-9a-fA-F-]{36}', structured_uuid):
                for url_field in ('source_url', 'application_url'):
                    url_value = str(job.get(url_field) or '')
                    if re.search(r'/(?:campus|social)/detail\?jobAdId=\d+$', url_value):
                        new_url = re.sub(r'jobAdId=\d+$', f'jobAdId={structured_uuid}', url_value)
                        job[url_field] = new_url
                        if isinstance(job.get('primary_facts'), dict) and job['primary_facts'].get(url_field):
                            job['primary_facts'][url_field] = new_url
                        repaired_urls.setdefault(job_id, {})[url_field] = new_url
                        shard_changed = True
            emp_id = employer_identity(job)
            for k in ('employer_brand', 'company_department'):
                if emp_id.get(k) and job.get(k) != emp_id[k]:
                    job[k] = emp_id[k]
                    repaired_urls.setdefault(job_id, {})[k] = emp_id[k]
                    shard_changed = True
            if job.get('kind') != '宣讲会':
                refined = refine_company_facts(job)
                for k in ('company', 'company_conflict', 'company_note'):
                    old_val = job.get(k)
                    new_val = refined.get(k)
                    if old_val != new_val:
                        if new_val is None:
                            job.pop(k, None)
                        else:
                            job[k] = new_val
                        if isinstance(job.get('primary_facts'), dict) and k in job['primary_facts'] and k == 'company' and new_val:
                            job['primary_facts'][k] = new_val
                        repaired_urls.setdefault(job_id, {})[k] = new_val
                        shard_changed = True
        if shard_changed:
            raw_detail = json.dumps(detail_data, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
            new_hash = hashlib.sha256(raw_detail).hexdigest()[:20]
            new_rel_path = re.sub(r'[0-9a-f]{20}\.json$', f'{new_hash}.json', rel_path)
            target_file = public / new_rel_path.lstrip('/')
            target_file.parent.mkdir(parents=True, exist_ok=True)
            target_file.write_bytes(raw_detail)
            detail_shards[prefix] = new_rel_path

    if not repaired_urls:
        return None, None, 0

    def apply_summary_updates(target_job, updates):
        for k, v in updates.items():
            if v is None:
                target_job.pop(k, None)
            else:
                target_job[k] = v

    for job in snapshot.get('jobs') or []:
        updates = repaired_urls.get(job.get('id'))
        if updates:
            apply_summary_updates(job, updates)

    index_shards = snapshot.get('index_shards') or []
    for idx, rel_path in enumerate(list(index_shards)):
        shard_file = public / rel_path.lstrip('/')
        if not shard_file.exists():
            continue
        idx_data = json.loads(shard_file.read_bytes())
        shard_changed = False
        for job in idx_data.get('jobs') or []:
            updates = repaired_urls.get(job.get('id'))
            if updates:
                apply_summary_updates(job, updates)
                shard_changed = True
        if shard_changed:
            raw_idx = json.dumps(idx_data, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
            new_hash = hashlib.sha256(raw_idx).hexdigest()[:20]
            new_rel_path = re.sub(r'[0-9a-f]{20}\.json$', f'{new_hash}.json', rel_path)
            target_file = public / new_rel_path.lstrip('/')
            target_file.parent.mkdir(parents=True, exist_ok=True)
            target_file.write_bytes(raw_idx)
            index_shards[idx] = new_rel_path

    index = json.dumps(snapshot, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    metadata['index_sha256'] = hashlib.sha256(index).hexdigest()
    metadata_raw = json.dumps(metadata, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    return index, metadata_raw, len(repaired_urls)


def download(site, public, repair_zhiye_urls=False):
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
    if repair_zhiye_urls:
        repaired_index, repaired_meta, repaired_count = repair_snapshot_zhiye_urls(public, snapshot, metadata)
        if repaired_count:
            index = repaired_index
            metadata_raw = repaired_meta
            print(f'Repaired {repaired_count} snapshot records (URLs, brand departments, and employer names)')
    (public / 'jobs.json').write_bytes(index)
    (public / 'snapshot-manifest.json').write_bytes(metadata_raw)
    print(f'Reused published snapshot with {snapshot.get("index_count", len(snapshot["jobs"]))} records; no collection performed')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--site', required=True)
    parser.add_argument('--public-dir', type=Path, required=True)
    parser.add_argument('--repair-zhiye-urls', action='store_true')
    args = parser.parse_args()
    download(args.site, args.public_dir, repair_zhiye_urls=args.repair_zhiye_urls)
