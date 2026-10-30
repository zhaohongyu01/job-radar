"""Public calendar adapters. Never derive work cities from a campus venue."""
import datetime as dt
import re
from urllib.parse import urljoin, urlencode
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
    pages = [int(match[1]) for link in soup.select('a[href]')
             if (match := re.search(r'/recruitment/index2/p/(\d+)\.html(?:[?#].*)?$', link['href']))]
    total = max(pages, default=1)
    return items, total


def public_calendar_source(source):
    """Old two-page metadata cannot prove that the official calendar ended."""
    row = dict(source)
    if row.get('id') == 'nankai-talks' and row.get('calendar_pagination_version') != 1:
        row['list_complete'] = False
        pages = row.get('pages_read') or row.get('pages') or 0
        row['coverage'] = f'最近 {pages} 页；旧分页信息不足，更多安排待核实'
    return row


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


def js91_calendar(payload, source, page_size=20):
    """Normalize the verified anonymous school calendar, without private contacts."""
    page = payload.get('result') or {}
    if payload.get('code') != 200 or payload.get('success') is not True or not isinstance(page.get('records'), list):
        raise ValueError('School public calendar unavailable; refuse error/login response')
    total = page.get('total')
    if type(total) is not int or total < len(page['records']) or len(page['records']) > page_size:
        raise ValueError('School calendar pagination changed')
    items = []
    for row in page['records']:
        identifier, date, title = str(row.get('xjhid') or ''), row.get('jbrq') or '', row.get('xjhmc') or ''
        if not identifier.isdigit() or not title or not re.fullmatch(r'20\d{2}-\d{2}-\d{2}', date) or row.get('jbxx') != source['school_name']:
            raise ValueError('School calendar identity/date/school changed')
        dt.date.fromisoformat(date)
        schedule = row.get('kssjd') or ''
        if re.findall(r'20\d{2}-\d{2}-\d{2}', schedule) not in ([], [date]):
            raise ValueError('School calendar conflicting dates')
        times = re.findall(r'(?<!\d)(?:[01]?\d|2[0-3]):[0-5]\d', schedule)
        if not times:
            raise ValueError('School calendar start time missing')
        start = dt.time.fromisoformat(times[0].zfill(5)).isoformat(timespec='minutes')
        end = times[1].zfill(5) if len(times) > 1 else None
        items.append({'identity': f"js91:{source['school_code']}:{identifier}",
            'url': urljoin(source['url'], '/sub-station/lectureDetail') + '?' + urlencode({'xxdm': source['school_code'], 'xjhid': identifier}),
            'title': title, 'published_at': None, 'kind': '宣讲会', 'calendar_only': True,
            'structured': {'fairDate': date, 'fairStartTime': start, 'fairEndTime': end,
                'schoolName': source['school_name'], 'fairAddress': row.get('jbdd') or ''}})
    return items, max(1, (total + page_size - 1) // page_size)
