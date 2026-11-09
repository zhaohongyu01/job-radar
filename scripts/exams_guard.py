"""Quality guard for public/exams.json before deployment."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import sys
from typing import Any, Dict, Optional, Tuple
from urllib.request import Request, urlopen

try:
    from snapshot_assets import EXAM_DETAIL_ASSET, exam_asset_paths
except ImportError:
    from scripts.snapshot_assets import EXAM_DETAIL_ASSET, exam_asset_paths

USER_AGENT = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
)


def fetch_baseline_exams(site: str) -> Tuple[Optional[bytes], Optional[Dict[str, Any]]]:
    if not site:
        return None, None
    url = site.rstrip('/') + '/exams.json'
    try:
        req = Request(url, headers={'User-Agent': USER_AGENT, 'Cache-Control': 'no-cache'})
        with urlopen(req, timeout=20) as resp:
            raw = resp.read()
        data = json.loads(raw.decode('utf-8'))
        if isinstance(data, dict) and isinstance(data.get('exams'), list):
            return raw, data
    except Exception:
        pass
    return None, None


def validate_candidate(
    candidate: Any,
    baseline: Optional[Dict[str, Any]] = None,
    require_fresh: bool = False,
) -> Tuple[bool, str]:
    if not isinstance(candidate, dict):
        return False, 'candidate is not a JSON object'
    if candidate.get('schema_version') != 1:
        return False, f"unexpected schema_version: {candidate.get('schema_version')}"
    exams = candidate.get('exams')
    if not isinstance(exams, list):
        return False, 'exams field is not a list'
    if len(exams) < 30:
        return False, f'too few exams: {len(exams)} < 30'

    if baseline and isinstance(baseline.get('exams'), list):
        base_len = len(baseline['exams'])
        if len(exams) < 0.6 * base_len:
            return False, f'exam count dropped sharply: {len(exams)} < 60% of baseline ({base_len})'
        if require_fresh:
            cand_gen = str(candidate.get('generated_at') or '')
            base_gen = str(baseline.get('generated_at') or '')
            if base_gen and cand_gen < base_gen:
                return False, f'candidate generated_at ({cand_gen}) is older than baseline ({base_gen})'

    has_schedule = any(
        bool((e.get('schedule') or {}).get('reg_end'))
        or (e.get('schedule') or {}).get('reg_mode') == 'rolling'
        for e in exams
        if isinstance(e, dict)
    )
    if not has_schedule:
        return False, 'no exam has reg_end or rolling reg_mode in schedule'

    positions = [
        p
        for e in exams
        if isinstance(e, dict)
        for p in (e.get('positions') or [])
        if isinstance(p, dict)
    ]
    if positions:
        empty_major = sum(1 for p in positions if not str(p.get('major_raw') or '').strip())
        if empty_major / len(positions) > 0.95:
            return False, f'empty major_raw ratio too high: {empty_major}/{len(positions)}'

    return True, 'ok'


def download_baseline_exam_assets(site: str, public_dir: Path, baseline: Dict[str, Any]) -> None:
    paths = exam_asset_paths(baseline)
    assets_dir = (Path(public_dir) / 'exam-assets').resolve()
    assets_dir.mkdir(parents=True, exist_ok=True)

    def fetch_one(path: str) -> Tuple[str, bytes]:
        match = EXAM_DETAIL_ASSET.fullmatch(path)
        if not match:
            raise ValueError(f'invalid baseline exam asset path: {path}')
        url = site.rstrip('/') + path
        req = Request(url, headers={'User-Agent': USER_AGENT, 'Cache-Control': 'no-cache'})
        with urlopen(req, timeout=20) as resp:
            raw = resp.read()
        if hashlib.sha256(raw).hexdigest()[:20] != match[1]:
            raise ValueError(f'baseline exam asset hash mismatch: {path}')
        return path, raw

    fetched: list[Tuple[str, bytes]] = []
    if paths:
        with ThreadPoolExecutor(max_workers=8) as pool:
            fetched = list(pool.map(fetch_one, sorted(paths)))

    for old in assets_dir.glob('detail-*.json'):
        if old.resolve().is_relative_to(assets_dir) and f'/exam-assets/{old.name}' not in paths:
            old.unlink()
    for path, raw in fetched:
        target = Path(public_dir) / path.lstrip('/')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)


def guard_exams(
    public_dir: Path,
    site: str,
    require_fresh: bool = False,
) -> int:
    public_dir = Path(public_dir)
    target = public_dir / 'exams.json'
    base_raw, base_data = fetch_baseline_exams(site)

    cand_data: Optional[Dict[str, Any]] = None
    parse_err = ''
    if target.is_file():
        try:
            cand_data = json.loads(target.read_text(encoding='utf-8'))
        except Exception as exc:
            parse_err = f'failed to parse {target}: {exc}'
    else:
        parse_err = f'missing candidate file: {target}'

    if cand_data is None:
        ok, reason = False, parse_err
    else:
        ok, reason = validate_candidate(cand_data, baseline=base_data, require_fresh=require_fresh)
        if ok and cand_data.get('detail_shards'):
            try:
                for path in exam_asset_paths(cand_data):
                    match = EXAM_DETAIL_ASSET.fullmatch(path)
                    source = public_dir / path.lstrip('/')
                    if (
                        not match
                        or not source.is_file()
                        or hashlib.sha256(source.read_bytes()).hexdigest()[:20] != match[1]
                    ):
                        ok = False
                        reason = f'missing or corrupt candidate exam asset: {path}'
                        break
            except Exception as exc:
                ok = False
                reason = f'invalid candidate detail_shards: {exc}'

    if ok and cand_data is not None:
        exams = cand_data.get('exams') or []
        positions = sum(len(e.get('positions') or []) for e in exams if isinstance(e, dict))
        print(
            f"Exams guard passed: exams={len(exams)}, positions={positions}, "
            f"generated_at={cand_data.get('generated_at')}"
        )
        return 0

    if base_raw is not None and base_data is not None:
        try:
            download_baseline_exam_assets(site, public_dir, base_data)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(base_raw)
            print(f'::warning::exams candidate rejected: {reason}')
            return 0
        except Exception as exc:
            reason = f'{reason}; failed to restore baseline exam assets: {exc}'

    print(f'Exams guard failed without baseline: {reason}', file=sys.stderr)
    return 1


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--public-dir', type=Path, required=True)
    parser.add_argument('--site', default='https://sites-project.job-radar.workers.dev')
    parser.add_argument('--require-fresh', action='store_true')
    args = parser.parse_args()
    sys.exit(guard_exams(args.public_dir, args.site, require_fresh=args.require_fresh))


if __name__ == '__main__':
    main()
