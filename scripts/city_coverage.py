"""Explain city-level coverage from declared scope and observed source facts."""
from collections import Counter
import datetime as dt
import json
from pathlib import Path
from city_registry import CITIES

DEFINITIONS = json.loads((Path(__file__).resolve().parents[1] / 'config/source-coverage.json').read_text(encoding='utf-8'))


def build_city_coverage(snapshot, definitions=None):
    definitions = definitions or DEFINITIONS
    now = dt.datetime.fromisoformat(snapshot['generated_at'])
    states = {s['id']: s for s in snapshot.get('sources', [])}
    events = {}
    for job in snapshot.get('jobs', []):
        for event in job.get('talk_events') or ([job['talk_event']] if job.get('talk_event') else []):
            try:
                end = dt.datetime.fromisoformat(f"{event['date']}T{event.get('end_time') or '23:59'}:00+08:00")
            except (ValueError, KeyError):
                continue
            if end >= now and event.get('status') != 'cancelled':
                events[event['id']] = event
    unknown_schools = Counter(e['school'] for e in events.values() if not e.get('city'))
    cities = {}
    for city in CITIES:
        local = [s for s in definitions['sources'] if city in s.get('cities', [])]
        planned = [s for s in definitions.get('planned', []) if city in s.get('cities', [])]
        calendars = []
        for source in local:
            if source['channel'] != 'calendar':
                continue
            observed = states.get(source['source_id'], {})
            calendars.append({'id': source['source_id'], 'school': source.get('school'),
                'status': observed.get('status', 'not_collected'),
                'last_success_at': observed.get('last_success_at'),
                'last_list_read_at': observed.get('last_list_read_at') or observed.get('head_scan_at'),
                'latest_calendar_date': observed.get('latest_calendar_date'),
                'window_complete': observed.get('list_complete') is True,
                'pending_details': observed.get('pending_details', 0),
                'coverage': observed.get('coverage'),
                'error': (observed.get('errors') or [{}])[0].get('reason')})
        schools = sorted({s['school'] for s in local if s.get('school')})
        cities[city] = {'city': city, 'local_sources': [s['source_id'] for s in local if s['channel'] != 'calendar'],
            'calendar_sources': calendars, 'schools': schools,
            'planned_schools': sorted({s['school'] for s in planned}),
            'unknown_events': sum(unknown_schools[school] for school in schools),
            'upcoming_events': sum(e.get('city') == city for e in events.values())}
    return {'schema_version': 1, 'as_of': snapshot['generated_at'], 'cities': cities,
            'schools': sorted({s['school'] for s in definitions['sources'] if s.get('school')}),
            'national_sources': [s['source_id'] for s in definitions['sources'] if s.get('scope') == 'national_supplement'],
            'note': '来源覆盖不等于全市岗位或高校完整覆盖；统计仅对应本次快照及已接渠道。'}
