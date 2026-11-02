"""Public calendar adapters. Never derive work cities from a campus venue."""
import datetime as dt
import base64
import json
import re
import zlib
import urllib.error
import urllib.robotparser
from urllib.parse import urljoin, urlencode, urlsplit
from bs4 import BeautifulSoup


PUBLIC_HOME_CALENDARS = {
    'upc-talks-public': 'https://career.upc.edu.cn',
    'sjtu-campus-events': 'https://www.job.sjtu.edu.cn',
}


def check_home_calendar_robots(fetch, source, user_agent):
    origin = PUBLIC_HOME_CALENDARS.get(source['id'])
    if not origin or source['url'] != origin + '/career/index':
        raise ValueError('Unverified school homepage calendar')
    try:
        text = fetch(origin + '/robots.txt', timeout=6, retries=0)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return
        raise
    if 'user-agent' not in text.lower() or '<html' in text.lower():
        raise ValueError('School homepage robots unavailable')
    robot = urllib.robotparser.RobotFileParser()
    robot.parse(text.splitlines())
    if not robot.can_fetch(user_agent, source['url']):
        raise PermissionError('School homepage robots denies collection')


def public_home_calendar(document, source):
    """A finite public homepage window, never pretend it is the full calendar."""
    origin = PUBLIC_HOME_CALENDARS.get(source['id'])
    if not origin or source['url'] != origin + '/career/index':
        raise ValueError('Unverified school homepage calendar')
    soup = BeautifulSoup(document, 'html.parser')
    items = []

    def path_from(node, kind):
        match = re.fullmatch(r'windowOpen\((".*")\)', node.get('onclick', ''))
        path = json.loads(match[1]).replace('\\/', '/') if match else ''
        if not re.fullmatch(r'/career/' + kind + r'/view/\d+', path):
            raise ValueError('Homepage event path missing or changed')
        return origin + path

    def add(url, title, date, start, venue, online=False):
        dt.date.fromisoformat(date)
        dt.time.fromisoformat(start)
        if not title or not venue or not re.fullmatch(r'20\d{2}-\d{2}-\d{2}', date):
            raise ValueError('Homepage event facts missing')
        items.append({'url': url, 'title': title, 'published_at': None, 'kind': '宣讲会',
            'calendar_only': True, 'structured': {'fairDate': date, 'fairStartTime': start,
                'schoolName': source['school_name'], 'fairAddress': ('线上宣讲 · ' if online else '') + venue}})

    if source['id'] == 'upc-talks-public':
        headings = [x.get_text(strip=True) for x in soup.select('.jyxx-center-right-title-left h1')]
        sections = soup.select('.jyxx-center-right-content')
        if headings[:2] != ['宣讲会', '空中宣讲'] or len(sections) < 2:
            raise ValueError('School public calendar window changed')
        for index, section in enumerate(sections[:2]):
            for row in section.select('.jyxx-center-right-content-ul-li'):
                parent = row.find_parent('li', onclick=True)
                day, month, title = [row.select_one(selector) for selector in
                    ('.jyxx-center-right-content-ul-li-left-day', '.jyxx-center-right-content-ul-li-left-month', 'h2')]
                paragraphs = row.select('.jyxx-center-right-content-ul-li-right p')
                if parent is None or None in (day, month, title) or len(paragraphs) != 2:
                    raise ValueError('School public calendar row missing')
                clock = re.fullmatch(r'时间[：:]\s*(\d{2}:\d{2})', paragraphs[1].get_text(strip=True))
                if not clock:
                    raise ValueError('School public calendar clock missing')
                date = month.get_text(strip=True).replace('/', '-') + '-' + day.get_text(strip=True).zfill(2)
                add(path_from(parent, 'xjhxx'), title.get_text(strip=True), date, clock[1],
                    paragraphs[0].get_text(' ', strip=True), index == 1)
    else:
        for row in soup.select('.inviteSxhList'):
            title = row.select_one('.sxhzbf')
            address = row.select_one('.sxhAddress')
            parts = address.find_all('div', recursive=False) if address else []
            clock = re.fullmatch(r'举办日期[：:]\s*(20\d{2}-\d{2}-\d{2}) (\d{2}:\d{2})', parts[0].get_text(strip=True)) if len(parts) == 3 else None
            if not title or not clock:
                raise ValueError('School public campus event time missing')
            add(path_from(row, 'zphxx'), title.get_text(strip=True), clock[1], clock[2], parts[2].get_text(strip=True))
    if not 1 <= len(items) <= 50 or len({item['url'] for item in items}) != len(items):
        raise ValueError('School public calendar window missing or repeated')
    return items, 1


def check_jysd_robots(fetch, source, user_agent='*'):
    origin = 'https://job.hdu.edu.cn'
    if source.get('id') != 'hdu-talks' or urlsplit(source['url']).hostname != 'job.hdu.edu.cn':
        raise ValueError('Unverified JYSD calendar source')
    try:
        text = fetch(origin + '/robots.txt', timeout=6, retries=0)
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return
        raise
    if 'user-agent' not in text.lower() or '<html' in text.lower():
        raise ValueError('Calendar robots unavailable')
    robot = urllib.robotparser.RobotFileParser()
    robot.parse(text.splitlines())
    for url in (source['url'], origin + '/teachin/index/do1/job.hdu.edu.cn/domain/hdu/page/2'):
        if not robot.can_fetch(user_agent, url):
            raise PermissionError('Calendar robots denies collection')
    return robot


def jysd_calendar(html, source):
    """HDU's public HTML fragment: zlib/base64 packaging, never execute scripts.

    Only the exact observed presentation wrapper is accepted. Authentication,
    challenge pages and unknown wrappers fail closed instead of reporting zero.
    """
    if source.get('id') != 'hdu-talks' or urlsplit(source['url']).hostname != 'job.hdu.edu.cn':
        raise ValueError('Unverified JYSD calendar source')
    pattern = r'Base64\.decode\(unzip\("([A-Za-z0-9+/=]{1,200000})"\)\.substr\((\d{1,3})\)\)\.substr\((\d{1,3})\)\)'
    matches = list(re.finditer(pattern, html))
    if len(matches) != 1:
        raise ValueError('Public calendar fragment missing or changed')
    encoded, outer, inner = matches[0].groups()
    # Prefix lengths are randomized per response; they are literal offsets,
    # not a new script format. Never evaluate JS or search for guessed offsets.
    unpack = zlib.decompressobj()
    raw = unpack.decompress(base64.b64decode(encoded, validate=True), 1_000_001)
    if len(raw) > 1_000_000 or not unpack.eof or unpack.unused_data:
        raise ValueError('Public calendar fragment too large or incomplete')
    if int(outer) >= len(raw):
        raise ValueError('Public calendar outer offset outside fragment')
    decoded = base64.b64decode(raw[int(outer):], validate=True).decode('utf-8')
    if int(inner) >= len(decoded):
        raise ValueError('Public calendar inner offset outside fragment')
    fragment = decoded[int(inner):]
    soup = BeautifulSoup(fragment, 'html.parser')
    rows, items = soup.select('ul.teachinList'), []
    if not rows or len(rows) > 100:
        raise ValueError('Public calendar rows missing or changed')
    for row in rows:
        cells, link = row.find_all('li', recursive=False), row.select_one('a[href]')
        if len(cells) != 3 or not link or not re.fullmatch(r'/teachin/view/id/\d+', link['href']):
            raise ValueError('Public calendar identity missing')
        title, venue = link.get_text(' ', strip=True), cells[1].get_text(' ', strip=True)
        schedule = cells[2].get_text(' ', strip=True)
        date = re.fullmatch(r'(20\d{2}-\d{2}-\d{2}) (\d{2}:\d{2})-(\d{2}:\d{2})[（(]周.[）)]', schedule)
        if not title or not venue or not date:
            raise ValueError('Public calendar time/venue missing')
        dt.date.fromisoformat(date[1])
        if dt.time.fromisoformat(date[3]) < dt.time.fromisoformat(date[2]):
            raise ValueError('Public calendar reversed times')
        mode = row.select_one('.status-text')
        mode = mode.get_text(strip=True) if mode else ''
        if mode not in {'线上', '线下'}:
            raise ValueError('Public calendar mode changed')
        if mode == '线上':
            venue = '线上宣讲 · ' + venue
        items.append({'url': urljoin(source['url'], link['href']), 'title': title,
            'published_at': None, 'kind': '宣讲会', 'calendar_only': True,
            'structured': {'fairDate': date[1], 'fairStartTime': date[2], 'fairEndTime': date[3],
                'schoolName': source['school_name'], 'fairAddress': venue}})
    pages = [int(m[1]) for link in soup.select('a[href]')
             if (m := re.fullmatch(r'/teachin/index/do1/job\.hdu\.edu\.cn/domain/hdu/page/(\d+)', link['href']))]
    if not pages:
        raise ValueError('Public calendar pagination missing')
    return items, max(pages)


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


def tongji_calendar(payload, base):
    """Tongji's anonymous calendar, including explicit online/physical mode."""
    page = payload.get('object') or {}
    if payload.get('state') != 1 or not isinstance(page.get('list'), list):
        raise ValueError('Tongji public calendar unavailable; refuse login/error response')
    total, count = page.get('totalPage'), page.get('count')
    if type(total) is not int or total < 0 or type(count) is not int or count < len(page['list']):
        raise ValueError('Tongji calendar pagination changed')
    items = []
    for row in page['list']:
        identifier, start = row.get('id') or '', row.get('startTime') or ''
        end, title = row.get('endTime') or '', row.get('title') or ''
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', identifier) or not title or not re.fullmatch(r'20\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}', start):
            raise ValueError('Tongji calendar identity/date missing')
        dt.datetime.fromisoformat(start)
        if end:
            if not re.fullmatch(r'20\d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}', end) or dt.datetime.fromisoformat(end) < dt.datetime.fromisoformat(start):
                raise ValueError('Tongji calendar end date invalid')
        url = urljoin(base, row.get('url') or '')
        if urlsplit(url).scheme != 'https' or urlsplit(url).hostname not in {'tj91.tongji.edu.cn', 'tjjyzx.tongji.edu.cn'}:
            raise ValueError('Tongji calendar link left the official source')
        venue = row.get('fieldExport') or row.get('place') or ''
        if row.get('fairTypeName') in {'空宣', '空中宣讲会', '线上'}:
            venue = '线上宣讲 · ' + venue
        items.append({'identity': 'tongji-calendar:' + identifier, 'url': url, 'title': title,
            'published_at': None, 'kind': '宣讲会', 'calendar_only': True,
            'structured': {'fairDate': start[:10], 'fairStartTime': start[11:16],
                'fairEndTime': end[11:16] if end and end[:10] == start[:10] else None,
                'schoolName': '同济大学', 'fairAddress': venue}})
    return items, max(1, total)
