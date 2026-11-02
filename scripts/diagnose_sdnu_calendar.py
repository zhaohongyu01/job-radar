"""Read one official SDNU calendar list, respecting persisted host cooldown.

No detail requests, collection state writes, TLS exceptions or publication.
"""
import argparse
import datetime as dt
import json
from pathlib import Path
import time
import urllib.parse

import collect as collector


def diagnose(state):
    if not isinstance(state.get('sources'), dict):
        raise ValueError('Invalid baseline: missing sources')
    source = next(s for s in collector.SOURCES if s['id'] == 'sdnu-graduate-talks')
    host = urllib.parse.urlsplit(source['url']).hostname
    definitions = {s['id']: s for s in collector.SOURCES}
    now = dt.datetime.now(collector.TZ)
    for key, status in state['sources'].items():
        definition = definitions.get(key, {})
        if urllib.parse.urlsplit(definition.get('url', '')).hostname == host and status.get('blocked_until'):
            if dt.datetime.fromisoformat(status['blocked_until']) > now:
                return {'source': source['id'], 'result': 'cooldown',
                        'message': 'Host cooldown active; no request made.'}
    start = time.monotonic()
    try:
        document = collector.fetch(source['url'], timeout=6, retries=0)
        rows = collector.sdnu_graduate_list(document, source['url'])
        return {'source': source['id'], 'result': 'list_verified', 'rows': len(rows),
                'latest_publication': max((r['published_at'] for r in rows), default=None),
                'elapsed_seconds': round(time.monotonic() - start, 2),
                'message': 'One list only; event details and full coverage not verified.'}
    except Exception as error:
        return {'source': source['id'], 'result': 'failed', 'error_type': type(error).__name__,
                'request': getattr(error, 'request_diagnostic', {}),
                'elapsed_seconds': round(time.monotonic() - start, 2),
                'message': 'Stopped after one attempt; no details or publication.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    result = diagnose(json.loads(args.state.read_text(encoding='utf-8')))
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=False))
    raise SystemExit(1 if result['result'] == 'failed' else 0)
