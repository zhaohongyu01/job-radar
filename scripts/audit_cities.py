"""Count explicit work and event cities from a fully verified offline snapshot."""
import argparse
from collections import Counter
import datetime as dt
import json
from pathlib import Path
from offline_snapshot import read_public
from opportunity_facts import assess_opportunity_validity


def audit(snapshot, as_of):
    jobs = snapshot['jobs']
    events = {}
    for job in jobs:
        for event in job.get('talk_events') or ([job['talk_event']] if job.get('talk_event') else []):
            if event.get('status') == 'cancelled':
                continue
            try:
                end = dt.datetime.fromisoformat(f"{event['date']}T{event.get('end_time') or '23:59'}:00+08:00")
            except (ValueError, KeyError):
                continue
            if end >= as_of:
                events[event['id']] = event
    return {'as_of': as_of.isoformat(), 'generated_at': snapshot['generated_at'],
            'raw_records': snapshot.get('raw_records'), 'index_records': len(jobs),
            'city_work_records': dict(Counter(city for j in jobs for city in set(j.get('cities', [])))),
            'city_concrete_positions': dict(Counter(city for j in jobs if j.get('kind') == '具体岗位' for city in set(j.get('cities', [])))),
            'event_cities': dict(Counter(e.get('city') or '地点待核实' for e in events.values())),
            'validity_statuses': dict(Counter(assess_opportunity_validity(job, as_of) for job in jobs)),
            'unknown_events': [e for e in events.values() if not e.get('city')],
            'source_statuses': dict(Counter(s.get('status', 'unknown') for s in snapshot['sources']))}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--public-dir', required=True, type=Path)
    parser.add_argument('--as-of', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    snapshot, _ = read_public(args.public_dir)
    report = audit(snapshot, dt.datetime.fromisoformat(args.as_of))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in report.items() if not isinstance(v, (list, dict))}, ensure_ascii=False))
