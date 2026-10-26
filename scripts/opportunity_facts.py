"""Conservative optional facts; absence is unknown, never an inferred rejection."""
import datetime as dt
import json
from pathlib import Path
import re

POLICY = json.loads((Path(__file__).resolve().parents[1] / 'config/opportunity-policy.json').read_text(encoding='utf-8'))
TZ = dt.timezone(dt.timedelta(hours=8))


def _timestamp(value, date_end=False):
    try:
        if date_end and re.fullmatch(r'\d{4}-\d{2}-\d{2}', str(value)):
            return dt.datetime.combine(dt.date.fromisoformat(value), dt.time.max, TZ)
        parsed = dt.datetime.fromisoformat(value)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=TZ)
    except (ValueError, TypeError):
        return None


def assess_opportunity_validity(job, now):
    """Offline audit uses the same evidence policy as the client, without renewing facts."""
    deadline = _timestamp(job.get('deadline'), date_end=True)
    if job.get('listing_status') == 'withdrawn' or (deadline and deadline < now):
        return 'closed'
    evidence = job.get('availability_evidence') or {}
    if evidence.get('verified') and evidence.get('kind') == 'long_term':
        return 'long_term'
    checked = _timestamp(evidence.get('checked_at') or job.get('last_verified_at'))
    age = (now - checked).total_seconds() if checked else float('inf')
    if evidence.get('verified') and evidence.get('kind') == 'open' and 0 <= age <= POLICY['recent_evidence_days'] * 86400:
        return 'confirmed_open'
    return 'unconfirmed'


def employment_type(text):
    match = re.search(r'(?:工作性质|聘用性质|岗位性质)[：:\s]*(全职|实习|兼职)', text)
    if match:
        return {'全职': 'full_time', '实习': 'internship', '兼职': 'part_time'}[match[1]]
    if re.search(r'(?:^|\n)[^\n]{0,60}(?:实习生招聘|招聘实习生|实习岗位)[：\s]', text):
        return 'internship'
    return 'unknown'


def availability_evidence(job):
    text = job.get('body') or ''
    patterns = [('long_term', r'(?:招聘期限|招聘时间|本岗位|本次招聘)[：:\s]*(?:长期|常年)(?:招聘)?'),
                ('open', r'(?:岗位状态|招聘状态)[：:\s]*(?:招聘中|开放|在招)')]
    for kind, pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return {'kind': kind, 'text': match[0],
                    'checked_at': job.get('detail_verified_at') or job.get('last_verified_at'),
                    'url': job.get('source_url'), 'verified': job.get('detail_verification') != 'failed'}
    return None
