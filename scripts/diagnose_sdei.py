"""One-source, one-page comparison probe. No publication or state modification.

Run on each candidate machine after the recorded cooldown has expired:
python scripts/diagnose_sdei.py --source jobsdufe-announcements --state data/state.json
"""
import argparse
import datetime as dt
import json
import http.cookiejar
from pathlib import Path
import urllib.parse
import urllib.request

import collect as collector


def diagnose(source, state):
    host = urllib.parse.urlsplit(source['url']).netloc
    definitions = {s['id']: s for s in collector.SOURCES}
    for identifier, status in state.get('sources', {}).items():
        definition = definitions.get(identifier, {})
        if urllib.parse.urlsplit(definition.get('url', '')).netloc != host:
            continue
        until = status.get('blocked_until')
        if until and dt.datetime.fromisoformat(until) > dt.datetime.now(collector.TZ):
            return {'source': source['id'], 'result': 'cooldown', 'blocked_until': until,
                    'message': '冷却尚未结束，未发送请求。'}, 2
    try:
        # Uses the production cookie jar and prewarm in the SAME process.
        items, pages = collector.sdei_list(dict(source), 1)
        return {'source': source['id'], 'result': 'list_verified',
                'rows': len(items), 'pages': pages,
                'message': '同会话预热和列表解析成功；尚未核验详情及全量覆盖。'}, 0
    except Exception as error:
        return {'source': source['id'], 'result': 'failed',
                'error_type': type(error).__name__,
                'request': getattr(error, 'request_diagnostic', {}),
                'message': '本次已停止；拒绝访问时不要连续重试。'}, 1


def main():
    sources = {s['id']: s for s in collector.SOURCES if s.get('adapter') == 'sdei'}
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', choices=sorted(sources), default='jobsdufe-announcements')
    parser.add_argument('--state', type=Path, required=True,
                        help='Use the latest collector state; fail closed if missing or invalid.')
    parser.add_argument('--network-route', choices=['system', 'direct'], default='system',
                        help='Direct only changes this process, not the machine proxy settings.')
    args = parser.parse_args()
    state = json.loads(args.state.read_text(encoding='utf-8'))
    if not isinstance(state.get('sources'), dict):
        raise ValueError('Invalid collector state: missing sources')
    if args.network_route == 'direct':
        collector.OPENER = urllib.request.build_opener(
            urllib.request.ProxyHandler({}), collector.HTTPSHandler(),
            urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    report, code = diagnose(sources[args.source], state)
    report['network_route'] = args.network_route
    report['system_proxy_configured'] = bool(urllib.request.getproxies().get('https'))
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return code


if __name__ == '__main__':
    raise SystemExit(main())
