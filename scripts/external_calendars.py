"""Public calendar adapters. Never derive work cities from a campus venue."""
import datetime as dt
import re
from urllib.parse import urljoin
from bs4 import BeautifulSoup


def nankai_calendar(html, base):
    soup = BeautifulSoup(html, 'html.parser')
    items = []
    for link in soup.select('a[href]'):
        if not re.search(r'/recruitment/content/type/2/id/\d+\.html', link['href']):
            continue
        # Each row contains the held date; it is not a publication timestamp.
        row = link.parent
        date = re.search(r'20\d{2}-\d{2}-\d{2}', row.get_text(' ', strip=True))
        if not date:
            continue
        dt.date.fromisoformat(date[0])
        title = link.get_text(' ', strip=True)
        title = re.sub(r'20\d{2}-\d{2}-\d{2}', '', title).strip()
        items.append({'url': urljoin(base, link['href']), 'title': title,
            'published_at': None, 'kind': '宣讲会',
            'structured': {'fairDate': date[0], 'schoolName': '南开大学'}})
    if not items:
        raise ValueError('Nankai calendar rows missing; cannot infer an empty calendar')
    total = 2 if soup.select_one('a[href*="/p/2.html"]') else 1
    return items, total


def nankai_event(html, item):
    soup = BeautifulSoup(html, 'html.parser')
    text = soup.get_text(' ', strip=True)
    date = re.search(r'时间[：:]\s*(20\d{2}-\d{2}-\d{2})\s+([012]?\d:[0-5]\d)', text)
    venue = re.search(r'地点[：:]\s*(.*?)(?=浏览量[：:]|招收专业[：:]|$)', text)
    if not date or not venue or not venue[1].strip():
        raise ValueError('Nankai event time/venue not explicit')
    return dict(item, structured={**(item.get('structured') or {}), 'fairDate': date[1],
        'fairStartTime': date[2], 'schoolName': '南开大学', 'fairAddress': venue[1].strip()[:240]})


def pku_calendar(payload, base):
    if payload.get('state') != 1 or not isinstance(payload.get('object', {}).get('list'), list):
        raise ValueError('PKU public calendar unavailable or changed')
    page = payload['object']
    items = []
    for row in page['list']:
        start, end = row.get('startTime') or '', row.get('endTime') or ''
        if not re.fullmatch(r'20\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}', start):
            continue
        dt.datetime.fromisoformat(start)
        items.append({'identity': 'pku-calendar:' + row['id'], 'url': urljoin(base, row['url']),
            'title': row['title'], 'published_at': None, 'kind': '宣讲会',
            'structured': {'fairDate': start[:10], 'fairStartTime': start[11:16],
                'fairEndTime': end[11:16] if end and end[:10] == start[:10] else None,
                'schoolName': '北京大学', 'fairAddress': row.get('fieldExport') or ''}})
    return items, max(1, int(page.get('totalPage') or 1))
