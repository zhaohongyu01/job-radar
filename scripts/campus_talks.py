"""Public campus calendars: event facts do not assert recruitment eligibility."""
import re
import datetime as dt
from urllib.parse import urlencode, urljoin
from bs4 import BeautifulSoup

SDU_CALENDAR = 'https://jobcareer.sdu.edu.cn/eweb/jygl/index.so?type=ssoSearchXnzp&xjhType=all'


def bysjy_calendar(payload, source):
    """Normalize the public calendar, never employer/job-city fields."""
    if payload.get('code') != 1 or not isinstance(payload.get('data'), list):
        raise ValueError('School calendar did not return a valid public list')
    items = []
    for row in payload['data']:
        identifier = str(row.get('career_talk_id') or '')
        if not identifier.isdigit() or not row.get('meet_day') or not row.get('meet_name'):
            raise ValueError('School calendar row missing identity/date/title')
        venue = str(row.get('address') or '')
        if str(row.get('is_yun', '0')) != '0':
            venue = '线上宣讲 ' + venue
        title = row['meet_name']
        if str(row.get('career_state')) == '1':
            title = '已取消：' + title
        items.append({'url': urljoin(source['url'], '/detail/career?id=' + identifier),
            'title': title, 'published_at': None, 'kind': '招聘公告', 'calendar_only': True,
            'structured': {'fairDate': row['meet_day'], 'fairStartTime': row.get('meet_time'),
                'fairEndTime': row.get('meet_end_time'), 'schoolName': source['school_name'],
                'fairAddress': venue}})
    return items


def sdu_calendar(html):
    soup = BeautifulSoup(html, 'html.parser')
    if not soup.select('#weekI'):
        raise ValueError('SDU weekly calendar missing; refuse login/error page')
    items = []
    for row in soup.select('li.xjhli'):
        links = row.select('a[onclick*="viewXjhxx"]')
        if not links:
            continue  # empty day in the weekly calendar
        if len(links) < 3:
            raise ValueError('SDU calendar row missing title/venue/time')
        match = re.search(r"viewXjhxx\('([^']+)'", links[0].get('onclick', ''))
        stamp = links[2].get_text(' ', strip=True).replace('：', ':')
        date = re.search(r'20\d{2}-\d{2}-\d{2}', stamp)
        times = re.findall(r'\d{2}:\d{2}', stamp)
        if not match or not date or len(times) != 2:
            raise ValueError('SDU calendar row has invalid identity/date/time')
        title = links[0].get_text(' ', strip=True)
        venue = links[1].get('title') or links[1].get_text(' ', strip=True)
        url = 'https://jobcareer.sdu.edu.cn/eweb/jygl/index.so?' + urlencode({
            'modcode': 'jygl_xjhxxck', 'subsyscode': 'zpfw', 'rklx': 'jyw',
            'lmxhV': '0401', 'type': 'ssoXnzpView', 'id': match[1]})
        items.append({'url': url, 'title': title, 'published_at': None, 'kind': '招聘公告',
            'structured': {'fairDate': date[0], 'fairStartTime': times[0],
                'fairEndTime': times[1], 'schoolName': '山东大学', 'fairAddress': venue}})
    return items


def sdu_recruitment_body(html):
    """Exclude employer address and event venue from job work-city inference."""
    soup = BeautifulSoup(html, 'html.parser')
    sections = soup.select('.bd_one')
    body = next((s for s in sections if '招聘信息' in s.get_text()), None)
    if body is None:
        raise ValueError('SDU talk recruitment section missing')
    company = soup.select_one('.ggName')
    return str(body), company.get_text(' ', strip=True) if company else ''


def sdnu_graduate_list(html, base):
    soup = BeautifulSoup(html, 'html.parser')
    rows = soup.select('li.he_cntzriboli')
    if not rows:
        raise ValueError('SDNU graduate recruitment list missing')
    items = []
    for row in rows:
        link, title = row.select_one('a[href]'), row.select_one('.he_title5')
        year, day = row.select_one('.he_title6'), row.select_one('.he_title2')
        if not all((link, title, year, day)):
            raise ValueError('SDNU graduate list row missing date/title')
        published = year.get_text(strip=True) + '-' + day.get_text(strip=True)
        dt.date.fromisoformat(published)
        items.append({'url': urljoin(base, link['href']), 'title': title.get_text(' ', strip=True),
                      'published_at': published, 'kind': '宣讲会'})
    return items


def sdnu_graduate_event(html, item):
    body = BeautifulSoup(html, 'html.parser').select_one('#vsb_content')
    if body is None:
        raise ValueError('SDNU graduate article missing')
    compact = re.sub(r'\s+', '', body.get_text(' ', strip=True))
    schedule = re.search(r'宣讲时间[：:](.*?)(?=咨询时间|地点|$)', compact)
    if not schedule:
        raise ValueError('Article has no explicit talk schedule')
    date = re.search(r'(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日', schedule[1])
    times = re.findall(r'(?<!\d)(?:[01]?\d|2[0-3])[:：][0-5]\d', schedule[1])
    if not date or not times:
        raise ValueError('Talk date/time missing')
    year = date[1]
    if not year:
        years = {y for y, m, d in re.findall(r'(20\d{2})年(\d{1,2})月(\d{1,2})日', compact)
                 if int(m) == int(date[2]) and int(d) == int(date[3])}
        if len(years) != 1:
            raise ValueError('Talk year not explicit; refuse to guess from publication date')
        year = years.pop()
    venue = next((re.sub(r'^地点[：:]', '', re.sub(r'\s+', '', p.get_text(' ', strip=True)))
                  for p in body.select('p') if re.match(r'^地点[：:]', re.sub(r'\s+', '', p.get_text(' ', strip=True)))), '')
    if not venue or len(venue) > 240:
        raise ValueError('Talk venue missing or ambiguous')
    def clock(value):
        hour, minute = (int(n) for n in value.replace('：', ':').split(':'))
        if '下午' in schedule[1] and hour < 12:
            hour += 12
        return f'{hour:02d}:{minute:02d}'
    return dict(item, structured={'fairDate': dt.date(int(year), int(date[2]), int(date[3])).isoformat(),
        'fairStartTime': clock(times[0]), 'fairEndTime': clock(times[1]) if len(times) > 1 else None,
        'schoolName': '山东师范大学', 'fairAddress': venue})
