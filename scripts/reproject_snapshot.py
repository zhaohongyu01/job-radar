"""Re-export retained facts locally; no network, collection or timestamp renewal."""
import argparse
import copy
import datetime as dt
import json
from pathlib import Path
import time
from ci_collect import snapshot_state
from collect import atomic_json, export_snapshot, public_record
from offline_snapshot import read_public

HISTORY = ('first_seen_at', 'updated_at', 'last_verified_at', 'detail_verified_at', 'revision')


def reproject(output_dir, report_path, *, state_path=None, public_dir=None):
    if bool(state_path) == bool(public_dir):
        raise ValueError('Provide exactly one complete state or public snapshot')
    output = Path(output_dir).resolve()
    source = Path(state_path or public_dir).resolve()
    report_target = Path(report_path).resolve()
    if report_target == source or (public_dir and report_target.is_relative_to(source)) or (report_target.is_relative_to(output) and (report_target.name in {'jobs.json', 'snapshot-manifest.json'} or 'job-assets' in report_target.relative_to(output).parts)):
        raise ValueError('Report must not overwrite input or generated snapshot assets')
    if output == source or (public_dir and output.is_relative_to(source)) or output == Path('public').resolve():
        raise ValueError('Output must be separate from the input and repository public directory')
    if output.exists() and any(output.iterdir()):
        raise ValueError('Output directory must be empty')
    if state_path:
        state = json.loads(source.read_text(encoding='utf-8'))
        input_kind = 'full_state'
    else:
        snapshot, load = read_public(source)
        state = snapshot_state(snapshot, load)
        input_kind = 'published_only_not_a_full_state_backup'
    if not isinstance(state.get('jobs'), dict) or not state.get('last_run_at'):
        raise ValueError('Incomplete collector state')
    original = copy.deepcopy(state)
    started = time.perf_counter()
    output.mkdir(parents=True, exist_ok=True)
    snapshot = export_snapshot(state, output)
    validated, load = read_public(output)
    restored = snapshot_state(validated, load)
    eligible = {identifier for identifier, job in original['jobs'].items()
                if __import__('collect').publishable_job(job)}
    if set(restored['jobs']) != eligible:
        raise ValueError('Published source identities changed during reprojection')
    if state != original:
        changed = [(identifier, [key for key in row.keys() | original['jobs'][identifier].keys()
                                 if row.get(key) != original['jobs'][identifier].get(key)])
                   for identifier, row in state['jobs'].items() if row != original['jobs'][identifier]]
        raise ValueError(f'Reprojection mutated retained input facts: {changed[:3]}')
    for identifier, job in restored['jobs'].items():
        before = original['jobs'][identifier]
        for field in HISTORY:
            if job.get(field) != before.get(field):
                raise ValueError(f'History changed: {identifier}/{field}')
    changes = []
    for identifier, before in original['jobs'].items():
        if identifier not in eligible:
            continue
        after = public_record(before)
        fields = {}
        for field in ('cities', 'location_evidence', 'talk_event'):
            if before.get(field) != after.get(field):
                fields[field] = {'before': before.get(field), 'after': after.get(field)}
        if fields:
            changes.append({'id': identifier, 'changes': fields})
    report = {'input_kind': input_kind, 'source': str(source),
              'projection_version': 1, 'projected_at': dt.datetime.now(dt.timezone.utc).isoformat(),
              'collection_generated_at': state['last_run_at'], 'network_requests': 0,
              'input_records': len(state['jobs']), 'published_raw_records': len(eligible),
              'index_records': len(snapshot['jobs']), 'withheld_records': snapshot.get('withheld_records', 0),
              'identities_preserved': True, 'history_preserved': True,
              'elapsed_seconds': round(time.perf_counter() - started, 3), 'changes': changes}
    atomic_json(Path(report_path), report)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument('--state', type=Path)
    inputs.add_argument('--public-dir', type=Path)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    report = reproject(args.output_dir, args.report, state_path=args.state, public_dir=args.public_dir)
    print(json.dumps({k: v for k, v in report.items() if k != 'changes'}, ensure_ascii=False))
