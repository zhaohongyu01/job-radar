"""Quality guard for public/exams.json before deployment."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import sys
from typing import Any, Dict, Optional, Tuple
from urllib.request import Request, urlopen

try:
    from snapshot_assets import EXAM_ASSET, exam_asset_paths
except ImportError:
    from scripts.snapshot_assets import EXAM_ASSET, exam_asset_paths

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


def _is_strict_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _extract_baseline_position_count(baseline: Dict[str, Any]) -> int:
    declared = baseline.get('total_positions')
    if _is_strict_int(declared) and declared > 0:
        return declared
    exams = baseline.get('exams')
    if not isinstance(exams, list):
        return 0
    inline_count = sum(
        len(e.get('positions') or [])
        for e in exams
        if isinstance(e, dict) and isinstance(e.get('positions'), list)
    )
    if inline_count > 0:
        return inline_count
    return sum(
        e['parsed_position_count']
        for e in exams
        if isinstance(e, dict) and _is_strict_int(e.get('parsed_position_count')) and e['parsed_position_count'] > 0
    )


def validate_candidate(
    candidate: Any,
    baseline: Optional[Dict[str, Any]] = None,
    require_fresh: bool = False,
    external_positions: Optional[list] = None,
    positions_by_exam: Optional[Dict[str, Any]] = None,
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
    if any(not isinstance(e, dict) for e in exams):
        return False, 'exams contains non-object entry'

    if baseline and isinstance(baseline.get('exams'), list):
        base_len = len(baseline['exams'])
        if len(exams) < 0.6 * base_len:
            return False, f'exam count dropped sharply: {len(exams)} < 60% of baseline ({base_len})'
        if require_fresh:
            cand_gen = str(candidate.get('generated_at') or '')
            base_gen = str(baseline.get('generated_at') or '')
            if base_gen and (not cand_gen or cand_gen < base_gen):
                return False, f'candidate generated_at ({cand_gen}) is older than baseline ({base_gen})'
            cand_ls = str(candidate.get('last_success_at') or cand_gen or '')
            base_ls = str(baseline.get('last_success_at') or base_gen or '')
            if base_ls and (not cand_ls or cand_ls < base_ls):
                return (
                    False,
                    f'candidate last_success_at ({cand_ls}) is older than baseline ({base_ls})',
                )

    has_schedule = any(
        bool((e.get('schedule') or {}).get('reg_end'))
        or (e.get('schedule') or {}).get('reg_mode') == 'rolling'
        for e in exams
    )
    if not has_schedule:
        return False, 'no exam has reg_end or rolling reg_mode in schedule'

    exam_ids = {str(e.get('id')) for e in exams if e.get('id')}

    if positions_by_exam is not None:
        if not isinstance(positions_by_exam, dict):
            return False, 'positions_by_exam is not an object'
        flattened_from_map: list[Dict[str, Any]] = []
        for eid, rows in positions_by_exam.items():
            if str(eid) not in exam_ids:
                return False, f'positions_by_exam contains unknown exam_id: {eid}'
            if not isinstance(rows, list):
                return False, f'positions_by_exam[{eid}] is not a list'
            for p in rows:
                if not isinstance(p, dict):
                    return False, f'position entry in exam {eid} is not an object'
                if 'exam_id' in p and str(p.get('exam_id') or '') != str(eid):
                    return False, f"position exam_id mismatch in {eid}: {p.get('exam_id')}"
                flattened_from_map.append(p)
        for e in exams:
            eid = str(e.get('id') or '')
            if 'parsed_position_count' in e:
                declared_cnt = e.get('parsed_position_count')
                actual_cnt = len(positions_by_exam.get(eid) or [])
                if not _is_strict_int(declared_cnt) or declared_cnt != actual_cnt:
                    return (
                        False,
                        f'parsed_position_count mismatch for exam {eid}: declared {declared_cnt} != actual {actual_cnt}',
                    )
        positions = (
            [p for p in external_positions if isinstance(p, dict)]
            if external_positions is not None
            else flattened_from_map
        )
    elif external_positions is not None:
        if any(not isinstance(p, dict) for p in external_positions):
            return False, 'external_positions contains non-object entry'
        positions = list(external_positions)
        for p in positions:
            if 'exam_id' in p and str(p.get('exam_id') or '') not in exam_ids:
                return False, f"position references unknown exam_id: {p.get('exam_id')}"
        if any('exam_id' in p for p in positions):
            grouped_counts: Dict[str, int] = {}
            for p in positions:
                if 'exam_id' in p:
                    peid = str(p.get('exam_id') or '')
                    grouped_counts[peid] = grouped_counts.get(peid, 0) + 1
            for e in exams:
                eid = str(e.get('id') or '')
                if 'parsed_position_count' in e:
                    declared_cnt = e.get('parsed_position_count')
                    actual_cnt = grouped_counts.get(eid, 0)
                    if not _is_strict_int(declared_cnt) or declared_cnt != actual_cnt:
                        return (
                            False,
                            f'parsed_position_count mismatch for exam {eid}: declared {declared_cnt} != actual {actual_cnt}',
                        )
        else:
            for e in exams:
                if 'parsed_position_count' in e and not _is_strict_int(e.get('parsed_position_count')):
                    return False, f"invalid parsed_position_count for exam {e.get('id')}"
            declared_sum = sum(
                e['parsed_position_count']
                for e in exams
                if _is_strict_int(e.get('parsed_position_count'))
            )
            if any('parsed_position_count' in e for e in exams) and declared_sum != len(positions):
                return (
                    False,
                    f'sum of parsed_position_count ({declared_sum}) != external positions ({len(positions)})',
                )
    else:
        for e in exams:
            eid = str(e.get('id') or '')
            inline_rows = e.get('positions') or []
            if not isinstance(inline_rows, list) or any(not isinstance(p, dict) for p in inline_rows):
                return False, f'invalid inline positions for exam {eid}'
            for p in inline_rows:
                if 'exam_id' in p and str(p.get('exam_id') or '') != eid:
                    return False, f"inline position exam_id mismatch in {eid}: {p.get('exam_id')}"
            if 'parsed_position_count' in e:
                declared_cnt = e.get('parsed_position_count')
                if not _is_strict_int(declared_cnt) or declared_cnt != len(inline_rows):
                    return (
                        False,
                        f'parsed_position_count mismatch for exam {eid}: declared {declared_cnt} != actual {len(inline_rows)}',
                    )
        positions = [p for e in exams for p in (e.get('positions') or [])]

    if len(positions) == 0:
        return False, 'candidate has zero parsed positions'

    if 'total_positions' in candidate:
        declared_total = candidate.get('total_positions')
        if not _is_strict_int(declared_total) or declared_total != len(positions):
            return (
                False,
                f'total_positions mismatch: declared {declared_total} != actual {len(positions)}',
            )

    if 'total_exams_with_positions' in candidate:
        declared_exams_with_pos = candidate.get('total_exams_with_positions')
        if positions_by_exam is not None:
            actual_exams_with_pos = sum(1 for eid in exam_ids if len(positions_by_exam.get(eid) or []) > 0)
        elif external_positions is not None:
            actual_exams_with_pos = len({str(p.get('exam_id')) for p in positions if p.get('exam_id')})
        else:
            actual_exams_with_pos = sum(1 for e in exams if len(e.get('positions') or []) > 0)
        if not _is_strict_int(declared_exams_with_pos) or declared_exams_with_pos != actual_exams_with_pos:
            return (
                False,
                f'total_exams_with_positions mismatch: declared {declared_exams_with_pos} != actual {actual_exams_with_pos}',
            )

    if baseline and isinstance(baseline, dict):
        base_pos_count = _extract_baseline_position_count(baseline)
        if base_pos_count >= 50 and len(positions) < 0.6 * base_pos_count:
            return (
                False,
                f'position count dropped sharply: {len(positions)} < 60% of baseline ({base_pos_count})',
            )

    empty_major = sum(1 for p in positions if not str(p.get('major_raw') or '').strip())
    if empty_major / len(positions) > 0.95:
        return False, f'empty major_raw ratio too high: {empty_major}/{len(positions)}'

    return True, 'ok'


def download_baseline_exam_assets(site: str, public_dir: Path, baseline: Dict[str, Any]) -> None:
    paths = exam_asset_paths(baseline)
    assets_dir = (Path(public_dir) / 'exam-assets').resolve()
    assets_dir.mkdir(parents=True, exist_ok=True)

    def fetch_one(path: str) -> Tuple[str, bytes]:
        match = EXAM_ASSET.fullmatch(path)
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

    for pattern in ('detail-*.json', 'positions-*.json'):
        for old in assets_dir.glob(pattern):
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

    external_positions: Optional[list] = None
    positions_by_exam: Optional[Dict[str, Any]] = None
    if cand_data is None:
        ok, reason = False, parse_err
    else:
        ok = True
        reason = 'ok'
        if 'positions_url' in cand_data and not cand_data.get('positions_url'):
            ok = False
            reason = 'empty positions_url in candidate'
        elif cand_data.get('detail_shards') or cand_data.get('positions_url'):
            try:
                for path in exam_asset_paths(cand_data):
                    match = EXAM_ASSET.fullmatch(path)
                    source = public_dir / path.lstrip('/')
                    if (
                        not match
                        or not source.is_file()
                        or hashlib.sha256(source.read_bytes()).hexdigest()[:20] != match[1]
                    ):
                        ok = False
                        reason = f'missing or corrupt candidate exam asset: {path}'
                        break
                if ok and cand_data.get('positions_url'):
                    pos_file = public_dir / str(cand_data['positions_url']).lstrip('/')
                    pos_obj = json.loads(pos_file.read_text(encoding='utf-8'))
                    pos_map = pos_obj.get('positions_by_exam') if isinstance(pos_obj, dict) else None
                    if (
                        not isinstance(pos_obj, dict)
                        or pos_obj.get('schema_version') != 1
                        or not isinstance(pos_map, dict)
                        or any(
                            not isinstance(rows, list) or any(not isinstance(p, dict) for p in rows)
                            for rows in pos_map.values()
                        )
                    ):
                        ok = False
                        reason = 'invalid positions asset payload'
                    else:
                        positions_by_exam = pos_map
                        external_positions = [p for rows in pos_map.values() for p in rows]
            except Exception as exc:
                ok = False
                reason = f'invalid candidate exam assets: {exc}'
        if ok:
            ok, reason = validate_candidate(
                cand_data,
                baseline=base_data,
                require_fresh=require_fresh,
                external_positions=external_positions,
                positions_by_exam=positions_by_exam,
            )

    if ok and cand_data is not None:
        exams = cand_data.get('exams') or []
        positions = (
            len(external_positions)
            if external_positions is not None
            else sum(len(e.get('positions') or []) for e in exams if isinstance(e, dict))
        )
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
            base_ls = base_data.get('last_success_at') or base_data.get('generated_at') or 'unknown'
            print(f'::warning::exams candidate rejected: {reason}; restored live baseline (last_success_at={base_ls})')
            summary_path = os.environ.get('GITHUB_STEP_SUMMARY')
            if summary_path:
                try:
                    with Path(summary_path).open('a', encoding='utf-8') as sf:
                        sf.write(
                            f"\n- **Exams Guard Fallback**: Rejected candidate (`{reason}`); "
                            f"preserved live baseline (`last_success_at={base_ls}`).\n"
                        )
                except Exception:
                    pass
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
