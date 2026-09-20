"""Explain changes between internal collection baselines without discarding jobs."""
import datetime as dt


def build_coverage_report(before, after, snapshot):
    try:
        import collect as collector
    except ImportError:
        from scripts import collect as collector

    old = before.get('jobs', {}) if isinstance(before, dict) else {}
    current = after.get('jobs', {}) if isinstance(after, dict) else {}
    events = {key: [] for key in (
        'new_records', 'missing_records', 'withheld', 'visibility_restored',
        'cities_changed', 'deadline_changed', 'newly_expired', 'duplicate_groups')}
    after_run_at = after.get('last_run_at') if isinstance(after, dict) else None
    today = (after_run_at or '')[:10] or dt.datetime.now(collector.TZ).date().isoformat()
    before_run_at = ((before.get('last_run_at') if isinstance(before, dict) else None) or today)[:10]

    def summary(row):
        return {key: row.get(key) for key in ('id', 'title', 'source_id', 'source_url')}

    for identifier, raw in current.items():
        row = collector.public_record(raw)
        prior_raw = old.get(identifier)
        prior = collector.public_record(prior_raw) if prior_raw else None
        entry = summary(row)
        if prior_raw is None:
            events['new_records'].append(entry)
        if not collector.publishable_job(raw):
            events['withheld'].append(dict(entry,
                verification=raw.get('detail_verification') or 'unverified'))
        elif prior_raw and not collector.publishable_job(prior_raw):
            events['visibility_restored'].append(entry)
        if prior and set(prior.get('cities') or []) != set(row.get('cities') or []):
            events['cities_changed'].append(dict(entry,
                before=prior.get('cities', []), after=row.get('cities', [])))
        if prior and prior.get('deadline') != row.get('deadline'):
            events['deadline_changed'].append(dict(entry,
                before=prior.get('deadline'), after=row.get('deadline')))
        # A date earlier than today is certainly expired, independent of timezone parsing.
        if (row.get('deadline') and row['deadline'][:10] < today and prior and
                (not prior.get('deadline') or prior['deadline'][:10] >= before_run_at)):
            events['newly_expired'].append(entry)
    for identifier in old.keys() - current.keys():
        events['missing_records'].append(summary(old[identifier]))
    for row in snapshot.get('jobs', []):
        if row.get('duplicate_ids'):
            events['duplicate_groups'].append(dict(summary(row), duplicate_ids=row['duplicate_ids']))
    return {
        'schema_version': 1,
        'generated_at': after_run_at,
        'baseline_at': before.get('last_run_at') if isinstance(before, dict) else None,
        'scope': '内部基线对比；不是某个用户筛选后的页面数量。事件可重叠，不可相加减。withheld与duplicate_groups是本轮存量。',
        'counts': {'before_records': len(old), 'after_records': len(current),
                   'published_records': snapshot.get('raw_records'),
                   'published_groups': len(snapshot.get('jobs', [])),
                   'withheld_records': snapshot.get('withheld_records'),
                   'duplicates_merged': snapshot.get('duplicates_merged')},
        'event_counts': {key: len(rows) for key, rows in events.items()},
        'events': events,
    }
