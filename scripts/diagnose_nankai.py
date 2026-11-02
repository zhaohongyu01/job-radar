"""Bounded, read-only comparison on Cloud/NAS. No collector state or publication.

Only Nankai's public lists and up to two same-origin linked details are read.
No response bodies, proxy addresses, credentials or personal data are output.
"""
import argparse
import datetime as dt
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

ORIGIN = 'https://career.nankai.edu.cn'
LIST = ORIGIN + '/correcruit/index.html'
CALENDAR = ORIGIN + '/recruitment/index2.html'
USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'


class PublicPage(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links, self.has_body, self.text_size = [], False, 0
        self.body_depth, self.hidden = 0, ''

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if 'zpnr' in attrs.get('class', '').split():
            self.has_body = True
            self.body_depth = 1
        elif self.body_depth and tag not in {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}:
            self.body_depth += 1
        if self.body_depth and tag in {'script', 'style'}:
            self.hidden = tag
        href = attrs.get('href', '')
        if tag == 'a' and re.fullmatch(r'/correcruit/content/id/\d+\.html', href):
            url = ORIGIN + href
            if url not in self.links:
                self.links.append(url)

    def handle_data(self, value):
        if self.body_depth and not self.hidden:
            self.text_size += len(value.strip())

    def handle_endtag(self, tag):
        if self.body_depth and tag not in {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}:
            self.body_depth -= 1
        if tag == self.hidden:
            self.hidden = ''


def page_facts(body):
    page = PublicPage()
    page.feed(body.decode('utf-8', 'replace'))
    return {'list_links': len(page.links), 'detail_container': page.has_body,
            'text_characters': page.text_size}, page.links


def curl_probe(url, mode, timeout):
    command = ['curl', '--silent', '--show-error', '--proto', '=https', '--connect-timeout', '5',
               '--max-time', str(timeout), '--max-filesize', '1000000', '--user-agent', USER_AGENT,
               '--write-out', '%{json}']
    if mode != 'system':
        command += ['--noproxy', '*']
    if mode == 'ipv4':
        command.append('--ipv4')
    if mode == 'ipv6':
        command.append('--ipv6')
    with tempfile.TemporaryDirectory() as directory:
        target = Path(directory) / 'body'
        process = subprocess.run(command + ['--output', str(target), url], capture_output=True,
                                 timeout=timeout + 2, text=True, encoding='utf-8', errors='replace')
        try:
            raw = json.loads(process.stdout)
        except ValueError:
            raw = {}
        data = target.read_bytes()[:1_000_000] if target.exists() else b''
    # Deliberately do not return raw curl stderr or %{json} (proxy/addresses).
    return {'exit_code': process.returncode, 'http_code': raw.get('http_code', 0),
            **{key: raw.get(key) for key in ('time_namelookup', 'time_connect', 'time_appconnect', 'time_total')},
            'bytes': len(data)}, data


def urllib_probe(url, timeout):
    started = time.monotonic()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': USER_AGENT}), timeout=timeout) as response:
            if urllib.parse.urlsplit(response.url).hostname != 'career.nankai.edu.cn':
                return {'http_code': response.status, 'error': 'redirected_from_source'}, b''
            chunks, size = [], 0
            reader = getattr(response, 'read1', response.read)
            while size <= 1_000_000:
                left = timeout - (time.monotonic() - started)
                if left <= 0:
                    raise TimeoutError('probe total budget')
                connection = getattr(getattr(getattr(response, 'fp', None), 'raw', None), '_sock', None)
                if connection:
                    connection.settimeout(left)
                chunk = reader(min(65536, 1_000_001 - size))
                if not chunk:
                    break
                chunks.append(chunk)
                size += len(chunk)
            body = b''.join(chunks)
            if len(body) > 1_000_000:
                return {'error': 'response_too_large'}, b''
            return {'http_code': response.status, 'time_total': round(time.monotonic() - started, 3), 'bytes': len(body)}, body
    except urllib.error.HTTPError as error:
        return {'http_code': error.code, 'error': 'http_rejected'}, b''
    except Exception as error:
        reason = getattr(error, 'reason', error)
        return {'http_code': 0, 'error': type(reason).__name__, 'errno': getattr(reason, 'errno', None),
                'time_total': round(time.monotonic() - started, 3)}, b''


def run(budget=90, detail_ids=()):
    if len(detail_ids) > 2 or any(not re.fullmatch(r'[0-9]{1,20}', identifier) for identifier in detail_ids):
        raise ValueError('At most two numeric Nankai detail IDs')
    started = time.monotonic()
    report = {'schema_version': 1, 'checked_at': dt.datetime.now(dt.timezone.utc).isoformat(),
              'proxy_configured': bool(urllib.request.getproxies().get('https')), 'requests': []}
    try:
        dns = subprocess.run([sys.executable, '-c',
            "import socket,json; print(json.dumps(sorted(set('IPv6' if a[0]==socket.AF_INET6 else 'IPv4' for a in socket.getaddrinfo('career.nankai.edu.cn',443,type=socket.SOCK_STREAM)))))"],
            capture_output=True, timeout=5, text=True)
        report['dns_families'] = json.loads(dns.stdout) if dns.returncode == 0 else []
    except Exception as error:
        report['dns_error'] = type(error).__name__
    blocked, discovered = False, {}

    def read(url, mode, stage):
        nonlocal blocked
        left = budget - (time.monotonic() - started)
        if blocked or left < 3:
            return None
        if report['requests']:
            time.sleep(0.4)
        try:
            values, body = urllib_probe(url, min(10, left - 1)) if mode == 'urllib' else curl_probe(url, mode, min(10, left - 1))
            facts, links = page_facts(body)
            values.update(facts)
            discovered[mode] = links or discovered.get(mode, [])
        except Exception as error:
            values = {'http_code': 0, 'error': type(error).__name__}
        values.update(stage=stage, mode=mode, source_path=urllib.parse.urlsplit(url).path)
        report['requests'].append(values)
        blocked = values.get('http_code') in (403, 420, 429)
        return values

    modes = ['urllib', 'ipv4', 'ipv6'] + (['system'] if report['proxy_configured'] else [])
    for mode in modes:
        read(LIST, mode, 'list')
    working = next((row['mode'] for row in report['requests'] if row['stage'] == 'list' and
                    row.get('http_code') == 200 and row.get('list_links', 0) > 0), None)
    if working:
        urls = [f'{ORIGIN}/correcruit/content/id/{identifier}.html' for identifier in detail_ids] or discovered[working][:2]
        for url in urls:
            read(url, working, 'detail')
        read(CALENDAR, working, 'calendar')
    report['stopped_after_rejection'] = blocked
    report['verified_details'] = sum(row['stage'] == 'detail' and row.get('http_code') == 200 and
                                    row.get('detail_container', False) and row.get('text_characters', 0) >= 80 for row in report['requests'])
    report['working_mode'] = working
    report['elapsed_seconds'] = round(time.monotonic() - started, 2)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--detail-ids', default='', help='Up to two known failing numeric IDs, comma separated')
    args = parser.parse_args()
    report = run(detail_ids=tuple(filter(None, args.detail_ids.split(','))))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    main()
