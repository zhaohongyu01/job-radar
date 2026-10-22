"""Give fresh discoveries a bounded turn before historical detail backlogs."""
import datetime as dt
from itertools import zip_longest
import hashlib
import json
import re


def listing_signature(item):
    structured = item.get('structured') or {}
    keys = ('fairDate', 'fairStartTime', 'fairEndTime', 'schoolName', 'fairAddress', 'fairName',
            'companyName', 'jobsort2', 'areaString', 'degreereq', 'specialty', 'basewage',
            'requestnum', 'jobdescribe', 'workexp', 'endtime', 'starttime')
    facts = {key: structured[key] for key in keys if key in structured}
    if not facts:
        return None
    return hashlib.sha256(json.dumps(facts, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def scan_plan(definitions, priority, freshness_first=False):
    if not freshness_first:
        return [(source, False) for source in definitions]
    schools = [source for source in definitions if source.get('adapter') == 'sdei']
    announcements = sorted((s for s in schools if s.get('channel') == 'announcements'), key=priority)
    talks = sorted((s for s in schools if s.get('channel') == 'talks'), key=priority)
    positions = sorted((s for s in schools if s.get('channel') == 'positions'), key=priority)
    # No school rotation in this newest-page pass. Rotation applies only to backfill.
    heads = [source for pair in zip_longest(announcements, talks) for source in pair if source]
    heads.extend(positions)
    others = [source for source in definitions if source.get('adapter') != 'sdei']
    return [(source, True) for source in heads] + [(source, False) for source in others + sorted(schools, key=priority)]


def retry_due(item, now):
    try:
        return not item.get('detail_retry_after') or dt.datetime.fromisoformat(item['detail_retry_after']) <= now
    except (ValueError, TypeError):
        return True


def defer_detail(item, now):
    attempts = min(12, int(item.get('detail_failures') or 0) + 1)
    item['detail_failures'] = attempts
    # A broken historical URL must not consume every later run's detail budget.
    hours = min(72, 2 ** min(attempts, 7))
    item['detail_retry_after'] = (now + dt.timedelta(hours=hours)).isoformat(timespec='seconds')


def prioritize_details(items, jobs):
    def key(item):
        old = jobs.get(item.get('target_id') or '', {})
        if not old:
            old = jobs.get(hashlib.sha256(item.get('identity', item['url']).encode()).hexdigest()[:20], {})
        verified = bool(old.get('last_verified_at') and old.get('detail_verification') != 'failed'
                        and not old.get('classification_note', '').startswith('仅核实'))
        digits = re.sub(r'[^0-9]', '', str(item.get('published_at') or ''))[:8]
        event_date = str((item.get('structured') or {}).get('fairDate') or '').replace('/', '-')[:10]
        today = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).date().isoformat()
        is_event = bool(re.fullmatch(r'20\d{2}-\d{2}-\d{2}', event_date))
        past_event = is_event and event_date < today
        date_order = int(event_date.replace('-', '')) if is_event and not past_event else -int(digits or '0')
        return (past_event, verified, int(item.get('detail_failures') or 0), date_order)

    return sorted(items, key=key)
