"""Bounded, repeatable announcement collection. No login or application submission.

python scripts/collect.py --pages 8 --days 30
Source failures preserve old records and their last successful verification.
"""
from __future__ import annotations
import argparse
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
import datetime as dt
import hashlib
import html as html_lib
import http.client
import http.cookiejar
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import socket
import time
import urllib.parse
import urllib.request
import collector_runtime
from bs4 import BeautifulSoup
from collector_runtime import bounded_read, bounded_request, pace, remaining, retry_request

ROOT = Path(__file__).resolve().parents[1]
TZ = dt.timezone(dt.timedelta(hours=8))
CITIES = '济南 青岛 淄博 枣庄 东营 烟台 潍坊 济宁 泰安 威海 日照 临沂 德州 聊城 滨州 菏泽 北京 天津 上海 重庆 南京 苏州 杭州 宁波 合肥 福州 厦门 广州 深圳 珠海 东莞 佛山 武汉 长沙 郑州 西安 成都 昆明 贵阳 南昌 南宁 海口 太原 石家庄 沈阳 大连 长春 哈尔滨 兰州 西宁 银川 乌鲁木齐 拉萨'.split()
LOCATION_LABEL = r'(?:工作地点|工作城市|岗位地点|工作地域|招聘地点|招聘机构|工作区域|意向工作地|意向城市|工作地|招聘城市|所属分行|所属分公司)'
PROVINCES_LIST = '北京 天津 上海 重庆 河北 山西 辽宁 吉林 黑龙江 江苏 浙江 安徽 福建 江西 山东 河南 湖北 湖南 广东 广西 海南 四川 贵州 云南 陕西 甘肃 青海 宁夏 新疆 内蒙古 西藏 香港 澳门 台湾'.split()

try:
    from parse_positions import extract_all_positions, enrich_job_with_positions, deduplicate_positions, split_majors
except ImportError:
    try:
        from scripts.parse_positions import extract_all_positions, enrich_job_with_positions, deduplicate_positions, split_majors
    except ImportError:
        def extract_all_positions(html, **kw): return []
        def enrich_job_with_positions(job, positions): return job
        def deduplicate_positions(positions): return positions
        def split_majors(text): return []


def extract_locations_from_text(evidence, text, title='', company=''):
    evidence = list(evidence)
    lines = text.splitlines()
    for index, line in enumerate(lines):
        m = re.search(LOCATION_LABEL + r'[\]】 ：:\t]*(.*)', line)
        if m:
            value = m[1].strip() or (lines[index + 1] if index + 1 < len(lines) else '')
            if value and len(value) >= 2 and not re.match(r'^(?:详见|点击|扫码|请先|岗位表$)', value):
                evidence.append('工作地点：' + value[:1200])

    name_scope = f"{title} {company}"
    for city in CITIES:
        if re.search(rf'{city}(?:市)?(?:分行|分公司|支行|管辖行)', name_scope):
            evidence.append(f'工作地点：{city}（标题/单位明确分支机构）')
        if re.search(rf'[（(]{city}(?:市)?[）)]', name_scope):
            evidence.append(f'工作地点：{city}（标题/单位标注地点）')
    explicit_cities = [c for c in CITIES if any(c in s for s in evidence if s.startswith('工作地点：') and not s.endswith('（标题/单位明确企事业单位或机构）'))]

    for city in CITIES:
        if re.search(
            rf'(?:^|[（(山东省]{{0,4}}){city}(?:市)?'
            r'[一二三四五六七八九十\u4e00-\u9fa5]{0,10}?'
            r'(?:医院|幼保院|妇幼保健院|疾控中心|疾病预防控制|卫生院|卫生健康|卫健|急救中心|血站|'
            r'中小学|小学|初中|高中|中学|实验学校|师范附属|职业学院|职业技术学院|技工学校|技师学院|'
            r'设计院|研究院|规划院|勘察院|科研院|勘测院|科学院|农科院|林科院|'
            r'水务|热电|公交|地铁|轨道交通|交投|城投|城建|建投|国投|产投|发投|文旅|环保|水利|'
            r'机关事务|人才服务|公证处|生态环境|市场监管|医疗保障|住房公积金|自然资源|住房和城乡建设|民政局|司法局|财政局|教育局|卫健委|'
            r'管理委员会|管委会|街道办事处|委员会|局|所|中心|站|队|台|馆|社)',
            name_scope,
        ):
            if not explicit_cities:
                evidence.append(f'工作地点：{city}（标题/单位明确企事业单位或机构）')
            elif city not in explicit_cities:
                evidence.append(f'用人单位所在地：{city}（机构隶属地，以正文工作地点为准）')

    for province in PROVINCES_LIST:
        if re.search(rf'{province}(?:省)?(?:分行|分公司|分院|管辖行)', name_scope):
            evidence.append(f'工作地点：{province}省各分支机构（标题/单位明确机构）')

    return filter_institution_locations(list(dict.fromkeys(evidence)))


def filter_institution_locations(evidence):
    explicit = [c for c in CITIES if any(c in s for s in evidence if not s.endswith('（标题/单位明确企事业单位或机构）') and not s.startswith('用人单位所在地：'))]
    if not explicit:
        return list(evidence)
    res = []
    for s in evidence:
        if s.endswith('（标题/单位明确企事业单位或机构）'):
            m = re.match(r'^工作地点：([^\(]+)', s)
            if m:
                city = m.group(1).strip()
                if city not in explicit:
                    res.append(f'用人单位所在地：{city}（机构隶属地，以正文工作地点为准）')
                    continue
        res.append(s)
    return res

SOURCES = [
    {'id': 'nankai', 'name': '南开大学就业网', 'url': 'https://career.nankai.edu.cn/correcruit/index.html'},
    {'id': 'jinan', 'name': '济南市政府 · 求职招聘', 'url': 'https://www.jinan.gov.cn/zt/2025nzt/yhyshj/rcbf/qzzp/index.html'},
    {'id': 'sdu', 'name': '山东大学就业信息网', 'url': 'https://jobcareer.sdu.edu.cn/eweb/jygl/index.so?modcode=null&subsyscode=zpfw&type=ssoSearchZxzp&xxlb=5100'},
    {'id': 'hrss', 'name': '济南市人社局 · 事业单位招聘',
     'url': 'https://jnhrss.jinan.gov.cn/col/col18625/index.html', 'adapter': 'jinan_cms',
     'cms_web_id': '16', 'cms_page_id': '18625', 'cms_tag_id': '当前栏目标题',
     'cms_tpl_set_id': 'MAMvqpH003gztRDn5troz', 'allow_empty_pages': True,
     'exclude_title_re': r'拟聘|拟录用|录用名单|名单公示|结果公示|体检通知|递补|资格复审|面试|笔试|成绩|考察'},
    {'id': 'jinan-employment', 'name': '济南人社 · 公共就业招聘',
     'url': 'https://jnhrss.jinan.gov.cn/col/col18309/index.html', 'adapter': 'jinan_cms',
     'cms_web_id': '16', 'cms_page_id': '18309', 'cms_tag_id': '当前栏目标题',
     'cms_tpl_set_id': 'MAMvqpH003gztRDn5troz', 'allow_empty_pages': True,
     'include_title_re': r'招聘|招募|岗位|就业大集|求职',
     'exclude_title_re': r'拟聘|拟录用|录用名单|名单公示|结果公示|体检通知|递补|资格复审|面试|笔试|成绩|考察|圆满举办|成功举办|活动回顾'},
    {'id': 'gzw', 'name': '济南市国资委 · 国企招聘',
     'url': 'https://jngzw.jinan.gov.cn/col/col23870/index.html', 'adapter': 'jinan_cms',
     'cms_web_id': '37', 'cms_page_id': '23870', 'cms_tag_id': '信息标题',
     'cms_tpl_set_id': 'qRnIbtU5GwoFGC9hjemFn', 'allow_empty_pages': True,
     'exclude_title_re': r'拟聘|拟录用|录用名单|名单公示|结果公示|体检通知|递补|资格复审|面试|笔试|成绩|考察'},
]
SDEI_SCHOOLS = [
    ('jobsdufe', '山东财经大学'), ('ujn', '济南大学'), ('sdut', '山东理工大学'), ('qlu', '齐鲁工业大学'),
    ('sdnu', '山东师范大学'), ('sdsmu', '山东第二医科大学'), ('qust', '青岛科技大学'), ('qdu', '青岛大学'),
    ('ytu', '烟台大学'), ('ldu', '鲁东大学'), ('sdfmu', '山东第一医科大学'),
    ('bzmc', '滨州医学院'), ('lcu', '聊城大学'), ('lyu', '临沂大学'),
    ('sdtbu', '山东工商学院'), ('dzu', '德州学院'), ('sdua', '山东农业工程学院'),
]
CORE_SDEI_SCHOOLS = {'jobsdufe', 'ujn', 'sdnu', 'qlu'}
ROTATING_SDEI_GROUPS = [
    ['qdu', 'qust', 'ytu', 'ldu'],
    ['sdsmu', 'sdfmu', 'bzmc'],
    ['sdut', 'lcu', 'lyu'],
    ['sdtbu', 'dzu', 'sdua'],
]


def get_active_sdei_schools(now_dt=None, force_group=None, deep_scan=False):
    """Determine which SDEI schools are active for this collection run.

    CORE schools are collected every run.
    Rotating schools are divided into 4 groups by day-of-year.
    If deep_scan is True, all schools are active.
    """
    if deep_scan:
        return {s[0] for s in SDEI_SCHOOLS}, -1
    if force_group is not None and 0 <= force_group < len(ROTATING_SDEI_GROUPS):
        active_group = force_group
    else:
        now = now_dt or dt.datetime.now(TZ)
        active_group = now.timetuple().tm_yday % len(ROTATING_SDEI_GROUPS)
    active = set(CORE_SDEI_SCHOOLS)
    active.update(ROTATING_SDEI_GROUPS[active_group])
    return active, active_group


for school, name in SDEI_SCHOOLS:
    for channel, label in [('announcements', '招聘公告'), ('positions', '具体岗位')]:
        SOURCES.append({'id': f'{school}-{channel}', 'name': f'{name} · {label}',
                        'url': f'https://school.gxjy.sdei.edu.cn/{school}/front/JiuYeInfo?type=' + ('zwxx' if channel == 'positions' else 'zpgg'),
                        'adapter': 'sdei', 'school': school, 'channel': channel})
SOURCES.append({'id': 'upc', 'name': '中国石油大学（华东）就业网', 'url': 'https://career.upc.edu.cn/career/zpxx/zpxx', 'adapter': 'upc'})
SOURCES.append({'id': 'qdhrss', 'name': '青岛市人社局 · 招聘与引才', 'url': 'https://hrss.qingdao.gov.cn/zxzx_47/tzgg_47/', 'adapter': 'qdhrss'})
SOURCES.append({'id': 'wondercv', 'name': '超级简历 · 公开校招线索', 'url': 'https://www.wondercv.com/xiaozhao/', 'adapter': 'wondercv'})
SOURCES.append({'id': 'offerjack', 'name': 'Jacky学长校招 · 公开招聘线索', 'url': 'https://www.offerjack.cn/', 'adapter': 'offerjack'})
# Province-wide and sector-specific official sources.  These are deliberately
# kept separate from university feeds: the province hub contains cross-school
# announcements, while bank sites also publish social recruitment.
SOURCES.extend([
    {'id': 'sdei-news', 'name': '山东省大学生就业服务平台 · 招聘速递',
     'url': 'https://gxjy.sdei.edu.cn/channel.jsp?classid=96', 'adapter': 'sdei_news',
     'scope': '山东及全国', 'recruitment_types': ['校招', '社招', '事业单位'],
     'sectors': ['综合'], 'trust': '官方原始来源', 'source_family': '山东省大学生就业服务平台'},
    {'id': 'boc-recruitment', 'name': '中国银行 · 官方招聘公告',
     'url': 'https://www.boc.cn/aboutboc/bi4/', 'adapter': 'official_bank',
     'institution': '中国银行', 'bank_type': 'boc', 'scope': '全国',
     'recruitment_types': ['校招', '社招'], 'sectors': ['银行 / 金融'],
     'trust': '官方原始来源', 'source_family': '银行官方招聘'},
    {'id': 'psbc-campus', 'name': '中国邮政储蓄银行 · 校园招聘',
     'url': 'https://www.psbc.com/cn/gyyc/rczp/xyzp/', 'adapter': 'official_bank',
     'institution': '中国邮政储蓄银行', 'bank_type': 'psbc', 'default_type': '校招',
     'scope': '全国', 'recruitment_types': ['校招'], 'sectors': ['银行 / 金融'],
     'trust': '官方原始来源', 'source_family': '银行官方招聘'},
    {'id': 'psbc-social', 'name': '中国邮政储蓄银行 · 社会招聘',
     'url': 'https://www.psbc.com/cn/gyyc/rczp/shzp/', 'adapter': 'official_bank',
     'institution': '中国邮政储蓄银行', 'bank_type': 'psbc', 'default_type': '社招',
     'scope': '全国', 'recruitment_types': ['社招'], 'sectors': ['银行 / 金融'],
     'trust': '官方原始来源', 'source_family': '银行官方招聘'},
    {'id': 'taiping-campus', 'name': '中国太平保险集团 · 校园招聘',
     'url': 'https://cntp.zhiye.com/campus/', 'adapter': 'zhiye_jobs',
     'portal_id': '14bf3434-2af8-4708-941b-00db329d9a17', 'business_type': '2',
     'institution': '中国太平保险集团', 'default_type': '校招', 'pack': 'finance',
     'scope': '全国', 'recruitment_types': ['校招'], 'sectors': ['保险'],
     'trust': '官方招聘平台', 'source_family': '保险官方招聘'},
    {'id': 'taiping-social', 'name': '中国太平保险集团 · 社会招聘',
     'url': 'https://cntp.zhiye.com/social/', 'adapter': 'zhiye_jobs',
     'portal_id': '14bf3434-2af8-4708-941b-00db329d9a17', 'business_type': '1',
     'institution': '中国太平保险集团', 'default_type': '社招', 'pack': 'finance',
     'scope': '全国', 'recruitment_types': ['社招'], 'sectors': ['保险'],
     'trust': '官方招聘平台', 'source_family': '保险官方招聘'},
    {'id': 'haier-campus', 'name': '海尔集团 · 校园招聘',
     'url': 'https://maker.haier.net/client/campus/activityindex.html', 'adapter': 'haier_campus',
     'activity_ids': ['68', '69', '71', '70', '67'], 'institution': '海尔集团',
     'default_type': '校招', 'pack': 'large-enterprises', 'scope': '全国',
     'recruitment_types': ['校招'], 'sectors': ['企业 / 其他'],
     'trust': '官方招聘平台', 'source_family': '大型企业官方招聘'},
    {'id': 'haier-social', 'name': '海尔集团 · 社会招聘',
     'url': 'https://maker.haier.net/client/job/index', 'adapter': 'haier_jobs',
     'institution': '海尔集团', 'default_type': '社招', 'pack': 'large-enterprises',
     'scope': '全国', 'recruitment_types': ['社招'], 'sectors': ['企业 / 其他'],
     'trust': '官方招聘平台', 'source_family': '大型企业官方招聘'},
    {'id': 'hisense-campus', 'name': '海信集团 · 校园招聘',
     'url': 'https://jobs.hisense.com/campus/', 'adapter': 'zhiye_jobs',
     'portal_id': '05f0dd33-82e6-4de1-b950-3d142c9833a1', 'business_type': '2',
     'institution': '海信集团', 'default_type': '校招', 'pack': 'large-enterprises',
     'scope': '全国', 'recruitment_types': ['校招'], 'sectors': ['企业 / 其他'],
     'trust': '官方招聘平台', 'source_family': '大型企业官方招聘'},
    {'id': 'hisense-social', 'name': '海信集团 · 社会招聘',
     'url': 'https://jobs.hisense.com/social/', 'adapter': 'zhiye_jobs',
     'portal_id': '05f0dd33-82e6-4de1-b950-3d142c9833a1', 'business_type': '1',
     'institution': '海信集团', 'default_type': '社招', 'pack': 'large-enterprises',
     'scope': '全国', 'recruitment_types': ['社招'], 'sectors': ['企业 / 其他'],
     'trust': '官方招聘平台', 'source_family': '大型企业官方招聘'},
])
# Keep the source registry self-describing.  The UI can show these fields and
# future city source packs can select them without changing the collector's
# parsing loop.
for _source in SOURCES:
    _adapter = _source.get('adapter')
    _source.setdefault('scope', '国内')
    _source.setdefault('recruitment_types', ['校招'] if _adapter in {'sdei', 'wondercv', 'offerjack'} or _source['id'] in {'nankai', 'sdu', 'upc'} else ['社招', '事业单位', '国企'])
    _source.setdefault('sectors', ['综合'])
    _source.setdefault('trust', '第三方线索' if _adapter in {'wondercv', 'offerjack'} else '官方原始来源')
    _source.setdefault('source_family', _source['name'].split(' · ', 1)[0])

# Keep the CI fan-out definition next to the source registry.  A pack is a
# bounded group of sources that can be collected independently from the same
# historical baseline. Feeds sharing the school platform stay on one runner;
# independent university hosts run in the other pack.
_sdei_source_ids = [s['id'] for s in SOURCES if s.get('adapter') == 'sdei']
SOURCE_PACKS = {
    'regional-official': ['jinan', 'hrss', 'jinan-employment', 'gzw', 'qdhrss', 'sdei-news'],
    'universities-a': ['nankai', 'sdu', 'upc'],
    'universities-b': _sdei_source_ids,
    'finance': [s['id'] for s in SOURCES if s.get('adapter') == 'official_bank' or s.get('pack') == 'finance'],
    'large-enterprises': [s['id'] for s in SOURCES if s.get('pack') == 'large-enterprises'],
    'public-leads': ['wondercv', 'offerjack'],
}
_source_ids = {s['id'] for s in SOURCES}
_packed_source_ids = {source_id for pack in SOURCE_PACKS.values() for source_id in pack}
if _packed_source_ids != _source_ids:
    _missing = ', '.join(sorted(_source_ids - _packed_source_ids))
    _unknown = ', '.join(sorted(_packed_source_ids - _source_ids))
    raise RuntimeError(f'Source pack coverage mismatch; missing={_missing}; unknown={_unknown}')


def source_pack_ids(pack):
    """Return a copy of a named CI source pack and reject empty/unknown packs."""
    if pack not in SOURCE_PACKS:
        raise ValueError(f'unknown source pack: {pack}')
    source_ids = list(SOURCE_PACKS[pack])
    if not source_ids:
        raise ValueError(f'empty source pack: {pack}')
    return source_ids


VOID = {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}


def connect_ipv4_first(address, timeout=socket._GLOBAL_DEFAULT_TIMEOUT, source_address=None):
    """Prefer reachable IPv4 on dual-stack hosts, retain IPv6 fallback and TLS checks."""
    host,port=address
    candidates=socket.getaddrinfo(host,port,0,socket.SOCK_STREAM)
    candidates.sort(key=lambda row: (0 if row[0] == socket.AF_INET else (1 if row[0] == socket.AF_INET6 else 2)))
    error=None
    for family,kind,proto,_,sockaddr in candidates:
        sock=socket.socket(family,kind,proto)
        try:
            if timeout is not socket._GLOBAL_DEFAULT_TIMEOUT: sock.settimeout(remaining(timeout))
            if source_address: sock.bind(source_address)
            sock.connect(sockaddr)
            return sock
        except OSError as exc:
            error=exc
            sock.close()
    raise error or OSError('No address found')


class HTTPSConnection(http.client.HTTPSConnection):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,**kwargs)
        self._create_connection=connect_ipv4_first


class HTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self,req):
        return self.do_open(HTTPSConnection,req,context=self._context)


OPENER=urllib.request.build_opener(HTTPSHandler(), urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


class Node:
    def __init__(self, tag='', attrs=(), parent=None):
        self.tag, self.attrs, self.parent, self.children = tag, dict(attrs), parent, []

    def find(self, tag=None, cls=None, id=None):
        out = []
        for child in self.children:
            if isinstance(child, Node):
                if (tag is None or child.tag == tag) and (cls is None or cls in child.attrs.get('class','').split()) and (id is None or child.attrs.get('id') == id):
                    out.append(child)
                out.extend(child.find(tag, cls, id))
        return out

    def text(self):
        if self.tag in {'script','style','noscript'}:
            return ''
        value = ''.join(c.text() if isinstance(c,Node) else c for c in self.children)
        return value + ('\n' if self.tag in {'p','div','li','tr','br','h1','h2','h3'} else ' ' if self.tag in {'td','th'} else '')


class Tree(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.stack = [self.root]
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.stack[-1])
        self.stack[-1].children.append(node)
        if tag not in VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for i in range(len(self.stack)-1,0,-1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                return

    def handle_data(self, data):
        self.stack[-1].children.append(data)


class PublicPaginationLimit(RuntimeError):
    """The public endpoint exposes only its first page without authentication."""


DEFAULT_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
DEFAULT_HEADERS = {
    'User-Agent': DEFAULT_USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8,application/json',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Sec-Ch-Ua': '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
}




def clean(value):
    return '\n'.join(re.sub(r'\s+', ' ', s).strip() for s in value.splitlines() if s.strip())


def safe_url(value, base, keep_fragment=False):
    """Return a safe absolute HTTP(S) URL, or None for malformed/untrusted input."""
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        url = urllib.parse.urljoin(base, value.strip())
        p = urllib.parse.urlsplit(url)
        scheme = p.scheme.lower()
        if scheme not in {'http', 'https'} or not p.netloc:
            return None
        # urlsplit can raise ValueError for malformed authorities (for example
        # a pasted mailto instruction containing full-width punctuation).  Do
        # not let one bad link abort an otherwise usable source page.
        if any(char.isspace() for char in p.netloc):
            return None
        return urllib.parse.urlunsplit(
            (scheme, p.netloc, p.path, p.query, p.fragment if keep_fragment else '')
        )
    except (TypeError, ValueError, UnicodeError):
        return None


def request_diagnostic(error, url, stage, method, started):
    """Only public request metadata: never cookies, headers, query secrets or body."""
    parts = urllib.parse.urlsplit(url)
    diagnostic = {'stage': stage, 'url': urllib.parse.urlunsplit(
        (parts.scheme, parts.hostname or '', parts.path, '', '')),
        'method': method, 'http_status': getattr(error, 'code', None),
        'elapsed_seconds': round(time.monotonic() - started, 2)}
    if isinstance(error, collector_runtime.HostPaused):
        diagnostic['stage'] = 'shared_cooldown'
    error.request_diagnostic = diagnostic
    return diagnostic


@bounded_request
def fetch(url, form=None, timeout=18, retries=1, referer='', extra_headers=None, request_stage='request'):
    # Keep list/API requests tolerant of slow public sites, while allowing
    # detail callers to opt into a shorter budget.  No TLS weakening or login
    # bypass is used here.
    timeout = max(1, float(timeout))
    retries = max(0, int(retries))
    for attempt in range(retries + 1):
        started = time.monotonic()
        try:
            pace(url)
            headers = dict(DEFAULT_HEADERS)
            if referer:
                headers['Referer'] = referer
            elif url.startswith('http'):
                origin = urllib.parse.urlunsplit((*urllib.parse.urlsplit(url)[:2], '', '', ''))
                headers['Referer'] = origin + '/'
            if form is not None:
                origin = urllib.parse.urlunsplit((*urllib.parse.urlsplit(url)[:2], '', '', ''))
                if origin:
                    headers['Origin'] = origin
                headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8'
            if extra_headers:
                headers.update(extra_headers)
            req = urllib.request.Request(url, data=urllib.parse.urlencode(form).encode() if form is not None else None,
                headers=headers)
            with OPENER.open(req, timeout=remaining(timeout)) as r:
                raw = bounded_read(r, 3_000_000, timeout)
                charset = r.headers.get_content_charset()
            if len(raw) > 3_000_000:
                raise ValueError('response exceeds size limit')
            # A number of legacy Chinese government/university sites omit the
            # charset header and serve GBK/GB2312 HTML.  Honor a charset meta
            # tag before falling back to UTF-8 so those public announcements
            # do not look like unreachable detail pages.
            meta_match = re.search(rb'<meta[^>]+charset\s*=\s*["\']?\s*([\w.-]+)', raw[:8192], re.I)
            meta_charset = meta_match.group(1).decode('ascii', 'ignore') if meta_match else ''
            candidates = [x for x in [meta_charset, charset, 'utf-8', 'gb18030'] if x]
            for candidate in dict.fromkeys(candidates):
                try:
                    return raw.decode(candidate)
                except (LookupError, UnicodeDecodeError):
                    continue
            return raw.decode('utf-8', 'replace')
        except Exception as error:
            request_diagnostic(error, url, request_stage, 'POST' if form is not None else 'GET', started)
            if not retry_request(url, error, attempt, retries):
                raise


@bounded_request
def fetch_json_post(url, payload, timeout=18, retries=1, referer=''):
    """POST one bounded JSON request to a public recruitment API."""
    timeout = max(1, float(timeout))
    retries = max(0, int(retries))
    raw_payload = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    trace_id = hashlib.sha256(f'{url}:{time.time_ns()}'.encode()).hexdigest()[:32]
    for attempt in range(retries + 1):
        try:
            pace(url)
            origin = urllib.parse.urlunsplit((*urllib.parse.urlsplit(url)[:2], '', '', ''))
            req = urllib.request.Request(
                url,
                data=raw_payload,
                headers={
                    'User-Agent': DEFAULT_USER_AGENT,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'X-Requested-With': 'xmlhttprequest',
                    'EagleEye-TraceID': trace_id,
                    'Origin': origin,
                    **({'Referer': referer} if referer else {}),
                },
            )
            with OPENER.open(req, timeout=remaining(timeout)) as response:
                raw = bounded_read(response, 3_000_000, timeout)
            if len(raw) > 3_000_000:
                raise ValueError('response exceeds size limit')
            return json.loads(raw.decode('utf-8'))
        except Exception as error:
            if not retry_request(url, error, attempt, retries):
                raise


@bounded_request
def fetch_bytes(url, max_size=3_500_000, timeout=6):
    """Safely fetch raw binary content for Excel/PDF attachments with strict timeout and size limits."""
    try:
        req = urllib.request.Request(url, headers={'User-Agent': DEFAULT_USER_AGENT, 'Accept': '*/*'})
        pace(url)
        with OPENER.open(req, timeout=remaining(timeout)) as r:
            raw = bounded_read(r, max_size, timeout)
        if len(raw) > max_size:
            return None
        return raw
    except Exception:
        return None


def nankai_list(html, base):
    tree = Tree(html).root
    items = []
    for a in tree.find('a'):
        href = a.attrs.get('href','')
        if not re.fullmatch(r'/correcruit/content/id/\d+\.html',href):
            continue
        li = a.parent
        while li and li.tag != 'li':
            li = li.parent
        date = None
        if li:
            day, year = li.find(cls='day'), li.find(cls='year')
            if day and year:
                date = clean(year[0].text()).replace('.','-')+'-'+clean(day[0].text()).zfill(2)
        items.append({'url':safe_url(href,base),'title':clean(a.text()),'published_at':date})
    pages = [int(m[1]) for m in re.finditer(r'/correcruit/index/(?:sel_area/\d+/)?p/(\d+)(?:/sel_area/\d+)?\.html',html)]
    return items, max(pages, default=1)


def gov_query(html):
    scripts = Tree(html).root.find('script')
    for script in scripts:
        if 'querydata' in script.attrs:
            return json.loads(script.attrs['querydata'].replace("'", '"')), script.attrs['url']
    raise ValueError('government list configuration missing')


def gov_list(html, base, source=None):
    root = Tree(html).root
    items = []
    for li in root.find('li') + root.find('tr'):
        links = li.find('a')
        if not links:
            continue
        a = links[0]
        title = clean(a.attrs.get('title') or a.text())
        title = re.sub(r'\s*20\d{2}年\d{2}月\d{2}日$', '', title)
        # Exclude only clearly unrelated notices, retain ambiguous opportunities.
        if not re.search(r'招聘|招录|补录|选聘|岗位|招考',title):
            continue
        date = re.search(r'20\d{2}-\d{2}-\d{2}',li.text())
        items.append({'url':safe_url(a.attrs['href'],base),'title':title,'published_at':date[0] if date else None})
    pagination = root.find(cls='pagination')
    count = int(pagination[0].attrs.get('count','0')) if pagination else 0
    rows = int(pagination[0].attrs.get('rows','15')) if pagination else 15
    if source is not None and count > 0:
        source['_total_items'] = count
    return items, max(1,(count+rows-1)//rows)


def jinan_cms_list(source, page, page_size=15):
    """Read Jinan government columns rendered by the AuthorizedRead CMS API."""
    endpoint = urllib.parse.urljoin(
        source['url'], '/api-gateway/jpaas-publish-server/front/page/build/unit'
    )
    query = {
        'parseType': 'bulidstatic',
        'webId': source['cms_web_id'],
        'tplSetId': source['cms_tpl_set_id'],
        'pageType': 'column',
        'tagId': source['cms_tag_id'],
        'editType': 'null',
        'pageId': source['cms_page_id'],
        'paramJson': json.dumps({'pageNo': page, 'pageSize': page_size}, ensure_ascii=False),
    }
    payload = json.loads(fetch(endpoint + '?' + urllib.parse.urlencode(query)))
    html = (payload.get('data') or {}).get('html')
    if not payload.get('success') or not isinstance(html, str):
        raise ValueError('Jinan government recruitment list API returned no HTML')
    items, pages = gov_list(html, source['url'], source=source)
    include_pattern = source.get('include_title_re')
    exclude_pattern = source.get('exclude_title_re')
    if include_pattern:
        items = [item for item in items if re.search(include_pattern, item['title'])]
    if exclude_pattern:
        items = [item for item in items if not re.search(exclude_pattern, item['title'])]
    return items, pages


def sdu_list(html, base):
    root=Tree(html).root
    items=[]
    for a in root.find('a',cls='omit'):
        match=re.search(r"viewZpxx\('([^']+)'",a.attrs.get('onclick',''))
        if not match: continue
        row=a.parent.parent
        date=re.search(r'20\d{2}-\d{2}-\d{2}',row.text()) if row else None
        url=urllib.parse.urljoin(base,'/eweb/jygl/index.so')+'?'+urllib.parse.urlencode({'modcode':'jygl_zpxxck','subsyscode':'zpfw','rklx':'jyw','lmxhV':'0402','type':'ssoZxzpView','id':match[1]})
        items.append({'url':url,'title':clean(a.text()),'published_at':date[0] if date else None})
    next_links=[safe_url(a.attrs.get('href',''),base) for a in root.find('a') if 'pageMethod=next' in a.attrs.get('href','')]
    return items, next_links[0] if next_links else None


_sdei_sessions = set()


def warm_sdei_session(school):
    """Visit the school portal entry to capture session / WAF cookies before hitting AJAX endpoints."""
    if school in _sdei_sessions:
        return
    _sdei_sessions.add(school)
    portal_url = f"https://school.gxjy.sdei.edu.cn/{school}/front/JiuYeInfo"
    started = time.monotonic()
    try:
        with collector_runtime.request_budget(12):
            collector_runtime.pace(portal_url)
            timeout = collector_runtime.remaining(10)
            req = urllib.request.Request(
                portal_url,
                headers={
                    'User-Agent': DEFAULT_USER_AGENT,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'zh-CN,zh;q=0.9',
                }
            )
            with OPENER.open(req, timeout=timeout) as r:
                _ = collector_runtime.bounded_read(r, max_size=100_000, timeout=timeout)
    except urllib.error.HTTPError as error:
        if error.code in {403, 420, 429}:
            request_diagnostic(error, portal_url, 'portal', 'GET', started)
            collector_runtime.pause_on_rejection(portal_url, error)
            raise
    except collector_runtime.HostPaused as error:
        request_diagnostic(error, portal_url, 'shared_cooldown', 'GET', started)
        raise
    except Exception:
        pass


def sdei_position_company(row):
    for field in ('companyName', 'companyname', 'unitName', 'orgName'):
        value = row.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ''


def sdei_list(source, page):
    base = f"https://school.gxjy.sdei.edu.cn/{source['school']}/"
    warm_sdei_session(source['school'])
    positions = source['channel'] == 'positions'
    params = {'pageNum': page, 'pageSize': 20}
    url = base + ('school/companyissueinfo/list1' if positions else 'front/indexZpggList')
    referer = f"{base}front/JiuYeInfo?type={'zwxx' if positions else 'zpgg'}"
    extra_headers = {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
    }
    payload = json.loads(
        fetch(url, params, referer=referer, extra_headers=extra_headers, request_stage='positions_list')
        if positions else
        fetch(url + '?' + urllib.parse.urlencode(params), referer=referer, extra_headers=extra_headers, request_stage='announcements_list')
    )
    if not isinstance(payload.get('rows'), list) or 'total' not in payload:
        raise ValueError('public list response missing rows/total')
    items = []
    for row in payload['rows']:
        if positions:
            company = sdei_position_company(row) or '单位名称待核实'
            role = row.get('jobsort2') or row.get('jobName') or '招聘岗位'
            title = str(company) + ' · ' + str(role)
            comid = row.get('comid') or row.get('id')
            if not comid: raise ValueError('position row missing company id')
            url = base + 'school/companyissueinfo/edit1/' + str(comid)
            values = [('工作地点', row.get('areaString')), ('学历要求', row.get('degreereq')), ('专业要求', row.get('specialty')),
                      ('薪资', row.get('basewage')), ('招聘人数', row.get('requestnum')), ('岗位职责', row.get('jobdescribe')),
                      ('任职要求', row.get('workexp')), ('报名截止', row.get('endtime'))]
            body = ''.join('<p>' + html_lib.escape(f'{key}：{value}') + '</p>' for key, value in values if value is not None)
            published = (row.get('starttime') or row.get('createtime') or '')[:10] or None
            item = {'url': url, 'title': title, 'published_at': published, 'inline_html': '<div id="zoom">' + body + '</div>',
                    'structured': row, 'kind': '具体岗位'}
        else:
            title = row['gonggaoTitle']
            url = base + 'jiuye/zhaopingg/detail/' + str(row['gonggaoId'])
            body = row.get('gonggaoContent') or ''
            published = (row.get('checkTime') or row.get('createTime') or '')[:10] or None
            item = {'url': url, 'title': title, 'published_at': published, 'inline_html': '<div id="zoom">' + body + '</div>',
                    'structured': row, 'kind': '招聘公告'}
        items.append(item)
    source['_total_items'] = int(payload['total'])
    return items, (int(payload['total']) + 19) // 20


def sdei_news_list(page, page_size=50):
    """Read the province-wide public 招聘速递 feed.

    The hub renders this list through a public GBK JSON endpoint.  It is
    separate from each university's school feed and therefore catches
    province-level public institution and enterprise announcements that are
    not present in the 17 school views above.
    """
    endpoint = 'https://gxjy.sdei.edu.cn/getArticleList.jsp'
    referer = 'https://gxjy.sdei.edu.cn/channel.jsp?classid=96'
    form = {
        'fType': '', 'ref': '0', 'jg': '', 'isremove': '0',
        'counts': str(page_size), 'divid': 'channelArticle', 'classids': '96',
        'showNum': str(page_size), 'pagenum': str(page), 'artStr': '',
        'timestamps': str(int(time.time() * 1000)),
    }
    payload = json.loads(fetch(endpoint, form=form, referer=referer))
    rows = payload.get('rows') or '[]'
    if isinstance(rows, str):
        rows = json.loads(rows)
    if not isinstance(rows, list):
        raise ValueError('province recruitment feed returned invalid rows')
    items = []
    base = 'https://html.gxjy.sdei.edu.cn/'
    for row in rows:
        if not isinstance(row, dict):
            continue
        title = clean(str(row.get('title') or ''))
        href = safe_url(row.get('urlRead') or '', base)
        if not title or not href:
            continue
        items.append({
            'identity': f"sdei-news:{row.get('id') or href}",
            'url': href,
            'title': title,
            'published_at': str(row.get('pubdate') or '')[:10] or None,
            'kind': '招聘公告',
        })
    total_pages = int(payload.get('totalPage') or 1)
    return items, max(1, total_pages)


def official_bank_list(html, base, source):
    """Parse the public announcement list used by BOC and PSBC.

    Both sites expose dated article links in a stable ``YYYYMM/tYYYYMMDD``
    path.  Filtering that path prevents navigation links and non-recruitment
    corporate notices from entering the job index.
    """
    root = Tree(html).root
    items = []
    seen = set()
    for anchor in root.find('a'):
        href = anchor.attrs.get('href', '')
        if not re.search(r'/(20\d{4})/t20\d{6,}_?\d*\.html(?:$|[?#])', href, re.I):
            continue
        title = clean(anchor.attrs.get('title') or anchor.text())
        if not title or not re.search(r'招聘|人才|校园|实习|社会|博士后', title):
            continue
        if re.search(r'拟接收|拟录用|录用名单|名单公示|结果公示|面试名单|笔试名单|体检通知|递补', title):
            continue
        url = safe_url(href, base)
        if not url or url in seen:
            continue
        seen.add(url)
        parent = anchor
        while parent and parent.tag != 'li':
            parent = parent.parent
        parent_text = parent.text() if parent else anchor.text()
        date_match = re.search(r'20\d{2}[-./年]\d{1,2}[-./月]\d{1,2}', parent_text)
        published = re.sub(r'[./年]', '-', date_match[0]).replace('月', '-').replace('日', '') if date_match else None
        if not published:
            path_date = re.search(r'/(20\d{4})/t20(\d{2})(\d{2})', href)
            if path_date:
                published = f'{path_date[1]}-{path_date[2]}-{path_date[3]}'
        items.append({'url': url, 'title': title, 'published_at': published, 'kind': '招聘公告'})

    page_match = re.search(r'createPageHTML\(\s*(\d+)\s*,', html, re.I)
    if not page_match:
        page_match = re.search(r'countPage\s*=\s*(\d+)', html, re.I)
    return items, max(1, int(page_match[1]) if page_match else 1)


def official_bank_page_url(source, page):
    if page <= 1:
        return source['url']
    return urllib.parse.urljoin(source['url'], f'index_{page - 1}.html')


def inline_detail(values, sections=()):
    parts = [
        '<p>' + html_lib.escape(f'{label}：{value}') + '</p>'
        for label, value in values
        if value not in (None, '', [])
    ]
    for title, content in sections:
        if content:
            parts.append('<p>' + html_lib.escape(f'{title}：{content}') + '</p>')
    return '<div id="zoom">' + ''.join(parts) + '</div>'


def zhiye_jobs_list(source, page, page_size=500):
    """Read public jobs from the official Beisen/Zhiye recruitment portal API."""
    origin = urllib.parse.urlunsplit((*urllib.parse.urlsplit(source['url'])[:2], '', '', ''))
    endpoint = origin + '/api/Jobad/GetJobAdPageList'
    display_fields = [
        'Category', 'Kind', 'LocId', 'DetailAddress', 'Org', 'HeadCount',
        'Station', 'EndTime', 'PostDate', 'Salary', 'Degree',
        'YearsOfWorking', 'ClassificationOne', 'ClassificationTwo',
    ]
    payload = fetch_json_post(
        endpoint,
        {
            'Category': [source['business_type']],
            'PageIndex': page - 1,
            'PageSize': page_size,
            'KeyWords': '',
            'SpecialType': 0,
            'PortalId': source['portal_id'],
            'DisplayFields': display_fields,
        },
        referer=source['url'],
    )
    rows = payload.get('Data')
    if payload.get('Code') != 200 or not isinstance(rows, list):
        raise ValueError('official Zhiye recruitment API returned invalid data')
    items = []
    route = 'campus' if source['business_type'] == '2' else 'social'
    for row in rows:
        job_id = row.get('JobAdId')
        title = clean(str(row.get('JobAdName') or ''))
        if not job_id or not title or row.get('Status') == 0:
            continue
        detail_url = origin + f'/{route}/detail?jobAdId={job_id}'
        locations = '、'.join(clean(str(value)) for value in row.get('LocNames') or [] if value)
        deadline_value = str(row.get('EndTime') or '')[:10]
        if (not re.fullmatch(r'20\d{2}-\d{2}-\d{2}', deadline_value) or
                int(deadline_value[:4]) >= 2100):
            deadline_value = ''
        published = str(row.get('PostDate') or row.get('ChangeDate') or '')[:10]
        if not re.fullmatch(r'20\d{2}-\d{2}-\d{2}', published):
            published = None
        company = clean(str(row.get('Org') or row.get('ClassificationTwo') or source['institution']))
        structured = dict(row)
        structured['companyName'] = company
        values = [
            ('招聘单位', company),
            ('岗位名称', title),
            ('岗位类别', row.get('ClassificationOne') or row.get('Category')),
            ('工作地点', locations or row.get('DetailAddress')),
            ('学历要求', row.get('Degree')),
            ('工作经验', row.get('YearsOfWorking')),
            ('薪资', row.get('Salary')),
            ('报名截止时间', deadline_value),
        ]
        items.append({
            'identity': f"zhiye:{source['id']}:{job_id}",
            'url': detail_url,
            'application_url': detail_url,
            'title': title,
            'company': company,
            'published_at': published,
            'inline_html': inline_detail(values, [('岗位职责', row.get('Duty')), ('任职要求', row.get('Require'))]),
            'structured': structured,
            'kind': '具体岗位',
            'is_active_listing': True,
        })
    count = int(payload.get('Count') or payload.get('Total') or len(rows))
    return items, max(1, (count + page_size - 1) // page_size)


def haier_jobs_list(page, page_size=500):
    endpoint = 'https://maker.haier.net/client/job/searchdata.html'
    url = endpoint + '?' + urllib.parse.urlencode({'page': page, 'pagesize': page_size})
    payload = json.loads(fetch(url))
    data = payload.get('data') or {}
    rows = data.get('list')
    if payload.get('status') != 1 or not isinstance(rows, list):
        raise ValueError('Haier social recruitment API returned invalid data')
    items = []
    for row in rows:
        job_id = row.get('id')
        title = clean(str(row.get('job_name') or row.get('jobname') or ''))
        if not job_id or not title:
            continue
        detail_url = f'https://maker.haier.net/client/job/detail/id/{job_id}/recommend_record/1'
        company = '海尔集团'
        structured = dict(row)
        structured['companyName'] = company
        values = [
            ('招聘单位', company),
            ('岗位名称', title),
            ('岗位类别', row.get('func_desc')),
            ('业务部门', row.get('xwinfo') or row.get('bu_name')),
            ('工作地点', row.get('location')),
            ('学历要求', row.get('education_required_label')),
            ('工作经验', row.get('work_experience_label')),
            ('薪资', row.get('salary_label')),
        ]
        items.append({
            'identity': f'haier-social:{job_id}',
            'url': detail_url,
            'application_url': detail_url,
            'title': title,
            'company': company,
            'published_at': str(row.get('update_time') or '')[:10] or None,
            'inline_html': inline_detail(values),
            'structured': structured,
            'kind': '具体岗位',
            'is_active_listing': True,
        })
    count = int(data.get('count') or len(rows))
    return items, max(1, (count + page_size - 1) // page_size)


def haier_campus_list(source, page, page_size=500):
    endpoint = 'https://maker.haier.net/client/campus/getactivityresearchlist.html'
    items = []
    total_pages = 1
    for activity_id in source.get('activity_ids') or []:
        payload = json.loads(fetch(endpoint, form={
            'from': 'jituan', 'page': page, 'pagesize': page_size, 'aid': activity_id,
        }))
        data = payload.get('data') or {}
        rows = data.get('list')
        if payload.get('status') != 1 or not isinstance(rows, list):
            raise ValueError(f'Haier campus recruitment API returned invalid data for activity {activity_id}')
        count = int(data.get('count') or len(rows))
        total_pages = max(total_pages, (count + page_size - 1) // page_size)
        activity_name = clean(str((data.get('activity') or {}).get('name') or '海尔集团校园招聘'))
        for row in rows:
            job_id = row.get('id')
            title = clean(str(row.get('name') or ''))
            detail_url = safe_url(row.get('click_url') or '', source['url'])
            if not job_id or not title or not detail_url:
                continue
            company = '海尔集团'
            structured = dict(row)
            structured['companyName'] = company
            values = [
                ('招聘单位', company),
                ('招聘项目', activity_name),
                ('岗位名称', title),
                ('岗位类别', row.get('fun_name')),
                ('业务部门', row.get('department')),
                ('工作地点', row.get('addr')),
            ]
            items.append({
                'identity': f'haier-campus:{activity_id}:{job_id}',
                'url': detail_url,
                'application_url': detail_url,
                'title': title,
                'company': company,
                'published_at': None,
                'inline_html': inline_detail(values),
                'structured': structured,
                'kind': '具体岗位',
                'is_active_listing': True,
            })
    return items, max(1, total_pages)


def wonder_list(html, base):
    items=[]
    for a in Tree(html).root.find('a'):
        href=a.attrs.get('href','')
        if not re.fullmatch(r'/xiaozhao/[^/]+-\d+-[a-f0-9]+/',href): continue
        text=clean(a.text())
        date=re.search(r'收录\s*(20\d{2})[.-](\d{2})[.-](\d{2})',text)
        if not date: continue
        items.append({'url':safe_url(href,base),'title':text.splitlines()[0],'published_at':'-'.join(date.groups())})
    pages=[int(x) for x in re.findall(r'/xiaozhao/page/pn(\d+)/',html)]
    return items,max(pages,default=1)


def offerjack_list(page, city='', page_size=20):
    params={'pageNum':page,'pageSize':page_size}
    if city: params['workLocation']=city
    payload=json.loads(fetch('https://www.offerjack.cn/api/offer/page?'+urllib.parse.urlencode(params)))
    if payload.get('code')==401:
        raise PublicPaginationLimit(payload.get('msg') or '公开接口未登录仅开放第一页')
    data=payload.get('data') or {}
    if payload.get('code')!=0 or not isinstance(data.get('records'),list):
        raise ValueError('public recruitment list unavailable; no authenticated fallback')
    items=[]
    for row in data['records']:
        if not isinstance(row, dict):
            continue
        company = clean(str(row.get('enterpriseName') or '招聘单位待核实'))
        batch = clean(str(row.get('recruitmentBatch') or ''))
        identity_value = row.get('id') or hashlib.sha256(
            json.dumps(row, sort_keys=True, ensure_ascii=False).encode()
        ).hexdigest()[:20]
        values=[('企业',row.get('enterpriseName')),('工作地点',row.get('workLocation')),('招聘批次',row.get('recruitmentBatch')),
                ('毕业届别与学历',row.get('graduationYear')),('招聘岗位',row.get('position')),('企业性质',row.get('enterpriseNature')),
                ('所属行业',row.get('industry')),('报名截止',row.get('deadline'))]
        body=''.join('<p>'+html_lib.escape(f'{k}：{v}')+'</p>' for k,v in values if v)
        body+='<p>第三方公开整理的招聘线索；岗位城市和投递入口尚未通过企业原公告交叉核验。</p>'
        original=safe_url(row.get('announcementLink') or '', 'https://www.offerjack.cn/',True)
        if original: body+='<p><a href="'+html_lib.escape(original,quote=True)+'">原招聘公告（来源提供）</a></p>'
        items.append({'identity':'offerjack:'+str(identity_value), 'url':original or 'https://www.offerjack.cn/',
            'title':company+' · '+batch+'招聘',
            'published_at':(row.get('updateTime') or row.get('createTime') or '')[:10] or None,
            'inline_html':'<div id="zoom">'+body+'</div>', 'structured':row})
    return items,int(data.get('pages') or 1)


def upc_list(page, page_size=10):
    url = f'https://career.upc.edu.cn/career/zpxx/search/zpxx/{page}/{page_size}'
    raw = fetch(url, form={})
    payload = json.loads(raw)
    data = payload.get('data') or {}
    records = data.get('list') or []
    total = data.get('total') or 0
    items = []
    for row in records:
        if not isinstance(row, dict): continue
        zpxxid = str(row.get('zpxxid') or '')
        if not zpxxid: continue
        company = clean(str(row.get('dwmc') or '招聘单位待核实'))
        title = clean(str(row.get('zpzt') or f'{company} 招聘公告'))
        published = (row.get('fbrq') or '')[:10] or None
        deadline_val = (row.get('zpjzrq') or '')[:10] or None
        email = clean(str(row.get('jltdyx') or ''))
        website = clean(str(row.get('dwwz') or ''))
        city = clean(str(row.get('szsmc') or ''))
        province = clean(str(row.get('szssmc') or ''))
        positions = clean(str(row.get('zwmcs') or ''))
        address = clean(str(row.get('xxdz') or ''))
        nature = clean(str(row.get('xzyjmc') or ''))
        industry = clean(str(row.get('hyyjmc') or ''))
        values = [
            ('招聘单位', company),
            ('用人单位所在地', city if city and city != '市辖区' else province),
            ('单位性质', nature),
            ('所属行业', industry),
            ('招聘岗位', positions),
            ('详细地址', address),
            ('企业官网', website),
            ('简历投递邮箱', email),
            ('报名截止时间', deadline_val),
        ]
        body = ''.join('<p>' + html_lib.escape(f'{k}：{v}') + '</p>' for k, v in values if v)
        detail_url = f'https://career.upc.edu.cn/career/zpxx/view/zpxx/{zpxxid}'
        items.append({
            'identity': f'upc:{zpxxid}',
            'url': detail_url,
            'title': title,
            'published_at': published,
            'inline_html': '<div id="zoom">' + body + '</div>',
            'structured': row,
            'kind': '招聘公告',
        })
    return items, max(1, (int(total) + page_size - 1) // page_size)


def qdhrss_list(html, base):
    root = Tree(html).root
    items = []
    for li in root.find('li'):
        links = li.find('a')
        if not links: continue
        a = links[0]
        title = clean(a.attrs.get('title') or a.text())
        if not re.search(r'招聘|引才|招录|选拔|招考|遴选|岗位|优选', title):
            continue
        if re.search(r'拟聘|拟录用|录取人员|名单公示|结果公示|体检通知|递补|资格复审|成绩查询|放弃', title):
            continue
        href = a.attrs.get('href', '')
        url = safe_url(href, base)
        if not url: continue
        date_match = re.search(r'20\d{2}-\d{2}-\d{2}', li.text())
        published = date_match[0] if date_match else None
        items.append({'url': url, 'title': title, 'published_at': published, 'kind': '招聘公告'})
    pages = [1]
    for m in re.finditer(r'index_(\d+)\.shtml', html):
        pages.append(int(m.group(1)) + 1)
    return items, max(pages, default=1)


OVERSEAS_LOCATION_PATTERN = re.compile(r'海外|国外|境外|境外地区|海外地区')
DOMESTIC_LOCATION_PATTERN = re.compile(
    r'国内|中国大陆|境内|全国|各地可选|不限城市|各地招聘|各省市|山东|广东|江苏|浙江|安徽|福建|湖北|湖南|河南|陕西|四川|云南|贵州|江西|广西|海南|山西|河北|辽宁|吉林|黑龙江|甘肃|青海|宁夏|新疆|西藏|内蒙古'
)


def domestic_status(location_evidence, cities):
    """Classify only the recruitment location, keeping uncertain records visible."""
    evidence = '\n'.join(location_evidence or [])
    has_domestic = bool(cities) or bool(DOMESTIC_LOCATION_PATTERN.search(evidence))
    if not has_domestic:
        has_domestic = any(city in evidence for city in CITIES)
    has_overseas = bool(OVERSEAS_LOCATION_PATTERN.search(evidence))
    if has_overseas and not has_domestic:
        return 'overseas'
    if has_overseas and has_domestic:
        return 'mixed'
    if has_domestic:
        return 'domestic'
    return 'unknown'


def labelled_lines(text):
    """Join a label with the next value, never cross another named field."""
    lines=[line.strip() for line in text.splitlines() if line.strip()]
    for index,line in enumerate(lines):
        # University announcement tables frequently put labels and values on separate lines.
        if re.fullmatch(r'(?:报名时间|报名截止(?:时间|日期)?|投递截止(?:时间)?|网申截止(?:时间)?|报名日期|招聘截止日期|截止时间|应聘网址|报名网址|投递网址|网申地址|招聘官网|简历投递邮箱|投递邮箱|应聘邮箱)[：: ]*',line):
            following=lines[index+1] if index+1<len(lines) else ''
            if re.match(r'(?:20\d{2}[年./-]|https?://|[A-Za-z0-9._%+-]+@)',following):
                line+='：'+following
        yield line


def deadline_candidates(text):
    candidates = []
    for line in labelled_lines(text):
        if not re.search(r'报名时间|报名截止|报名有效期|投递截止|网申截止|报名日期|招聘截止日期|截止时间',line):
            continue
        dates = list(re.finditer(r'(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})日?(?:\s*(\d{1,2})[:：时](\d{1,2})?分?)?',line[:240]))
        if not dates:
            continue
        m = dates[-1]
        # A single start date without an end marker is not a deadline.
        if len(dates)==1 and not re.search(r'截止|至|以前|之前',line[:m.end()+10]):
            continue
        y,mo,d,h,mi = m.groups()
        try:
            value=dt.datetime(int(y),int(mo),int(d),int(h or 23),int(mi or (0 if h else 59)),0 if h else 59,tzinfo=TZ).isoformat()
            candidates.append((value,line[:240], 'minute' if h else 'day'))
        except ValueError:
            continue
    return candidates


VALID_GRADUATION_YEAR_MIN = 2024
VALID_GRADUATION_YEAR_MAX = 2030


def extract_graduation_years(text):
    if not text:
        return []
    years = set()
    # A year in ``2026年校园招聘`` is the recruitment year, not the
    # graduation cohort.  Only retain explicit cohort/graduate wording here;
    # otherwise an announcement for the 2026 autumn campaign incorrectly
    # matches the 2026 graduation filter.
    for m in re.finditer(r'(?<!\d)(20\d{2})\s*(?:[届屆]|应届|年应届|年(?:高校)?毕业|年度(?:校园招聘|校招)|(?=校园招聘|校招))', text):
        years.add(m.group(1))
    for m in re.finditer(r'(?<!\d)(20\d{2})\s*[-/、及与至和或]\s*(20\d{2})\s*[届屆]', text):
        years.add(m.group(1))
        years.add(m.group(2))
    for m in re.finditer(r'(?<!\d)(2\d)(?:[届屆]|秋招|春招)', text):
        years.add('20' + m.group(1))
    valid = [y for y in years if VALID_GRADUATION_YEAR_MIN <= int(y) <= VALID_GRADUATION_YEAR_MAX]
    return sorted(valid)


def deadline(text):
    unique={v[0]:v for v in deadline_candidates(text)}
    return next(iter(unique.values())) if len(unique)==1 else (None,None,None)


def refine_facts(job):
    """Repair facts using explicit announcement evidence; retain source and collection history."""
    row=dict(job)
    text=row.get('body','')
    title=row.get('title','')
    compact=lambda value: re.sub(r'\s+','',value).translate(str.maketrans('（）','()'))
    company=row.get('company','')
    # Prefer a full employer name whose explicitly declared abbreviation occurs in the title.
    aliases=re.findall(r'([\u4e00-\u9fffA-Za-z0-9（）()·]{3,60}(?:有限责任公司|有限公司))\s*[（(]以下简称[：: ]*[“「\"]([^”」\"]{2,30})[”」\"]',text)
    candidates={name for name,alias in aliases if compact(alias) in compact(title) and alias not in {'公司','集团','本公司','企业'}}
    # A legal employer name at the beginning of the recruitment title is also explicit evidence.
    match=re.match(r'^([\u4e00-\u9fffA-Za-z0-9（）()·]{2,60}?(?:有限责任公司|有限公司|银行[\u4e00-\u9fff]{0,12}分行))(?=\s|招聘|20\d{2}|校园|社会|$)',title)
    if match: candidates.add(match[1])
    replacement=next(iter(candidates)) if len(candidates)==1 else ''
    conflict=bool(company and row.get('source_id','').endswith('-announcements')
                  and compact(company) not in compact(text+'\n'+title)
                  and not compact(title).startswith(compact(re.sub(r'(?:股份)?(?:有限责任公司|有限公司)$','',company))))
    if replacement and (not company or conflict) and compact(replacement)!=compact(company):
        row['company']=replacement
        row['company_note']='企业名称按公告标题或正文中明确的简称对应关系整理。'
        if company: row.update(company_original=company,company_conflict=True)
    elif conflict:
        row['company']=''
        row['company_original']=company
        row['company_conflict']=True
        row['company_note']='来源单位字段与公告未能对应，企业名称待核对。'
    expires,evidence,precision=deadline(text)
    if expires or deadline_candidates(text):
        row.update(deadline=expires,deadline_evidence=evidence,deadline_precision=precision)
    application=[]
    emails=list(row.get('emails') or [])
    for line in labelled_lines(text):
        # Only repair whitespace immediately after a URL scheme, not arbitrary URL contents.
        line=re.sub(r'(https?://)[ \t]+',r'\1',line,flags=re.I)
        m=re.search(r'(?:应聘网址|报名网址|投递网址|网申地址|招聘官网|投递)[：:\s（(]*(https?://[^\s<>，。；）)\"“”]+)',line,re.I)
        if m:
            url=safe_url(m[1],row.get('source_url',''),True)
            if url: application.append(url)
        if re.search('报名|投递|简历|应聘',line):
            emails.extend(re.findall(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',line))
    # Several distinct application paths require the original announcement to disambiguate.
    if len(set(application))==1:
        row['application_url']=application[0]
    row['emails']=list(dict.fromkeys(emails))
    return row


def requires_position_detail(job):
    if job.get('kind') and job.get('kind') != '具体岗位':
        return False
    url = job.get('source_url') or job.get('url') or ''
    return bool(re.fullmatch(r'https://school\.gxjy\.sdei\.edu\.cn/[^/]+/school/companyissueinfo/edit1/\d+/?', url, flags=re.IGNORECASE))


def publishable_job(job):
    if job.get('detail_verification') == 'failed':
        return False
    if requires_position_detail(job):
        return job.get('detail_verification') == 'verified'
    return True


def parse_sdei_position_detail(html, item, source):
    if not html or len(html.strip()) < 80:
        raise ValueError('详情页内容为空或过短；无法访问')
    if '{"code":500}' in html or '{"msg":null' in html:
        raise ValueError('详情页返回系统错误；无法访问')
    if re.search(r'<(?:h1|h2|div|p)[^>]*>(?:请登录|统一身份认证|登录后查看|用户登录)<', html):
        raise ValueError('详情页需要登录，求职者无法直接查看')
    if html.strip().startswith('<div id="zoom">列表') or '<div id="zoom">列表职责</div>' in html:
        raise ValueError('非真实详情页')

    soup = BeautifulSoup(html, 'html.parser')
    fields = {}
    nodes = soup.select('.info-item')
    if not nodes:
        raise ValueError('岗位详情缺少有效结构节点(.info-item)；可能为错误页或无法访问')
    for node in nodes:
        label = node.find('strong')
        if label:
            key = label.get_text(strip=True).rstrip('：:')
            value = node.get_text(' ', strip=True)[len(label.get_text(' ', strip=True)):].strip().lstrip('：:').strip()
            fields[key] = value

    company = fields.get('单位名称', '') or sdei_position_company(item.get('structured') or {}) or item.get('company', '')
    if not company:
        parts = item.get('title', '').split(' · ')
        if len(parts) > 1 and parts[0] != '单位名称待核实':
            company = parts[0]

    # Only reject if completely empty or devoid of any recognizable job info.
    if not company and len(soup.get_text(strip=True)) < 50:
        raise ValueError('岗位详情缺少有效信息；可能为错误页或无法访问')

    structured = dict(item.get('structured') or {})
    if company:
        structured.update(companyName=company, companyname=company)
    if fields.get('学历要求'):
        structured['degreereq'] = fields['学历要求']
    if fields.get('工作地点'):
        structured['workplace'] = fields['工作地点']
    if fields.get('专业要求'):
        structured['specialty'] = fields['专业要求']

    role = structured.get('jobsort2') or (item['title'].split(' · ')[-1] if ' · ' in item['title'] else item['title'])
    display_title = (company + ' · ' + role) if company else item['title']

    body = '<div id="zoom">' + (''.join(str(node) for node in nodes) if nodes else str(soup.find('body') or html[:2000]))
    if structured.get('endtime'):
        body += '<p>报名截止：' + html_lib.escape(str(structured['endtime'])) + '</p>'
    body += '</div>'

    job = parse_detail(body, dict(item, title=display_title, structured=structured, kind='具体岗位'), source)
    job['kind'] = '具体岗位'
    if fields.get('专业要求'):
        job['majors'] = sorted(set(job.get('majors', []) + split_majors(fields['专业要求'])))
    if fields.get('学历要求'):
        job['education'] = fields['学历要求']
    if fields.get('工作地点'):
        job['city'] = fields['工作地点']

    job['detail_verification'] = 'verified'
    job['structured'] = structured
    if not job.get('application_url'):
        for link in job.get('links', []):
            if re.search(r'报名|投递|网申|应聘', link['title']):
                job['application_url'] = safe_url(link['url'], item['url'], True)
                if job['application_url']:
                    break
    return job


def parse_detail(html, item, source):
    root=Tree(html).root
    metas={n.attrs.get('name','').lower():n.attrs.get('content','') for n in root.find('meta')}
    structured=item.get('structured') or {}
    fields={}
    if source.get('adapter')=='wondercv':
        titles=root.find(cls='hero-title')
        if not titles: raise ValueError('public recruitment title missing')
        title=clean(titles[0].text())
        for node in root.find(cls='side-stat'):
            labels=node.find('span'); values=node.find('strong')
            if labels and values: fields[clean(labels[0].text())]=clean(values[0].text())
        company=fields.get('所属企业','')
        published=item.get('published_at')
        # Retain public factual metadata only; never copy editorial guides or reveal gated contacts.
        facts=''.join('<p>'+html_lib.escape(k+'：'+v)+'</p>' for k,v in fields.items())
        jobs=root.find(id='jobs')
        if jobs:
            facts+=''.join('<p>岗位：'+html_lib.escape(clean(n.text()))+'</p>' for n in jobs[0].find('strong'))
        facts+='<p>此条为第三方公开招聘线索，工作地和资格尚未通过企业原公告交叉核验。请打开来源核对投递方式。</p>'
        body=Tree('<div>'+facts+'</div>').root
    elif source['id']=='nankai':
        contents=root.find(cls='zpnr')
        if not contents:
            raise ValueError('announcement body missing')
        body=contents[0]
        titles=root.find(cls='title1')
        companies=root.find(cls='company')
        title=clean(titles[0].text()) if titles else item['title']
        company=clean(companies[0].text()) if companies else ''
        if '代发' in company: company=''
        for node in root.find(cls='zpxx'):
            parts=clean(node.text()).split('：',1)
            if len(parts)==2:
                fields[parts[0]]=parts[1].strip()
        dates=root.find(cls='date')
        date_match=re.search(r'发布时间：(20\d{2}-\d{2}-\d{2})',dates[0].text()) if dates else None
        published=date_match[1] if date_match else item.get('published_at')
    elif source['id']=='sdu':
        contents=root.find(cls='bd_one')
        if not contents: raise ValueError('announcement body missing')
        body=contents[0]
        titles=root.find(cls='ggName')
        title=clean(titles[0].text()) if titles else item['title']
        company=''
        dates=root.find(cls='ggTime')
        match=re.search(r'20\d{2}-\d{2}-\d{2}',dates[0].text()) if dates else None
        published=match[0] if match else item.get('published_at')
    elif source.get('adapter')=='upc':
        contents=root.find(cls='ck-content') or root.find(id='zoom')
        body=contents[0] if contents else root
        title=item['title']
        company=structured.get('dwmc') or item.get('company') or ''
        published=item.get('published_at')
    elif source.get('adapter')=='jinan_cms':
        contents=(root.find(id='zoom') or root.find(cls='TRS_Editor') or
                  root.find(cls='article') or root.find(cls='content') or root.find('body'))
        body=contents[0] if contents else root
        title=metas.get('articletitle') or item['title']
        company=item.get('company') or ''
        published=(metas.get('pubdate') or item.get('published_at') or '')[:10] or None
    elif source.get('adapter')=='qdhrss':
        contents=root.find(cls='wencon') or root.find(cls='article') or root.find(id='zoom')
        body=contents[0] if contents else root
        title=metas.get('articletitle') or item['title']
        company='青岛市人社局'
        published=(metas.get('pubdate') or item.get('published_at') or '')[:10] or None
    elif source.get('adapter')=='sdei_news':
        contents=root.find(cls='x1_tit2') or root.find(cls='sub_x')
        body=contents[0] if contents else root
        titles=root.find(cls='xl_tit')
        dates=root.find(cls='time')
        title=clean(titles[0].text()) if titles else item['title']
        company=''
        published=clean(dates[0].text())[:10] if dates else item.get('published_at')
    elif source.get('adapter')=='official_bank':
        contents=root.find(cls='trs_editor_view') or root.find(cls='view') or root.find(cls='psbc_contentbox') or root.find(cls='tckMain')
        body=contents[0] if contents else root
        title=metas.get('articletitle') or item['title']
        company=source.get('institution','')
        published=(metas.get('pubdate') or item.get('published_at') or '')[:10] or None
    else:
        contents=root.find(id='zoom')
        if not contents:
            raise ValueError('announcement body missing')
        body=contents[0]
        title=metas.get('articletitle') or item['title']
        company=structured.get('companyname') or structured.get('companyName') or structured.get('enterpriseName') or ''
        if source.get('adapter') == 'sdei' and source.get('channel') == 'positions':
            company = sdei_position_company(structured)
        published=(metas.get('pubdate') or item.get('published_at') or '')[:10] or None
    text=clean(body.text())
    if len(text)<30:
        text=(text+'\n公告文字较少或以图片展示，请打开原公告查看完整岗位与报名要求。').strip()
    combined=title+'\n'+text
    types=[]
    if source.get('adapter')=='wondercv' or re.search(r'校园招聘|校招|应届.*招聘|20\d{2}[届屆].*招聘',combined): types.append('校招')
    if re.search(r'社会招聘|社招|社会公开招聘|公开招聘(?:公告|人员|工作人员)|事业单位招聘',combined): types.append('社招')
    if source.get('default_type') and source['default_type'] not in types:
        types.append(source['default_type'])
    years=extract_graduation_years(combined)
    if source.get('adapter')=='offerjack':
        batch=structured.get('recruitmentBatch') or ''
        if re.search('社招|社会',batch): types=['社招']
        elif re.search('秋招|春招|校招|提前批',batch): types=['校招']
        # A list such as 2026/2027届 explicitly names both eligible cohorts.
        structured_years=[y for y in re.findall(r'20\d{2}',structured.get('graduationYear') or '') if VALID_GRADUATION_YEAR_MIN <= int(y) <= VALID_GRADUATION_YEAR_MAX]
        years=sorted(set(years+structured_years))
    sectors=[label for label,pattern in [('银行',r'银行'),('保险',r'保险'),('国企',r'国有企业|国有独资|国有控股|央企|国企'),('事业单位',r'事业单位'),('公务员',r'公务员')] if re.search(pattern,combined)] or list(source.get('sectors') or ['企业 / 其他'])
    # City evidence comes from job-location fields/sections/tables, never a headquarters paragraph.
    location_evidence=[]
    if fields.get('工作地域'): location_evidence.append(fields['工作地域'])
    if fields.get('工作地点'): location_evidence.append('工作地点：'+fields['工作地点'])
    if fields.get('用人单位所在地'): location_evidence.append('用人单位所在地：'+fields['用人单位所在地'])
    location_evidence = extract_locations_from_text(location_evidence, text, title, company)
    for table in body.find('table'):
        rows=table.find('tr')
        if rows and re.search('工作地点|工作城市|招聘地点',rows[0].text()):
            headers=rows[0].find('td') or rows[0].find('th')
            indexes=[i for i,c in enumerate(headers) if re.search('工作地点|工作城市|招聘地点',c.text())]
            for row in rows[1:]:
                cells=row.find('td')
                for i in indexes:
                    if i<len(cells): location_evidence.append(clean(cells[i].text()))
    location_evidence = filter_institution_locations(location_evidence)
    cities=[city for city in CITIES if any(city in s for s in location_evidence if not s.startswith('用人单位所在地：'))]
    # Province platform supplies a standard administrative code even for district-only labels.
    code=str(structured.get('workplace2') or '')
    shandong={'3701':'济南','3702':'青岛','3703':'淄博','3704':'枣庄','3705':'东营','3706':'烟台','3707':'潍坊','3708':'济宁','3709':'泰安','3710':'威海','3711':'日照','3713':'临沂','3714':'德州','3715':'聊城','3716':'滨州','3717':'菏泽'}
    if len(code)==6 and code[:4] in shandong:
        city=shandong[code[:4]]
        if city not in cities: cities.append(city)
        location_evidence.append(f"岗位工作地行政区划代码 {code}，归属{city}（来源结构化字段）")
    possible=[city for city in CITIES if city in combined and city not in cities]
    location_status=domestic_status(location_evidence,cities)
    expires,expires_text,precision=deadline(text)
    application_url=None
    if fields.get('职位投递网址链接'):
        m=re.search(r'https?://[^\s<>，。；）]+',fields['职位投递网址链接'])
        if m: application_url=safe_url(m[0],item['url'],True)
    if source.get('adapter')=='offerjack' and structured.get('deliveryAddress'):
        address=structured.get('deliveryAddress')
        delivery=safe_url(address,item['url'],True) if isinstance(address,str) and re.match(r'^https?://',address.strip(),re.I) else None
        if delivery and delivery!=item['url']: application_url=delivery
    if source.get('adapter')=='upc':
        if structured.get('dwwz'):
            website=safe_url(structured['dwwz'],item['url'],True)
            if website and website!=item['url'] and re.search(r'job|career|campus|apply|hr|zhaopin|hire|recruit|zp', website, re.I):
                application_url=website
        elif item.get('application_url'):
            application_url=item['application_url']
    if source.get('adapter') in {'zhiye_jobs', 'haier_jobs', 'haier_campus'} and item.get('application_url'):
        application_url=safe_url(item['application_url'],item['url'],True)
    links=[]
    attachments=[]
    for node in body.find('img'):
        url=safe_url(node.attrs.get('src',''),item['url'])
        if url and node.attrs.get('src'):
            attachments.append({'title':'招聘图片（文字未自动识别）','url':url})
    for a in body.find('a'):
        url=safe_url(a.attrs.get('href',''),item['url'])
        if not url: continue
        name=clean(a.text()) or '查看链接'
        if re.search(r'\.(pdf|xlsx?|docx?|zip|rar|png|jpg)(?:\?|$)',url,re.I) or re.search('附件|岗位表|报名表',name):
            attachments.append({'title':name[:100],'url':url})
        else: links.append({'title':name[:100],'url':url})
    # Explicit recruitment URL text is the current source of truth.  Probe
    # records can carry an older structured URL, so let a newly published
    # labelled URL replace it even when a fallback URL was already found.
    m=re.search(r'(?:报名网址|投递网址|网申地址|招聘官网|应聘网址|招聘网申系统|招聘网站|报名系统|网上报名|PC端)[：:\s（(]*?(https?://[^\s<>，。；）)]+)',text,re.I)
    if m:
        explicit_url=safe_url(m[1],item['url'],True)
        if explicit_url:
            application_url=explicit_url
    if not application_url:
        # Some bank notices place the recruitment URL in a sentence without
        # a dedicated label (for example, “登录招聘网站 https://…”).  Accept
        # only URLs on a line that clearly describes applying, and never use
        # the announcement page itself as an application link.
        for line in text.splitlines():
            if not re.search(r'报名|应聘|网申|投递|招聘网站|招聘网', line, re.I):
                continue
            for raw_url in re.findall(r'https?://[^\s<>，。；）)"“”]+', line, re.I):
                candidate=safe_url(raw_url,item['url'],True)
                if candidate and candidate.rstrip('/') != item['url'].rstrip('/'):
                    application_url=candidate
                    break
            if application_url:
                break
    emails=[]
    for line in text.splitlines():
        if re.search('报名|投递|简历|应聘',line):
            emails.extend(re.findall(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',line))
    emails=list(dict.fromkeys(emails))
    directions=[label for label,pattern in [('财务 / 经济',r'财务|会计|审计|经济|金融|财会'),('管理 / 职能',r'管理|行政|人力|人事|运营|采购|职能|管培'),('技术 / 研发',r'研发|工程师|技术|算法|软件'),('市场 / 销售',r'市场|销售|营销|客户经理')] if re.search(pattern,combined)]
    secondary=source.get('adapter') in {'wondercv','offerjack'}
    positions=extract_all_positions(
        body_html_or_soup=html,
        text=text,
        attachments=attachments,
        fetch_attachment_fn=fetch_bytes,
    )
    raw_job=refine_facts({'id': item.get('target_id') or hashlib.sha256(item.get('identity',item['url']).encode()).hexdigest()[:20],
            'identity': item.get('identity', item['url']),
            'title':title,'company':company,
            'source_id':source['id'],'source_name':source['name'],'source_url':item['url'],
            'published_at':published,'date_label':'更新' if source.get('adapter')=='offerjack' else '收录' if secondary else '发布',
            'provenance':'第三方线索' if secondary else '公开原始来源',
            'kind':item.get('kind','招聘公告'),'types':types,'graduation_years':years,
            'sectors':sectors,'directions':directions,'cities':cities,'possible_cities':possible,
            'location_evidence':location_evidence[:12],'province_possible':'山东' in combined,
            'domestic_status':location_status,
            'education':fields.get('学历要求') or structured.get('degreereq') or structured.get('graduationYear') or structured.get('Degree') or structured.get('education_required_label') or '未明确 / 见原公告',
            'deadline':expires,'deadline_evidence':expires_text,'deadline_precision':precision,
            'application_url':application_url,'emails':emails,'attachments':attachments,'links':links[:20],
            'qr_attachment':bool(re.search(r'扫码|二维码',text)),
            'excerpt':text[:300],'body':text[:18000], 'classification_note':'标签根据公告文字整理；具体岗位资格请核对原文。'})
    return enrich_job_with_positions(raw_job, positions)


def compute_lifecycle_stage(job, now_str):
    if job.get('listing_status') == 'withdrawn':
        return 'expired'
    if job.get('listing_status') == 'unconfirmed':
        return 'unconfirmed'
    deadline = job.get('deadline')
    today = (now_str or '')[:10]
    if deadline and today and deadline < today:
        return 'expired'
    title = job.get('title', '')
    text = job.get('body', '') or job.get('excerpt', '')
    combined = title + '\n' + text[:1000]
    if re.search(r'笔试名单|面试名单|笔试安排|面试通知|资格复审|拟录用|录取公示', combined):
        return 'selection'
    recent = job.get('recent_change') or {}
    if recent.get('type') == 'deadline_extended' or re.search(r'延长|延期|推迟', title):
        return 'extended'
    if re.search(r'补录|补招|追加|第[二两三]批|续聘', title):
        return 'supplemental'
    if deadline and today:
        try:
            d1 = dt.date.fromisoformat(today)
            d2 = dt.date.fromisoformat(deadline[:10])
            if 0 <= (d2 - d1).days <= 3:
                return 'expiring_soon'
        except Exception:
            pass
    return 'accepting'


def detect_job_events(job, old, now, changed):
    """Detect changes between previous and incoming versions of a job."""
    today = (now or '')[:10]
    pub_date = (job.get('published_at') or today)[:10]

    timeline = list(old.get('timeline') or []) if old else []
    recent_change = old.get('recent_change') if old else None

    # Base initial publication event
    if not timeline:
        timeline.append({
            'date': pub_date,
            'timestamp': job.get('published_at') or now,
            'type': 'published',
            'title': '首次发布',
            'detail': f'来源于 {job.get("source_name", "招聘信息渠道")}',
            'source': job.get('source_name', ''),
        })

    title = job.get('title', '')
    text = job.get('body', '') or job.get('excerpt', '')

    if not old:
        # First seen - check if announcement itself announces an extension, supplemental or selection
        if re.search(r'延长|延期|推迟', title) or re.search(r'经研究.*?延长|报名时间延长至|截止时间延长至', text):
            dl = job.get('deadline')
            detail = f'报名截止时间延期至 {dl}' if dl else '报名截止时间已延期（见原公告）'
            recent_change = {'type': 'deadline_extended', 'label': '截止延期', 'date': pub_date, 'detail': detail}
            timeline.append({
                'date': pub_date,
                'timestamp': job.get('published_at') or now,
                'type': 'deadline_extended',
                'title': '截止延期',
                'detail': detail,
            })
        elif re.search(r'补录|补招|追加|第[二两三]批|续聘', title):
            detail = '启动补录 / 追加招聘批次'
            recent_change = {'type': 'supplemental', 'label': '补录招募', 'date': pub_date, 'detail': detail}
            timeline.append({
                'date': pub_date,
                'timestamp': job.get('published_at') or now,
                'type': 'supplemental',
                'title': '补录招募启动',
                'detail': detail,
            })
        elif re.search(r'笔试|面试|初试|复试|录用名单|拟录用|体检通知|公示', title):
            detail = '发布考核选拔或录用进展通知'
            recent_change = {'type': 'selection_stage', 'label': '考核进展', 'date': pub_date, 'detail': detail}
            timeline.append({
                'date': pub_date,
                'timestamp': job.get('published_at') or now,
                'type': 'selection_stage',
                'title': '考核选拔进展',
                'detail': detail,
            })

        if job.get('position_count'):
            timeline.append({
                'date': pub_date,
                'timestamp': job.get('published_at') or now,
                'type': 'positions_updated',
                'title': '岗位表就绪',
                'detail': f'包含 {job.get("position_count")} 个具体招聘岗位与专业要求',
            })
    elif changed:
        event_type = None
        event_title = None
        diff_snippets = []

        # 1. Deadline change
        old_dl = old.get('deadline') or ''
        new_dl = job.get('deadline') or ''
        if old_dl and new_dl and new_dl > old_dl:
            diff_snippets.append(f'报名截止时间延长至 {new_dl}（原截止时间：{old_dl}）')
            event_type = 'deadline_extended'
            event_title = '截止延期'
        elif not old_dl and new_dl:
            diff_snippets.append(f'明确报名截止时间为 {new_dl}')
            event_type = 'deadline_extended'
            event_title = '明确截止时间'
        elif old_dl and new_dl and new_dl < old_dl:
            diff_snippets.append(f'报名截止时间调整为 {new_dl}（原截止时间：{old_dl}）')
            event_type = 'deadline_extended'
            event_title = '截止调整'

        # 2. Supplemental
        old_supp = bool(re.search(r'补录|补招|追加|第[二两三]批|续聘', old.get('title', '')))
        new_supp = bool(re.search(r'补录|补招|追加|第[二两三]批|续聘', job.get('title', '')))
        if new_supp and not old_supp:
            diff_snippets.append('招聘变更为补录 / 追加招聘批次')
            if not event_type:
                event_type = 'supplemental'
                event_title = '补录招募'

        # 3. Selection stage
        old_sel = bool(re.search(r'笔试|面试|初试|复试|录用名单|拟录用|公示', old.get('title', '')))
        new_sel = bool(re.search(r'笔试|面试|初试|复试|录用名单|拟录用|公示', job.get('title', '')))
        if new_sel and not old_sel:
            diff_snippets.append('发布笔试/面试或录用公示通知')
            if not event_type:
                event_type = 'selection_stage'
                event_title = '考核进展'

        # 4. Position & Major updates
        old_pc = old.get('position_count') or 0
        new_pc = job.get('position_count') or 0
        old_majors = set(old.get('majors') or [])
        new_majors = set(job.get('majors') or [])
        if new_pc != old_pc or (new_majors - old_majors):
            added = list(new_majors - old_majors)[:3]
            major_text = f"，新增专业：{'、'.join(added)}" if added else ''
            diff_snippets.append(f'岗位需求变动为 {new_pc} 个职位{major_text}')
            if not event_type:
                event_type = 'positions_updated'
                event_title = '岗位表更新'

        # 5. Work location / Cities change
        old_cities = set(old.get('cities') or [])
        new_cities = set(job.get('cities') or [])
        if old_cities != new_cities:
            added_cities = sorted(list(new_cities - old_cities))
            removed_cities = sorted(list(old_cities - new_cities))
            if added_cities and not removed_cities:
                diff_snippets.append(f'工作地点新增「{"、".join(added_cities)}」')
            elif added_cities and removed_cities:
                diff_snippets.append(f'工作地点调整为「{"、".join(sorted(new_cities))}」（新增{"、".join(added_cities)}）')
            elif removed_cities and new_cities:
                diff_snippets.append(f'工作地点调整为「{"、".join(sorted(new_cities))}」')
            if not event_type:
                event_type = 'content_updated'
                event_title = '地点调整'

        # 6. Application URL update
        old_app = (old.get('application_url') or '').strip()
        new_app = (job.get('application_url') or '').strip()
        if new_app != old_app:
            if new_app and not old_app:
                diff_snippets.append('新增网申投递入口')
            elif new_app and old_app:
                diff_snippets.append('网申投递入口已更新为最新链接')
            else:
                diff_snippets.append('网申投递方式调整')
            if not event_type:
                event_type = 'content_updated'
                event_title = '入口更新'

        # 7. Attachments change
        old_atts = [(a.get('title') or '').strip() for a in old.get('attachments') or [] if isinstance(a, dict) and a.get('title')]
        new_atts = [(a.get('title') or '').strip() for a in job.get('attachments') or [] if isinstance(a, dict) and a.get('title')]
        added_atts = [t for t in new_atts if t not in old_atts]
        if added_atts:
            sample_att = added_atts[0]
            if len(sample_att) > 20: sample_att = sample_att[:19] + '…'
            att_text = f'新增/更新附件「{sample_att}」' + (f' 等 {len(added_atts)} 个文件' if len(added_atts) > 1 else '')
            diff_snippets.append(att_text)
            if not event_type:
                event_type = 'content_updated'
                event_title = '附件变动'

        # 8. Education requirement change
        old_edu = (old.get('education') or '').strip()
        new_edu = (job.get('education') or '').strip()
        if old_edu and new_edu and old_edu != new_edu:
            diff_snippets.append(f'学历要求调整为「{new_edu}」（原要求：{old_edu}）')
            if not event_type:
                event_type = 'content_updated'
                event_title = '资格调整'

        # 9. Substantive text changes in announcement body / excerpt
        if not diff_snippets:
            old_text = re.sub(r'<[^>]+>', ' ', old.get('body') or old.get('excerpt') or '')
            new_text = re.sub(r'<[^>]+>', ' ', job.get('body') or job.get('excerpt') or '')
            old_lines = set(line.strip() for line in old_text.splitlines() if len(line.strip()) >= 5)
            new_lines = [line.strip() for line in new_text.splitlines() if len(line.strip()) >= 5]
            added_lines = [line for line in new_lines if line not in old_lines]
            if added_lines:
                added_sample = ' '.join(added_lines)
                if re.search(r'待遇|薪资|津贴|年薪|月薪|福利', added_sample):
                    diff_snippets.append('公告正文补充薪酬福利与待遇说明')
                elif re.search(r'投递|邮箱|简历|报名|入口|方式|流程', added_sample):
                    diff_snippets.append('公告正文补充简历投递与报名流程说明')
                elif re.search(r'专业|学科|学历|要求|条件|资格|生源', added_sample):
                    diff_snippets.append('公告正文微调应聘条件与资格要求')
                else:
                    sample = added_lines[0]
                    if len(sample) > 24: sample = sample[:23] + '…'
                    diff_snippets.append(f'正文变动：补充「{sample}」')
            else:
                diff_snippets.append('招聘公告正文说明已同步最新修订')
            if not event_type:
                event_type = 'content_updated'
                event_title = '内容更新'

        final_detail = '；'.join(diff_snippets[:2])
        detected_event = {
            'date': today,
            'timestamp': now,
            'type': event_type or 'content_updated',
            'title': event_title or '信息更新',
            'detail': final_detail,
        }
        recent_change = {
            'type': event_type or 'content_updated',
            'label': event_title or '信息更新',
            'date': today,
            'detail': final_detail,
        }
        timeline.append(detected_event)

    # Deduplicate timeline events by (date, type, title)
    seen_keys = set()
    deduped_timeline = []
    for evt in timeline:
        key = (evt.get('date'), evt.get('type'), evt.get('title'))
        if key not in seen_keys:
            seen_keys.add(key)
            deduped_timeline.append(evt)

    deduped_timeline.sort(key=lambda e: e.get('date') or '')
    return deduped_timeline, recent_change


def compute_job_fingerprint(job):
    """Compute content-based fingerprint ignoring volatile metadata, timestamps, and unstructured raw payloads."""
    core = {
        'title': (job.get('title') or '').strip(),
        'company': (job.get('company') or '').strip(),
        'deadline': job.get('deadline'),
        'cities': sorted(job.get('cities') or []),
        'education': (job.get('education') or '').strip(),
        'types': sorted(job.get('types') or []),
        'graduation_years': sorted(job.get('graduation_years') or []),
        'application_url': (job.get('application_url') or '').strip(),
        'emails': sorted(job.get('emails') or []),
        'attachments': sorted([
            ((a.get('title') or '').strip(), (a.get('url') or '').strip())
            for a in (job.get('attachments') or []) if isinstance(a, dict)
        ]),
        'positions': sorted([
            ((p.get('name') or '').strip(), (p.get('city') or '').strip(), (p.get('education') or '').strip(),
             ','.join(sorted(p.get('majors') or [])))
            for p in (job.get('positions') or []) if isinstance(p, dict)
        ]),
        'body_text': re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', job.get('body') or job.get('excerpt') or '')).strip(),
    }
    return hashlib.sha256(json.dumps(core, sort_keys=True, ensure_ascii=False).encode('utf-8')).hexdigest()


def repair_sdu_urls(jobs):
    """Repair transport URLs, preserving every historical ID and its identity."""
    repaired = {}
    for identifier, original in jobs.items():
        job = dict(original)
        if job.get('source_id') == 'sdu':
            old_url = job.get('source_url', '')
            if 'jobcareer.sdu.edu.cn/eweb/jygl/index.somodcode=' in old_url:
                job.setdefault('identity', old_url)
                job['source_url'] = old_url.replace('index.somodcode=', 'index.so?modcode=', 1)
            app_url = job.get('application_url') or ''
            if 'jobcareer.sdu.edu.cn/eweb/jygl/index.somodcode=' in app_url:
                job['application_url'] = app_url.replace('index.somodcode=', 'index.so?modcode=', 1)
        repaired[identifier] = job
    return repaired


def item_id(item):
    return item.get('target_id') or hashlib.sha256(item.get('identity', item['url']).encode()).hexdigest()[:20]


LISTING_FIELDS = ('listing_status', 'listing_checked_at', 'listing_missing_count', 'listing_missing_at')


def reconcile_listings(jobs, source_id, seen_ids, complete, now):
    """Only consecutive complete inventories can establish an official removal."""
    result = dict(jobs)
    for identifier, old in jobs.items():
        if old.get('source_id') != source_id:
            continue
        job = dict(old)
        if identifier in seen_ids:
            job.update(listing_status='active', listing_checked_at=now, listing_missing_count=0)
            job.pop('listing_missing_at', None)
        elif complete:
            last_missing = old.get('listing_missing_at')
            count = old.get('listing_missing_count', 0)
            # A manual rerun minutes later is not an independent verification.
            if not last_missing or (dt.datetime.fromisoformat(now) - dt.datetime.fromisoformat(last_missing)).total_seconds() >= 6 * 3600:
                count += 1
                job['listing_missing_at'] = now
            job.update(listing_status='withdrawn' if count >= 2 else 'unconfirmed',
                       listing_missing_count=count, listing_checked_at=now)
        else:
            continue
        job['lifecycle_stage'] = compute_lifecycle_stage(job, now)
        result[identifier] = job
    return result


def merge(previous, incoming, now):
    # Old malformed and correct SDU URLs can both have saved browser records.
    # Refresh their facts together and collapse only the public presentation.
    incoming = {job['id']: job for job in incoming}
    by_url = {}
    for old in previous.values():
        if old.get('source_id') == 'sdu':
            by_url.setdefault(old.get('source_url'), []).append(old)
    for job in list(incoming.values()):
        if job.get('source_id') == 'sdu':
            for alias in by_url.get(job.get('source_url'), []):
                if alias['id'] not in incoming:
                    incoming[alias['id']] = dict(job, id=alias['id'], identity=alias.get('identity', alias['source_url']))
    result = dict(previous)
    counts = {'new': 0, 'changed': 0, 'unchanged': 0}
    for job in incoming.values():
        fingerprint = compute_job_fingerprint(job)
        old = previous.get(job['id'])
        changed = False
        if old:
            old_fp = old.get('content_fingerprint')
            if not old_fp:
                old_fp = compute_job_fingerprint(old)
            changed = bool(old_fp != fingerprint)

        timeline, recent_change = detect_job_events(job, old, now, changed)

        # Clear out legacy generic boilerplate if no substantive change occurred
        if not changed and recent_change and recent_change.get('detail') == '招聘公告正文或附件内容已同步最新变动':
            recent_change = None
            if timeline:
                timeline = [e for e in timeline if e.get('detail') != '招聘公告正文或附件内容已同步最新变动']

        stage = compute_lifecycle_stage({**job, 'recent_change': recent_change}, now)
        row = dict(job, fingerprint=fingerprint, content_fingerprint=fingerprint,
                   first_seen_at=old.get('first_seen_at', now) if old else now,
                   updated_at=now if changed or not old else old.get('updated_at', now), last_verified_at=now,
                   revision=old.get('revision', 1) + int(changed) if old else 1,
                   timeline=timeline, recent_change=recent_change, lifecycle_stage=stage)
        result[job['id']] = row
        counts['changed' if changed else 'unchanged' if old else 'new'] += 1
    return result, counts


def atomic_json(path,value,pretty=True):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_suffix('.tmp')
    temp.write_text(json.dumps(value,ensure_ascii=False,indent=2 if pretty else None,
                               separators=None if pretty else (',',':')),encoding='utf-8')
    os.replace(temp,path)


def normalize_company(name):
    if not name:
        return ''
    c = re.sub(r'\s+', '', name).translate(str.maketrans('（）', '()'))
    c = re.sub(r'\((?:中国|集团|有限|股份|分公司|有限责任).*?\)', '', c)
    c = re.sub(r'(?:有限责任公司|股份有限公司|有限公司|集团有限公司|集团)(?=(?:[\u4e00-\u9fa5]{2,10}?(?:分行|支行|分公司|中心|办事处))?$)', '', c)
    return c.strip()


def normalize_title_core(title):
    if not title:
        return ''
    t = re.sub(r'\s+', '', title).translate(str.maketrans('（）', '()'))
    t = re.sub(r'^[【\[\(（][^】\]\)）]{1,20}[】\]\)）]', '', t)
    t = re.sub(r'(?:校园招聘(?:简章|公告|启事)?|招聘(?:简章|公告|启事|信息)?|简章|公告|启事|专场)$', '', t)
    t = re.sub(r'(20\d{2})年$', r'\1', t)
    return t.strip()


def deduplicate(jobs):
    """Collapse same-opportunity reposts and cross-channel listings.
    Preserve every source URL, application URLs, and differing job/location facts.
    """
    groups = {}
    sdu_keys = {}
    for job in sorted(jobs, key=lambda j: (j.get('first_seen_at', ''), j['id'])):
        text = re.sub(r'\s+', '', job.get('body', ''))
        company = re.sub(r'\s+', '', job.get('company') or '')
        kind = job.get('kind', '招聘公告')
        cities = tuple(sorted(job.get('cities', [])))
        norm_comp = normalize_company(company)
        norm_title = normalize_title_core(job.get('title', ''))

        if kind == '具体岗位':
            if not company or not job.get('title'):
                key = ('position_fallback', job['id'])
            else:
                key = ('position', norm_comp, re.sub(r'\s+', '', job['title']), cities)
        else:
            # Keep campaign years separate from graduation cohorts.  A title
            # such as ``2026年校园招聘`` may recruit the 2027届 cohort; use
            # the explicit body-derived cohort first and only fall back to a
            # campaign year when no cohort evidence exists for deduplication.
            title_cohorts = re.findall(r'(20\d{2})\s*(?:届|应届|年应届|年(?:高校)?毕业|(?=校园招聘|校招))', job.get('title', ''))
            campaign_years = re.findall(r'(20\d{2})\s*(?:年(?:度)?\s*)?(?=校园招聘|校招)', job.get('title', ''))
            cohorts = tuple(sorted(set(title_cohorts or job.get('graduation_years', []) or campaign_years)))
            phase = '校招'
            if re.search(r'春(?:季校园招聘|季招聘|招).*?补[录招]|补[录招].*?春[季招]', job.get('title', '')): phase = '春招补录'
            elif re.search(r'秋(?:季校园招聘|季招聘|招).*?补[录招]|补[录招].*?秋[季招]', job.get('title', '')): phase = '秋招补录'
            elif re.search(r'补录|补招|追加|第[二两三]批|续聘', job.get('title', '')): phase = '补录'
            elif re.search(r'提前批', job.get('title', '')): phase = '提前批'
            elif re.search(r'春(?:季校园招聘|季招聘|招)', job.get('title', '')): phase = '春招'
            elif re.search(r'秋(?:季校园招聘|季招聘|招)', job.get('title', '')): phase = '秋招'
            elif re.search(r'社招|社会', job.get('title', '')): phase = '社招'
            elif re.search(r'实习', job.get('title', '')): phase = '实习'

            batch_m = re.search(r'(第[一二两三四五1-5]批|第[一二两三四五1-5]期)', job.get('title', ''))
            batch_tag = batch_m.group(1) if batch_m else ''

            if not company and not norm_title:
                key = ('announcement_id', job['id'])
            elif norm_comp and cohorts and '校招' in job.get('types', ['校招']):
                key = ('campus_announcement', norm_comp, cohorts, phase, batch_tag)
            elif norm_comp and norm_title:
                key = ('announcement_norm', norm_comp, norm_title)
            elif norm_title:
                key = ('announcement_title', norm_title, cities)
            else:
                key = ('announcement_exact', re.sub(r'\s+', '', job['title']), company, text)

        if job.get('source_id') == 'sdu':
            key = sdu_keys.setdefault(job.get('source_url'), key)
        if key not in groups:
            primary_facts = {
                'id': job['id'],
                'identity': job.get('identity'),
                'company': job.get('company', ''),
                'title': job.get('title', ''),
                'published_at': job.get('published_at'),
                'cities': list(job.get('cities', [])),
                'location_evidence': list(job.get('location_evidence', [])),
                'education': job.get('education', ''),
                'deadline': job.get('deadline'),
                'deadline_evidence': job.get('deadline_evidence'),
                'deadline_precision': job.get('deadline_precision'),
                'types': list(job.get('types', [])),
                'graduation_years': list(job.get('graduation_years', [])),
                'positions': job.get('positions'),
                'position_count': job.get('position_count'),
                'sample_positions': job.get('sample_positions'),
                'majors': job.get('majors'),
                'application_url': job.get('application_url'),
                'source_url': job.get('source_url', ''),
                'source_id': job.get('source_id', ''),
                'source_name': job.get('source_name', ''),
                'body': job.get('body'),
                'excerpt': job.get('excerpt'),
                'first_seen_at': job.get('first_seen_at'),
                'updated_at': job.get('updated_at'),
                'last_verified_at': job.get('last_verified_at'),
                'revision': job.get('revision'),
                'timeline': job.get('timeline'),
                'recent_change': job.get('recent_change'),
                'lifecycle_stage': job.get('lifecycle_stage'),
                'structured': job.get('structured'),
            }
            primary_facts.update({field: job.get(field) for field in LISTING_FIELDS})
            primary_facts['detail_verification'] = job.get('detail_verification')
            groups[key] = dict(job, duplicate_sources=[], duplicate_ids=[], primary_facts=primary_facts)
        else:
            parent = groups[key]
            existing_urls = {parent.get('source_url')} | {s.get('url') for s in parent['duplicate_sources']}
            duplicate_facts = {
                'id': job['id'],
                'identity': job.get('identity'),
                'company': job.get('company', ''),
                'title': job.get('title', ''),
                'published_at': job.get('published_at'),
                'cities': list(job.get('cities', [])),
                'location_evidence': list(job.get('location_evidence', [])),
                'education': job.get('education', ''),
                'deadline': job.get('deadline'),
                'deadline_evidence': job.get('deadline_evidence'),
                'deadline_precision': job.get('deadline_precision'),
                'types': list(job.get('types', [])),
                'graduation_years': list(job.get('graduation_years', [])),
                'positions': job.get('positions'),
                'position_count': job.get('position_count'),
                'sample_positions': job.get('sample_positions'),
                'majors': job.get('majors'),
                'application_url': job.get('application_url'),
                'source_url': job.get('source_url', ''),
                'source_id': job.get('source_id', ''),
                'source_name': job.get('source_name', ''),
                'body': job.get('body'),
                'excerpt': job.get('excerpt'),
                'first_seen_at': job.get('first_seen_at'),
                'updated_at': job.get('updated_at'),
                'last_verified_at': job.get('last_verified_at'),
                'revision': job.get('revision'),
                'timeline': job.get('timeline'),
                'recent_change': job.get('recent_change'),
                'lifecycle_stage': job.get('lifecycle_stage'),
                'structured': job.get('structured'),
            }
            duplicate_facts.update({field: job.get(field) for field in LISTING_FIELDS})
            duplicate_facts['detail_verification'] = job.get('detail_verification')
            if (job.get('listing_checked_at') or '') > (parent.get('listing_checked_at') or ''):
                parent.update({field: job.get(field) for field in LISTING_FIELDS})
            parent['duplicate_sources'].append({
                'id': job['id'],
                'identity': job.get('identity'),
                'source': job.get('source_name') or job.get('source_id', ''),
                'source_name': job.get('source_name', ''),
                'title': job.get('source_name', ''),
                'announcement_title': job.get('title', ''),
                'url': job.get('source_url', ''),
                'facts': duplicate_facts,
                **({'published_at': job['published_at']} if job.get('published_at') else {}),
                **({'application_url': job['application_url']} if job.get('application_url') else {}),
            })
            parent['duplicate_ids'].append(job['id'])

            if job.get('published_at'):
                if not parent.get('published_at') or job['published_at'] < parent['published_at']:
                    parent['published_at'] = job['published_at']
            if not parent.get('application_url') and job.get('application_url'):
                parent['application_url'] = job['application_url']
            if job.get('deadline'):
                if not parent.get('deadline') or job['deadline'] > parent['deadline']:
                    parent['deadline'] = job['deadline']
                    parent['deadline_evidence'] = job.get('deadline_evidence')
                    parent['deadline_precision'] = job.get('deadline_precision')
            if job.get('emails'):
                parent['emails'] = list(dict.fromkeys(parent.get('emails', []) + job['emails']))
            if job.get('cities'):
                parent['cities'] = sorted(set(parent.get('cities', []) + job['cities']))
            if job.get('location_evidence'):
                parent['location_evidence'] = list(dict.fromkeys(parent.get('location_evidence', []) + job['location_evidence']))
            if job.get('graduation_years'):
                parent['graduation_years'] = sorted(set(parent.get('graduation_years', []) + job['graduation_years']))
            if job.get('types'):
                parent['types'] = sorted(set(parent.get('types', []) + job['types']))
            if job.get('attachments'):
                att_urls = {a.get('url') for a in parent.get('attachments', [])}
                for a in job['attachments']:
                    if a.get('url') not in att_urls:
                        parent.setdefault('attachments', []).append(a)
                        att_urls.add(a.get('url'))
            if parent.get('provenance') == '第三方线索' and job.get('provenance') == '公开原始来源':
                parent['source_name'] = job['source_name']
                parent['source_url'] = job['source_url']
                parent['source_id'] = job['source_id']
                parent['provenance'] = '公开原始来源'
                parent['title'] = job['title']
                if job.get('body'):
                    parent['body'] = job['body']
                    parent['excerpt'] = job.get('excerpt', parent.get('excerpt', ''))
            elif len(job.get('body', '')) > len(parent.get('body', '')) + 200:
                parent['body'] = job['body']
                parent['excerpt'] = job.get('excerpt', parent.get('excerpt', ''))

            # Merge positions across duplicate sources
            if job.get('positions'):
                current_positions = parent.get('positions') or []
                combined_positions = deduplicate_positions(current_positions + job['positions'])
                enrich_job_with_positions(parent, combined_positions)

            # Merge timeline events across duplicate sources
            if job.get('timeline'):
                p_timeline = parent.get('timeline') or []
                p_keys = {(e.get('date'), e.get('type'), e.get('title')) for e in p_timeline}
                for e in job['timeline']:
                    k = (e.get('date'), e.get('type'), e.get('title'))
                    if k not in p_keys:
                        p_timeline.append(dict(e))
                        p_keys.add(k)
                p_timeline.sort(key=lambda e: e.get('date') or '')
                has_first_published = False
                for evt in p_timeline:
                    if evt.get('type') == 'published' or evt.get('title') == '首次发布':
                        if not has_first_published:
                            has_first_published = True
                            evt['type'] = 'published'
                            evt['title'] = '首次发布'
                        else:
                            evt['type'] = 'source_repost'
                            evt['title'] = '跨渠道发布'
                            src = evt.get('source') or job.get('source_name', '')
                            if src and '同步发布' not in evt.get('detail', ''):
                                evt['detail'] = f'在「{src}」同步发布'
                parent['timeline'] = p_timeline

            # Merge recent_change with priority
            change_prio = {
                'deadline_extended': 5,
                'supplemental': 4,
                'selection_stage': 3,
                'positions_updated': 2,
                'content_updated': 1,
            }
            if job.get('recent_change'):
                if not parent.get('recent_change'):
                    parent['recent_change'] = job['recent_change']
                else:
                    curr_p = change_prio.get(parent['recent_change'].get('type'), 0)
                    new_p = change_prio.get(job['recent_change'].get('type'), 0)
                    curr_is_placeholder = parent['recent_change'].get('detail') == '招聘公告正文或附件内容已同步最新变动'
                    new_is_placeholder = job['recent_change'].get('detail') == '招聘公告正文或附件内容已同步最新变动'
                    if new_p > curr_p or (new_p == curr_p and curr_is_placeholder and not new_is_placeholder):
                        parent['recent_change'] = job['recent_change']

            if not parent.get('lifecycle_stage') and job.get('lifecycle_stage'):
                parent['lifecycle_stage'] = job['lifecycle_stage']

    return list(groups.values())


def public_record(job):
    """Recompute derived location labels from retained text, without advancing verification time."""
    row=refine_facts({k:v for k,v in job.items() if k!='fingerprint'})
    row['provenance']='第三方线索' if row.get('source_id') in {'wondercv','offerjack'} else '公开原始来源'
    row.setdefault('kind','招聘公告')
    combined_text=row.get('title','')+'\n'+(row.get('body') or row.get('excerpt') or '')
    extra_years=extract_graduation_years(combined_text)
    row['graduation_years']=sorted(set(row.get('graduation_years',[])+extra_years))
    label=LOCATION_LABEL
    # Preserve structured regions, table cells and district-code evidence; re-read text sections.
    evidence=[s for s in row.get('location_evidence',[]) if not re.match(label,s)]
    # Some structured location fields do not appear in body; retain their first value line.
    for old in row.get('location_evidence',[]):
        if re.match(label,old):
            parts=old.splitlines()
            value=re.sub('^'+label+r'[\]】 ：:\t]*','',parts[0]).strip()
            if not value and len(parts)>1: value=parts[1]
            if value: evidence.append('工作地点：'+value)
    evidence = extract_locations_from_text(evidence, row.get('body', ''), row.get('title', ''), row.get('company', ''))
    if row.get('source_id') == 'upc':
        body_and_title = (row.get('body', '') + '\n' + row.get('title', ''))
        pos_text = ' '.join((p.get('city', '') or '') + ' ' + (p.get('name', '') or '') for p in (row.get('positions') or []))
        # ``用人单位所在地`` is a registration address, not a work location.
        # Do not use a city mentioned only in that field to validate an old
        # generic ``工作地点`` evidence value carried by a historical record.
        work_text = re.sub(r'用人单位所在地[：:\s]*[^\n。；;]{0,160}', '', body_and_title)
        work_label = re.compile(
            r'(?:工作地点|工作城市|岗位地点|工作地域|招聘地点|工作区域|意向工作地|意向城市|工作地|招聘城市|所属分行|所属分公司)[：:\s，、]*(.*)'
        )
        work_lines = work_text.splitlines()
        work_values = []
        for idx, line in enumerate(work_lines):
            match = work_label.search(line)
            if not match:
                continue
            value = match.group(1).strip()
            if not value and idx + 1 < len(work_lines):
                value = work_lines[idx + 1].strip()
            if value:
                work_values.append(value[:160])
        work_location_text = ' '.join(work_values) + ' ' + pos_text
        sanitized_evidence = []
        for ev in evidence:
            m = re.match(r'^工作地点[：:\s]*(.*)', ev)
            if m:
                ev_val = m[1].strip()
                matched_cities = [c for c in CITIES if c in ev_val]
                if matched_cities and all(c not in work_location_text for c in matched_cities):
                    continue
            sanitized_evidence.append(ev)
        evidence = sanitized_evidence
    evidence = filter_institution_locations(evidence)
    row['location_evidence']=list(dict.fromkeys(evidence))
    row['cities']=[city for city in CITIES if any(city in s for s in evidence if not s.startswith('用人单位所在地：'))]
    row['domestic_status']=domestic_status(row['location_evidence'],row['cities'])
    if 'graduation_years' in row:
        row['graduation_years']=[y for y in row['graduation_years'] if VALID_GRADUATION_YEAR_MIN <= int(y) <= VALID_GRADUATION_YEAR_MAX]
    if row.get('source_id')=='wondercv':
        row['types']=list(dict.fromkeys(row['types']+['校招']))
        combined=row['title']+'\n'+row.get('body','')
        extra_years=extract_graduation_years(combined)
        row['graduation_years']=sorted(set(row['graduation_years']+extra_years))
        if not row.get('deadline'):
            row['deadline'],row['deadline_evidence'],row['deadline_precision']=deadline(row.get('body',''))
    if not row.get('timeline'):
        timeline, recent_change = detect_job_events(row, None, row.get('published_at') or '', False)
        row['timeline'] = timeline
        if not row.get('recent_change') and recent_change:
            row['recent_change'] = recent_change
    if not row.get('lifecycle_stage'):
        row['lifecycle_stage'] = compute_lifecycle_stage(row, row.get('updated_at') or row.get('published_at') or '')
    return row


def public_summary(job):
    """Keep listing/filter fields in the index; full announcement text lives separately."""
    heavy={
        'body','attachments','links','emails','qr_attachment','deadline_evidence',
        'possible_cities','province_possible','details_available','company_original',
        'positions','primary_facts','structured','identity','fingerprint','content_fingerprint',
        'probe_attempt_at','listing_missing_count','listing_missing_at',
    }
    row={k:v for k,v in job.items() if k not in heavy}
    # The full timeline remains in the detail. Retain all recent change events
    # needed by filters; initial publication/reposts are derived from metadata.
    row['timeline'] = [event for event in row.get('timeline', [])
                       if event.get('type') not in {'published', 'source_repost'}]
    if 'duplicate_sources' in row and isinstance(row['duplicate_sources'], list):
        cleaned_sources = []
        for s in row['duplicate_sources']:
            s_clean = dict(s)
            s_clean.pop('facts', None)
            s_clean.pop('identity', None)
            cleaned_sources.append(s_clean)
        row['duplicate_sources'] = cleaned_sources
    return row


def build_search_text(job):
    body = job.get('body', '')
    if not job.get('positions'):
        return body
    parts = [body] if body else []
    for p in job['positions']:
        if p.get('name'): parts.append(p['name'])
        if p.get('majors'): parts.extend(p['majors'])
        if p.get('education'): parts.append(p['education'])
        if p.get('city'): parts.append(p['city'])
        if p.get('notes'): parts.append(p['notes'])
    return '\n'.join(parts)


def schedule_enabled():
    value=os.environ.get('JOB_RADAR_SCHEDULE_ENABLED','')
    return value.strip().lower() in {'1','true','yes','on'}


def export_snapshot(state, public_dir, days=180, changes=None):
    """Publish the index last; immutable assets cannot mix across refreshes."""
    jobs=repair_sdu_urls(state['jobs'])
    eligible = [j for j in jobs.values() if publishable_job(j)]
    public_jobs=sorted(deduplicate([public_record(j) for j in eligible]),
                       key=lambda j:j.get('published_at') or '',reverse=True)
    assets=public_dir/'job-assets'
    assets.mkdir(parents=True,exist_ok=True)
    def asset(prefix, payload):
        content=json.dumps(payload,ensure_ascii=False,separators=(',',':'))
        name=prefix+'-'+hashlib.sha256(content.encode()).hexdigest()[:20]+'.json'
        target=assets/name
        if not target.exists(): target.write_text(content,encoding='utf-8')
        return '/job-assets/'+name
    shards={}
    for job in public_jobs:
        shards.setdefault(job['id'][:2],{})[job['id']]=job
    detail_shards={key:asset('detail-'+key,{'schema_version':1,'jobs':rows}) for key,rows in shards.items()}
    search_url=asset('search',{'jobs':{j['id']:build_search_text(j) for j in public_jobs}})
    snapshot={'schema_version':2,'generated_at':state['last_run_at'],
              'last_success_at':max((j['last_verified_at'] for j in jobs.values()),default=None),
              'schedule_enabled':schedule_enabled(),'raw_records':len(eligible),
              'withheld_records':len(jobs)-len(eligible),
              'duplicates_merged':len(eligible)-len(public_jobs),'coverage_days':days,'cities':CITIES,
              'detail_shards':detail_shards,'search_url':search_url,
              'jobs':[public_summary(j) for j in public_jobs],
              'sources':list(state['sources'].values()),'changes':changes or {}}
    atomic_json(public_dir/'jobs.json',snapshot,pretty=False)
    atomic_json(public_dir/'snapshot-manifest.json', {
        'schema_version': 1, 'generated_at': snapshot['generated_at'],
        'raw_records': len(eligible),
        'index_sha256': hashlib.sha256((public_dir/'jobs.json').read_bytes()).hexdigest(),
    }, pretty=False)
    return snapshot


PAGINATION_FIELDS = (
    'resume_page', 'list_complete', 'total_items', 'early_exit_safe',
    'completed_history_days', 'target_history_days', 'patrol_page',
    'last_full_scan_at', 'last_patrol_at', 'coverage_warning', 'patrol_turn'
)


def run(args):
    data_dir=Path(getattr(args,'data_dir','') or (ROOT/'data')).expanduser()
    data_dir.mkdir(parents=True,exist_ok=True)
    collector_runtime.configure_shared_pacing(getattr(args, 'rate_state', None))
    public_dir=Path(getattr(args,'public_dir','') or (ROOT/'public')).expanduser()
    public_dir.mkdir(parents=True,exist_ok=True)
    path=data_dir/'state.json'
    previous=json.loads(path.read_text(encoding='utf-8')) if path.exists() else {'jobs':{},'sources':{}}
    previous['jobs'] = repair_sdu_urls(previous['jobs'])
    initial_jobs = dict(previous['jobs'])
    queues = dict(previous.get('pending', {}))
    journal = data_dir / 'progress.jsonl'
    journal.write_text('', encoding='utf-8')
    def persist_job(job, item, verified=True):
        with journal.open('a', encoding='utf-8') as handle:
            handle.write(json.dumps({'job': job, 'url': item['url'], 'verified': verified}, ensure_ascii=False) + '\n')
    now=dt.datetime.now(TZ).isoformat(timespec='seconds')
    cutoff=(dt.datetime.now(TZ)-dt.timedelta(days=args.days)).date().isoformat()
    incoming=[]
    sources=dict(previous['sources'])
    source_filter = set(filter(None, (getattr(args, 'sources', '') or '').split(',')))
    source_pack = getattr(args, 'source_pack', '') or ''
    if source_pack:
        pack_source_ids = set(source_pack_ids(source_pack))
        if source_filter and source_filter != pack_source_ids:
            raise ValueError('--sources and --source-pack select different source sets')
        source_filter = pack_source_ids
    deep_scan_arg = getattr(args, 'deep_scan', None)
    if deep_scan_arg is True:
        is_deep_scan = True
    elif deep_scan_arg is False:
        is_deep_scan = False
    else:
        is_deep_scan = (dt.datetime.now(TZ).weekday() == 6)
    active_sdei_schools, sdei_group = get_active_sdei_schools(
        now_dt=dt.datetime.now(TZ),
        force_group=getattr(args, 'sdei_group', None),
        deep_scan=is_deep_scan
    )
    schools_with_new_announcements = set()
    host_blocked_until: dict[str, str] = {}
    for s_id, s_info in previous.get('sources', {}).items():
        b_until = s_info.get('blocked_until')
        if b_until:
            s_def = next((s for s in SOURCES if s['id'] == s_id), None)
            if s_def:
                s_host = urllib.parse.urlsplit(s_def['url']).netloc
                if s_host not in host_blocked_until or b_until > host_blocked_until[s_host]:
                    host_blocked_until[s_host] = b_until

    for source in SOURCES:
        if source_filter and source['id'] not in source_filter: continue
        source = {k: v for k, v in source.items() if not k.startswith('_')}
        source_started = time.monotonic()
        now=dt.datetime.now(TZ).isoformat(timespec='seconds')
        inventory_complete = False
        inventory_ids = set()
        is_active_listing_source = source.get('adapter') in {'zhiye_jobs','haier_jobs','haier_campus'}
        if source['id']=='nankai' and args.nankai_area:
            source['url']=f'https://career.nankai.edu.cn/correcruit/index/sel_area/{args.nankai_area}.html'
        prior_source = previous.get('sources', {}).get(source['id'], {})
        status=dict(source,last_attempt_at=now,last_success_at=prior_source.get('last_success_at'),pages=0,discovered=0,parsed=0,cached=0,probed=0,detail_attempted=0,detail_failed=0,detail_skipped=0,errors=[],status='ok',coverage='近期分页，非全量历史')
        for field in PAGINATION_FIELDS:
            if field in prior_source:
                status[field] = prior_source[field]
        host = urllib.parse.urlsplit(source['url']).netloc
        candidate_blocks = [t for t in (prior_source.get('blocked_until'), host_blocked_until.get(host)) if t]
        prior_blocked = max(candidate_blocks) if candidate_blocks else None
        if prior_blocked:
            try:
                blocked_dt = dt.datetime.fromisoformat(prior_blocked)
                if blocked_dt > dt.datetime.now(TZ):
                    status['status'] = 'blocked'
                    status['blocked_until'] = prior_blocked
                    status['coverage'] = f'上游安全策略拦截(HTTP 403/420)；持续冷却至 {prior_blocked[:19]}，保留历史记录'
                    if 'total_items' in prior_source:
                        status['total_items'] = prior_source['total_items']
                    sources[source['id']] = status
                    print(source['id'], 'blocked (cooling down until', prior_blocked[:19] + ')', flush=True)
                    continue
            except Exception:
                pass
        if source.get('adapter') == 'sdei':
            school = source['school']
            channel = source['channel']
            is_single_explicit_source = bool(source_filter and source_filter == {source['id']})
            if not is_single_explicit_source:
                if school not in active_sdei_schools:
                    pos_id = f'{school}-positions'
                    pos_prior = previous.get('sources', {}).get(pos_id, {})
                    pos_last_succ = pos_prior.get('last_success_at')
                    pos_needs_catchup = (
                        pos_prior.get('list_complete') is False or
                        pos_prior.get('status') in {'failed', 'partial'} or
                        bool(pos_prior.get('errors')) or
                        not pos_last_succ or
                        (dt.datetime.now(TZ) - dt.datetime.fromisoformat(pos_last_succ)).total_seconds() > 96 * 3600
                    )
                    if not (channel == 'positions' and pos_needs_catchup):
                        status['status'] = 'deferred'
                        status['coverage'] = f'高校4组轮转排期本轮休眠（当前活跃：第{sdei_group}组），保留历史数据'
                        if 'total_items' in prior_source:
                            status['total_items'] = prior_source['total_items']
                        if 'blocked_until' in prior_source:
                            status['blocked_until'] = prior_source['blocked_until']
                        sources[source['id']] = status
                        print(source['id'], 'deferred 0 0', flush=True)
                        continue
        try:
            api_adapters={'sdei','sdei_news','offerjack','upc','jinan_cms','zhiye_jobs','haier_jobs','haier_campus'}
            first=fetch(source['url']) if source.get('adapter') not in api_adapters else ''
            if not source.get('adapter') and source['id'] not in {'nankai','sdu'}: query,endpoint=gov_query(first)
            known=set()
            items=[]
            list_complete = False
            is_offerjack=source.get('adapter')=='offerjack'
            is_active_listing_source=source.get('adapter') in {'zhiye_jobs','haier_jobs','haier_campus'}
            offerjack_cities=([args.target_city] if args.target_city else ['']+CITIES) if is_offerjack else []
            offerjack_query_limit=(getattr(args,'offerjack_pages',0) or 1000) if is_offerjack else 0
            page_budget=offerjack_query_limit*len(offerjack_cities) if is_offerjack else args.pages
            offerjack_city_index=0
            offerjack_page=1
            offerjack_limited=False
            # Only independent numbered announcement lists can resume this way.
            # Live inventories need a complete single-run view for withdrawal
            # detection; SDU follows opaque next-page links; OfferJack has cities.
            resumable = (source.get('adapter') in {'sdei', 'sdei_news', 'upc', 'jinan_cms', 'official_bank', 'qdhrss', 'wondercv'}
                         or source['id'] in {'nankai', 'jinan'})
            # Target historical window
            target_history_days = max(args.days, getattr(args, 'history_days', 180)) if resumable else args.days
            cutoff = (dt.datetime.now(TZ) - dt.timedelta(days=target_history_days)).date().isoformat()
            status['target_history_days'] = target_history_days

            prior_completed = prior_source.get('completed_history_days')
            is_history_complete = (prior_completed is not None and int(prior_completed) >= target_history_days)
            prev_complete = (prior_source.get('list_complete') is True) and is_history_complete

            last_patrol = prior_source.get('last_patrol_at')
            is_patrol_due = False
            if is_history_complete:
                if last_patrol:
                    try:
                        is_patrol_due = (dt.datetime.now(TZ) - dt.datetime.fromisoformat(last_patrol)).total_seconds() > 72 * 3600
                    except Exception:
                        is_patrol_due = True
                else:
                    is_patrol_due = True

            resume_page = max(2, int(prior_source.get('resume_page') or 2)) if resumable else 2
            patrol_page = max(2, int(prior_source.get('patrol_page') or 2))
            resumed_tail = resumable and not is_history_complete and (resume_page > 2 or
                (page_budget == 1 and int(prior_source.get('resume_page') or 1) > 1))
            patrol_turn = bool(prior_source.get('patrol_turn'))
            deep_patrolled = False
            status['list_complete'] = False
            for slot in range(1,page_budget+1):
                if resumable:
                    if slot == 1:
                        if page_budget > 1:
                            page = 1
                        elif not is_history_complete:
                            page = int(prior_source.get('resume_page') or 1)
                        else:
                            page = patrol_page if ((is_patrol_due or is_deep_scan) and patrol_turn) else 1
                    else:
                        cursor = resume_page if not is_history_complete else patrol_page
                        page = cursor + (slot - 2 if page_budget > 1 else 0)
                else:
                    page = slot
                if resumable and not is_history_complete:
                    status['resume_page'] = resume_page if page == 1 else page
                try:
                    if is_offerjack:
                        if offerjack_city_index>=len(offerjack_cities):
                            status['coverage']='已查询全部配置城市的公开首屏'
                            break
                        offerjack_city=offerjack_cities[offerjack_city_index]
                        try:
                            found,total=offerjack_list(offerjack_page,offerjack_city)
                        except PublicPaginationLimit as exc:
                            if offerjack_page==1: raise
                            offerjack_limited=True
                            offerjack_query_limit=1
                            if not status['errors']:
                                status['errors'].append({'url':'https://www.offerjack.cn/','reason':str(exc)[:200]})
                            offerjack_city_index+=1
                            offerjack_page=1
                            continue
                        page_number=offerjack_page
                    elif source.get('adapter')=='sdei':
                        found,total=sdei_list(source,page)
                    elif source.get('adapter')=='sdei_news':
                        found,total=sdei_news_list(page)
                    elif source.get('adapter')=='upc':
                        found,total=upc_list(page)
                    elif source.get('adapter')=='jinan_cms':
                        found,total=jinan_cms_list(source,page)
                    elif source.get('adapter')=='official_bank':
                        page_url=official_bank_page_url(source,page)
                        html=first if page==1 else fetch(page_url)
                        found,total=official_bank_list(html,source['url'],source)
                    elif source.get('adapter')=='zhiye_jobs':
                        found,total=zhiye_jobs_list(source,page)
                    elif source.get('adapter')=='haier_jobs':
                        found,total=haier_jobs_list(page)
                    elif source.get('adapter')=='haier_campus':
                        found,total=haier_campus_list(source,page)
                    elif source.get('adapter')=='qdhrss':
                        page_url=source['url'] if page==1 else urllib.parse.urljoin(source['url'],f'index_{page-1}.shtml')
                        html=first if page==1 else fetch(page_url)
                        found,total=qdhrss_list(html,source['url'])
                    elif source.get('adapter')=='wondercv':
                        html=first if page==1 else fetch(f'https://www.wondercv.com/xiaozhao/page/pn{page}/')
                        found,total=wonder_list(html,source['url'])
                    elif source['id']=='nankai':
                        area=f'/sel_area/{args.nankai_area}' if args.nankai_area else ''
                        html=first if page==1 else fetch(f'https://career.nankai.edu.cn/correcruit/index{area}/p/{page}.html')
                        found,total=nankai_list(html,source['url'])
                    elif source['id']=='sdu':
                        html=first if page==1 else fetch(next_page)
                        found,next_page=sdu_list(html,source['url'])
                        total=args.pages+1 if next_page else page
                    else:
                        q=dict(query,paramJson=json.dumps({'pageNo':page,'pageSize':15}))
                        html=json.loads(fetch(urllib.parse.urljoin(source['url'],endpoint)+'?'+urllib.parse.urlencode(q)))['data']['html']
                        found,total=gov_list(html,source['url'],source=source)
                    status['pages']+=1
                    if page > 1:
                        deep_patrolled = True
                    if '_total_items' in source:
                        status['total_items'] = source.pop('_total_items')
                    elif total is not None and status['pages'] == 1:
                        status['total_items'] = total
                    if ((page_number if is_offerjack else page)==1 and not found and total!=0 and
                            not source.get('allow_empty_pages')):
                        raise ValueError('no announcement links; parser or source may have changed')
                    repeated=bool(found) and all(i.get('identity',i['url']) in known for i in found)
                    if repeated and not is_offerjack: raise ValueError('pagination repeated; coverage incomplete')
                except Exception as exc:
                    if not items: raise
                    status['errors'].append({'url':source['url'],'reason':f'列表分页中断：{exc}'[:200]})
                    status['coverage']=f'已读取 {status["pages"]} 页；分页中断，保留此前发现的记录'
                    break
                for item in found:
                    if item.get('identity',item['url']) not in known:
                        known.add(item.get('identity',item['url']))
                        if item.get('is_active_listing') or not item['published_at'] or item['published_at']>=cutoff:
                            items.append(item)
                if resumable:
                    if not is_history_complete:
                        if page == 1:
                            resume_page = min(resume_page, max(2, total))
                        status['resume_page'] = resume_page if page == 1 and page_budget > 1 else page + 1
                    else:
                        if page == 1:
                            patrol_page = min(patrol_page, max(2, total))
                        if page > 1:
                            status['patrol_page'] = page + 1
                    # Persist list discoveries before the next request. A hard
                    # timeout must not advance the cursor and lose these jobs.
                    backlog = {i['url']: i for i in queues.get(source['id'], [])}
                    backlog.update({i['url']: i for i in items})
                    atomic_json(data_dir/'checkpoint.json', {
                        'run_at':now, 'source':status, 'pending':list(backlog.values()),
                        'inventory_complete':False, 'inventory_ids':[],
                    })
                # Safe early exit for reverse-chronological feeds when all items already exist
                is_chrono_feed = source.get('adapter') in {'sdei', 'sdei_news', 'jinan_cms', 'qdhrss'}
                prev_ok = prior_source.get('status') == 'ok' and not prior_source.get('errors')
                prev_complete = (prior_source.get('list_complete') is True) and is_history_complete
                no_pending = not previous.get('pending', {}).get(source['id'])
                if (is_chrono_feed and not is_deep_scan and not is_patrol_due and found and page == 1
                        and prev_ok and prev_complete and no_pending
                        and not resumed_tail
                        and prior_source.get('early_exit_safe', True)):
                    source_known = [j for j in previous['jobs'].values() if j.get('source_id') == source['id']]
                    prev_total = prior_source.get('total_items')
                    if prev_total is not None and source_known:
                        all_found_exist = all(item_id(i) in previous['jobs'] for i in found)
                        max_known_date = max((j.get('published_at') or '') for j in source_known)
                        max_page_date = max((i.get('published_at') or '') for i in found)
                        not_newer = (max_page_date <= max_known_date) if (max_known_date and max_page_date) else True
                        curr_total = status.get('total_items') if status.get('total_items') is not None else total
                        total_not_increased = (curr_total <= prev_total)
                        if all_found_exist and not_newer and total_not_increased:
                            status['coverage'] = '首屏公告已全量覆盖且无新发布，安全早停'
                            status['early_exit'] = True
                            list_complete = True
                            break
                if is_offerjack:
                    if offerjack_page>=min(total,offerjack_query_limit):
                        if total>offerjack_query_limit:
                            offerjack_limited=True
                        offerjack_city_index+=1
                        offerjack_page=1
                    elif found and all(i['published_at'] and i['published_at']<cutoff for i in found):
                        offerjack_city_index+=1
                        offerjack_page=1
                    else:
                        offerjack_page+=1
                    if offerjack_city_index>=len(offerjack_cities):
                        status['coverage']='已查询全部配置城市的公开首屏'
                        break
                    continue
                if page>=total:
                    inventory_complete = True
                    list_complete = True
                    status['coverage']=('已读取官网当前全部在架岗位' if is_active_listing_source else
                                        '已读至来源列表末页（保留所选时间范围）')
                    if resumable:
                        status['completed_history_days'] = target_history_days
                        status['last_full_scan_at'] = now
                        status['last_patrol_at'] = now
                        status['resume_page'] = 1
                        status['patrol_page'] = 2
                    break
                if (found and not any(i.get('is_active_listing') for i in found) and
                        all(i['published_at'] and i['published_at']<cutoff for i in found)):
                    list_complete = True
                    status['coverage']=f'已读至 {target_history_days} 天前；更早公告未读取'
                    if resumable:
                        status['completed_history_days'] = target_history_days
                        status['last_full_scan_at'] = now
                        status['last_patrol_at'] = now
                        status['resume_page'] = 1
                        status['patrol_page'] = 2
                    break
            else:
                list_complete = False
                status['coverage']=(f'已读取前 {page_budget} 页；官网仍有在架岗位未读取'
                                    if is_active_listing_source else
                                    f'最近 {page_budget} 页；仍有更早公告未读取')
            if status['errors']:
                list_complete = False
                if is_patrol_due:
                    status['coverage_warning'] = '深页巡查已超72小时目标，且本轮因错误未能完全完成'
            elif is_patrol_due and is_history_complete:
                if deep_patrolled:
                    status['last_patrol_at'] = now
                    if status.get('patrol_page', 2) > total:
                        status['patrol_page'] = 2
            status['list_complete'] = list_complete
            if resumable:
                status['early_exit_safe'] = list_complete and not resumed_tail
                if list_complete:
                    status['resume_page'] = 1
                elif not is_history_complete and page_budget >= 3 and status.get('resume_page', 2) > 2:
                    status['resume_page'] -= 1
                if page_budget == 1 and is_history_complete and (is_patrol_due or is_deep_scan):
                    status['patrol_turn'] = not patrol_turn
                else:
                    status['patrol_turn'] = False
            status['pages_read'] = status['pages']
            if is_offerjack and offerjack_limited:
                status['coverage']=f'已读取 {status["pages"]} 个公开列表页；部分查询仍有未读取的后续页（接口或分页预算限制）'
                if not status['errors']:
                    status['errors'].append({'url':'https://www.offerjack.cn/','reason':'查询达到分页预算；后续记录未读取'})
            # Verified discovery seed keeps a useful baseline even under the bounded first crawl.
            if source['id']=='nankai':
                seed='https://career.nankai.edu.cn/correcruit/content/id/117451.html'
                if seed not in {i['url'] for i in items}:
                    items.append({'url':seed,'title':'浪潮集团2027届校园招聘简章','published_at':'2026-09-01'})
            status['discovered']=len(items)
            # Bind corrected SDU URLs to existing IDs before cache/queue lookup.
            sdu_by_url = {j['source_url']: j for j in sorted(previous['jobs'].values(), key=lambda j:j.get('last_verified_at','')) if j.get('source_id')=='sdu'}
            if source['id'] == 'sdu':
                for item in items:
                    old = sdu_by_url.get(item['url'])
                    if old:
                        item.update(target_id=old['id'], identity=old.get('identity') or old['source_url'])
            inventory_ids = {item_id(item) for item in items}
            # Resume details left by a previous source budget, including items
            # that have since moved beyond the first discovery pages.
            item_urls = {item['url'] for item in items}
            for queued in queues.get(source['id'], []):
                if queued['url'] not in item_urls:
                    items.append(queued)
                    item_urls.add(queued['url'])
            cached=0
            remaining=[]
            for item in items:
                old=previous['jobs'].get(item_id(item))
                if ('inline_html' not in item or requires_position_detail(item)) and old and publishable_job(old) and not old.get('classification_note','').startswith('仅核实') and args.refresh_hours and old['last_verified_at']>=(dt.datetime.now(TZ)-dt.timedelta(hours=args.refresh_hours)).isoformat():
                    cached+=1
                else: remaining.append(item)
            status['cached']=cached
            queued_by_url = {item['url']: item for item in remaining}
            queues[source['id']] = list(queued_by_url.values())
            atomic_json(data_dir/'checkpoint.json', {'run_at':now, 'source':status,
                        'pending':queues[source['id']], 'inventory_complete':inventory_complete,
                        'inventory_ids':sorted(inventory_ids)})
            # Active announcement probe: inspect historical unexpired jobs for this source that need re-verification.
            today_str=dt.datetime.now(TZ).date().isoformat()
            recent_expiry_cutoff=(dt.datetime.now(TZ).date()-dt.timedelta(days=7)).isoformat()
            probe_refresh_cutoff=(dt.datetime.now(TZ)-dt.timedelta(hours=args.refresh_hours)).isoformat() if args.refresh_hours else ''
            existing_urls={i.get('url') for i in items if i.get('url')}
            existing_ids={hashlib.sha256(i.get('identity',i['url']).encode()).hexdigest()[:20] for i in items if i.get('url')}

            probe_candidates=[]
            for j_id,old_job in previous.get('jobs',{}).items():
                if old_job.get('source_id')!=source['id']: continue
                # API inventories are their own recheck; their JS detail pages
                # must not be passed to the generic announcement HTML parser.
                if is_active_listing_source: continue
                url=old_job.get('source_url')
                if not url or url in existing_urls or j_id in existing_ids: continue
                d_line=old_job.get('deadline')
                is_active=(d_line is None) or (d_line>=today_str) or (d_line>=recent_expiry_cutoff)
                if not is_active: continue
                last_ver=old_job.get('last_verified_at','')
                if probe_refresh_cutoff and last_ver and last_ver>=probe_refresh_cutoff: continue
                probe_att=old_job.get('probe_attempt_at','')
                if probe_refresh_cutoff and probe_att and probe_att>=probe_refresh_cutoff: continue
                probe_candidates.append(old_job)

            probe_candidates.sort(key=lambda j:j.get('last_verified_at') or '')
            probe_budget=getattr(args,'probe_budget',10)
            selected_probes=probe_candidates[:probe_budget]
            status['probed']=len(selected_probes)

            for p_job in selected_probes:
                structured_ctx = dict(p_job.get('structured') or {})
                if p_job.get('company') and not structured_ctx.get('dwmc'):
                    structured_ctx['dwmc'] = p_job['company']
                if p_job.get('company') and not structured_ctx.get('companyName'):
                    structured_ctx['companyName'] = p_job['company']
                remaining.append({
                    'url': p_job['source_url'],
                    'title': p_job.get('title', ''),
                    'published_at': p_job.get('published_at'),
                    'identity': p_job.get('identity') or p_job.get('source_url'),
                    'target_id': p_job['id'],
                    'kind': p_job.get('kind', '招聘公告'),
                    'company': p_job.get('company', ''),
                    'application_url': p_job.get('application_url'),
                    'structured': structured_ctx,
                    'previous_facts': p_job,
                    'is_probe': True,
                })

            detail_timeout = max(1, float(getattr(args, 'detail_timeout', 8) or 8))
            detail_retries = max(0, int(getattr(args, 'detail_retries', 1) or 0))
            detail_failure_limit = max(1, int(getattr(args, 'detail_failure_limit', 6) or 6))

            def read_detail(item):
                if requires_position_detail(item):
                    html = fetch(item['url'], timeout=detail_timeout, retries=detail_retries,
                                 referer=source['url'], request_stage='position_detail')
                    res = parse_sdei_position_detail(html, item, source)
                    if item.get('target_id'):
                        res['id'] = item['target_id']
                    return res
                html = item['inline_html'] if 'inline_html' in item else fetch(
                    item['url'], timeout=detail_timeout, retries=detail_retries
                )
                res = parse_detail(html, item, source)
                if item.get('target_id'):
                    res['id'] = item['target_id']
                if item.get('identity'):
                    res['identity'] = item['identity']
                if item.get('structured'):
                    res['structured'] = item['structured']
                if item.get('detail_verification'):
                    res['detail_verification'] = item['detail_verification']
                if item.get('is_probe') and item.get('previous_facts'):
                    prev = item['previous_facts']
                    if not res.get('company') and prev.get('company'):
                        res['company'] = prev['company']
                    if not res.get('application_url') and prev.get('application_url'):
                        res['application_url'] = prev['application_url']
                    if (not res.get('education') or res.get('education') == '未明确 / 见原公告') and prev.get('education') and prev.get('education') != '未明确 / 见原公告':
                        res['education'] = prev['education']
                    if not res.get('deadline') and prev.get('deadline'):
                        res['deadline'] = prev['deadline']
                        res['deadline_evidence'] = prev.get('deadline_evidence')
                        res['deadline_precision'] = prev.get('deadline_precision')
                    if not res.get('positions') and prev.get('positions'):
                        res['positions'] = list(prev['positions'])
                        res['position_count'] = prev.get('position_count')
                    if not res.get('cities') and prev.get('cities'):
                        res['cities'] = list(prev['cities'])
                        res['location_evidence'] = list(prev.get('location_evidence', []))
                    if not res.get('graduation_years') and prev.get('graduation_years'):
                        res['graduation_years'] = list(prev['graduation_years'])
                return res
            def add_list_fallback(item):
                """Keep a new list discovery visible when its detail is unavailable."""
                if requires_position_detail(item):
                    return
                identifier=item_id(item)
                if identifier in previous['jobs']:
                    return
                status['has_new_announcements'] = True
                fallback=parse_detail(
                    '<div id="zoom">详情尚未读取，请打开原公告核对岗位、工作地点与报名要求。</div>',
                    item,
                    {'id':'fallback','name':source['name']},
                )
                fallback.update(source_id=source['id'],classification_note='仅核实列表标题和发布日期；详情与资格待核对。')
                persist_job(fallback, item, verified=False)
                incoming.append(fallback)

            def record_detail_failure(item, error):
                # Transport failures do not invalidate a previously readable page.
                # Only an explicit missing page or invalid detail body hides it.
                invalid_detail = (isinstance(error, ValueError) or
                                  isinstance(error, urllib.error.HTTPError) and error.code in (404, 410))
                if requires_position_detail(item) and invalid_detail:
                    old = previous['jobs'].get(item.get('target_id') or item_id(item))
                    if old:
                        hidden = dict(old, detail_verification='failed')
                        persist_job(hidden, item, verified=False)
                        incoming.append(hidden)
                status['detail_failed'] = status.get('detail_failed', 0) + 1
                reason = str(error)[:200]
                if item.get('is_probe'):
                    status.setdefault('probe_errors',[]).append({'url':item['url'],'reason':reason})
                    if item.get('target_id') and item['target_id'] in previous['jobs']:
                        previous['jobs'][item['target_id']]['probe_attempt_at'] = now
                else:
                    status['errors'].append({'url':item['url'],'reason':reason})
                    add_list_fallback(item)
                # A disappeared historical page is isolated. Repeated 404s on
                # newly discovered URLs can instead indicate a broken adapter.
                if item.get('is_probe'):
                    return False
                return True

            def record_detail_success(future, item):
                status['detail_attempted'] = status.get('detail_attempted', 0) + 1
                try:
                    job = future.result()
                    persist_job(job, item)
                    incoming.append(job)
                    queued_by_url.pop(item['url'], None)
                    status['parsed']+=1
                    old_job = previous['jobs'].get(job['id'])
                    job_fp = compute_job_fingerprint(job)
                    job['content_fingerprint'] = job_fp
                    if not old_job:
                        status['has_new_announcements'] = True
                    else:
                        old_fp = old_job.get('content_fingerprint') or compute_job_fingerprint(old_job)
                        if job_fp != old_fp:
                            status['has_new_announcements'] = True
                    return True, False
                except Exception as error:
                    should_count = record_detail_failure(item, error)
                    return False, should_count

            def checkpoint_progress():
                completed = status.get('detail_attempted', 0) + status.get('detail_skipped', 0)
                if completed and completed % 10 == 0:
                    atomic_json(data_dir/'checkpoint.json',{'run_at':now, 'source':status,
                                'pending':list(queued_by_url.values()), 'inventory_complete':inventory_complete,
                                'inventory_ids':sorted(inventory_ids)})
                if completed and completed % 10 == 0:
                    print(source['id'],'progress',status['parsed'],'/',len(items),
                          'skipped',status.get('detail_skipped', 0),flush=True)

            # Keep at most two futures in flight.  Submitting all 99 detail
            # tasks at once would make a later circuit breaker ineffective:
            # queued futures would still wait for their network timeouts.
            pool=ThreadPoolExecutor(max_workers=2)
            pending={}
            next_index=0
            consecutive_failures=0
            circuit_reason=''

            def fill_pending():
                nonlocal next_index
                while len(pending) < 2 and next_index < len(remaining):
                    item=remaining[next_index]
                    next_index += 1
                    pending[pool.submit(read_detail,item)] = item

            fill_pending()
            try:
                while pending:
                    done,_=wait(tuple(pending),return_when=FIRST_COMPLETED)
                    for future in done:
                        item=pending.pop(future)
                        succeeded, should_count = record_detail_success(future,item)
                        if succeeded:
                            consecutive_failures=0
                        elif should_count:
                            consecutive_failures += 1
                        checkpoint_progress()
                        if consecutive_failures >= detail_failure_limit:
                            circuit_reason=f'详情连续失败 {detail_failure_limit} 次，已打开单源熔断'
                            break
                        fill_pending()
                    if circuit_reason:
                        break
            finally:
                skipped_items=[]
                running_items=[]
                if circuit_reason:
                    for future,item in list(pending.items()):
                        if future.cancel():
                            skipped_items.append(item)
                        else:
                            running_items.append((future,item))
                    skipped_items.extend(remaining[next_index:])
                pool.shutdown(wait=True,cancel_futures=True)

                # A future already running when the breaker opened is allowed
                # to finish; only queued work is skipped.
                for future,item in running_items:
                    if future.cancelled():
                        skipped_items.append(item)
                        continue
                    succeeded, should_count = record_detail_success(future,item)
                    if succeeded:
                        consecutive_failures=0
                    elif should_count:
                        consecutive_failures += 1
                    checkpoint_progress()

                if circuit_reason:
                    status['detail_skipped'] = status.get('detail_skipped', 0) + len(skipped_items)
                    skipped_probes=sum(1 for item in skipped_items if item.get('is_probe'))
                    for item in skipped_items:
                        if item.get('is_probe'):
                            if item.get('target_id') and item['target_id'] in previous['jobs']:
                                previous['jobs'][item['target_id']]['probe_attempt_at'] = now
                        else:
                            add_list_fallback(item)
                    status['errors'].append({
                        'url': source['url'],
                        'reason': f'{circuit_reason}；跳过 {len(skipped_items)} 条详情请求',
                    })
                    if skipped_probes:
                        status.setdefault('probe_errors',[]).append({
                            'url': source['url'],
                            'reason': f'{circuit_reason}；跳过 {skipped_probes} 条历史复检',
                        })
                    status['coverage'] = f'{status.get("coverage", "")}；{circuit_reason}，保留列表兜底和历史记录'
                    print(source['id'],'circuit-open',circuit_reason,'skipped',len(skipped_items),flush=True)
            if status['errors']:
                status['status']='partial'
            # A source can legitimately have no records inside the requested
            # date window even when its list reports older pages.  It was
            # read successfully; only a parser that produced no usable page
            # at all should be marked failed here.
            elif status['pages'] == 0 and not status['parsed'] and not cached and total != 0:
                status['status']='failed'
            if status['status']=='ok': status['last_success_at']=dt.datetime.now(TZ).isoformat(timespec='seconds')
            queues[source['id']] = list(queued_by_url.values())
        except Exception as e:
            err_str = str(e)
            is_blocked = (isinstance(e, collector_runtime.HostPaused) or
                          getattr(e, 'code', None) in {403, 420, 429} or
                          '403' in err_str or '420' in err_str or
                          'host paused' in err_str.lower() or 'forbidden' in err_str.lower())
            if is_blocked:
                status['status'] = 'blocked'
                cooldown = max(4 * 3600, getattr(e, 'retry_after_seconds', 0))
                if getattr(e, 'code', None) == 429:
                    cooldown = max(cooldown, collector_runtime.retry_delay(e, 0) or 0)
                # Round up so persistence cannot shorten Retry-After by a fraction.
                blocked_until = (dt.datetime.now(TZ) + dt.timedelta(seconds=cooldown + 1)).isoformat(timespec='seconds')
                status['blocked_until'] = blocked_until
                status['coverage'] = f'上游安全策略拦截(HTTP 403/420/429)；进入冷却至 {blocked_until[:19]}，保留历史记录'
                if host not in host_blocked_until or blocked_until > host_blocked_until[host]:
                    host_blocked_until[host] = blocked_until
            else:
                status['status'] = 'failed'
                status['coverage'] = f'采集器错误：{err_str[:120]}'
            diagnostic = getattr(e, 'request_diagnostic', {})
            if diagnostic:
                status['request_diagnostic'] = diagnostic
            status['errors'].append({'url':diagnostic.get('url', source['url']),
                                     'reason':err_str[:200], **({'request': diagnostic} if diagnostic else {})})
        sources[source['id']]=status
        if source.get('adapter') == 'sdei' and source.get('channel') == 'announcements' and status.get('has_new_announcements'):
            schools_with_new_announcements.add(source['school'])
        if status.get('total_items') is None and 'total_items' in prior_source:
            status['total_items'] = prior_source['total_items']
        if status.get('list_complete') is None and 'list_complete' in prior_source:
            status['list_complete'] = prior_source['list_complete']
        status['elapsed_seconds'] = round(time.monotonic() - source_started, 2)
        status['pending_details'] = len(queues.get(source['id'], []))
        status['inventory_complete'] = inventory_complete if is_active_listing_source else None
        if source['id']=='nankai' and args.nankai_area:
            status['coverage']=f'省份定向列表（原站区域 {args.nankai_area}）；'+status['coverage']
        if source['id']=='offerjack' and args.target_city:
            status['coverage']=f'{args.target_city}定向列表；'+status['coverage']
        # Save completed sources so an interruption never discards earlier source progress.
        saved,_=merge(previous['jobs'],incoming,now)
        if is_active_listing_source:
            saved = reconcile_listings(saved, source['id'], inventory_ids, inventory_complete, now)
            previous['jobs'] = saved
            incoming = []
        atomic_json(path,{'jobs':saved,'sources':sources,'last_run_at':now,'pending':queues})
        print(source['id'],status['status'],status['pages'],status['parsed'],flush=True)
    now=dt.datetime.now(TZ).isoformat(timespec='seconds')
    jobs,changes=merge(previous['jobs'],incoming,now)
    new_count = len(set(jobs) - set(initial_jobs))
    changed_count = sum(j.get('content_fingerprint') != initial_jobs[key].get('content_fingerprint') or
                        j.get('listing_status') != initial_jobs[key].get('listing_status')
                        for key,j in jobs.items() if key in initial_jobs)
    changes = {'new':new_count, 'changed':changed_count, 'unchanged':len(jobs)-new_count-changed_count}
    state={'jobs':jobs,'sources':sources,'last_run_at':now,'pending':queues}
    atomic_json(path,state)
    if not getattr(args, 'state_only', False):
        export_snapshot(state,public_dir,args.days,changes)
    print(json.dumps({'total':len(jobs),'changes':changes},ensure_ascii=False),flush=True)
    return 0 if all(s['status'] in {'ok', 'deferred', 'blocked'} for s in sources.values() if not source_filter or s['id'] in source_filter) else 2


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--pages',type=int,default=100)
    parser.add_argument('--rate-state',default='',help='shared host scheduler SQLite path for CI source workers')
    parser.add_argument('--days',type=int,default=120)
    parser.add_argument('--history-days',type=int,choices=range(1,366),default=180,metavar='1..365',help='rolling historical window for resumable sources; same page budget')
    parser.add_argument('--sources',default='',help='comma-separated source ids; omitted sources retain previous state')
    parser.add_argument('--state-only',action='store_true',help='save raw source results without rebuilding public assets')
    parser.add_argument('--source-pack',choices=sorted(SOURCE_PACKS),default='',help='collect one predefined CI source pack')
    parser.add_argument('--refresh-hours',type=int,default=24,help='reuse recently verified details; 0 forces refresh')
    parser.add_argument('--nankai-area',type=int,default=0,help='optional original-site region filter; 15 is Shandong')
    parser.add_argument('--target-city',default='',help='optional city filter on public structured supplemental source')
    parser.add_argument('--offerjack-pages',type=int,default=0,help='OfferJack pages per city query; 0 keeps reading until the public endpoint stops or authentication is required')
    parser.add_argument('--data-dir',default=os.environ.get('JOB_RADAR_DATA_DIR',''),help='state/checkpoint directory; defaults to ./data')
    parser.add_argument('--public-dir',default=os.environ.get('JOB_RADAR_PUBLIC_DIR',''),help='generated snapshot directory; defaults to ./public')
    parser.add_argument('--probe-budget',type=int,default=10,help='maximum number of active historical announcements to probe/re-check per source')
    parser.add_argument('--detail-timeout',type=float,default=8,help='network timeout in seconds for individual detail pages')
    parser.add_argument('--detail-retries',type=int,default=1,help='number of retries for an individual detail page')
    parser.add_argument('--detail-failure-limit',type=int,default=6,help='open a source circuit after this many consecutive detail failures')
    parser.add_argument('--sdei-group',type=int,default=None,help='override SDEI rotation group index (0..3)')
    parser.add_argument('--deep-scan',dest='deep_scan',default=None,action='store_true',help='bypass safe early exit and scan all rotation groups and positions')
    parser.add_argument('--force-positions',action='store_true',help='compatibility flag; active schools now scan position lists independently')
    args=parser.parse_args()
    if not 1<=args.pages<=500 or not 1<=args.days<=365: parser.error('pages 1..500; days 1..365')
    if not 0<=args.offerjack_pages<=1000: parser.error('offerjack-pages 0..1000')
    if set(filter(None,args.sources.split(',')))-{s['id'] for s in SOURCES}: parser.error('unknown source id')
    data_dir=Path(args.data_dir or (ROOT/'data')).expanduser()
    data_dir.mkdir(parents=True,exist_ok=True)
    # Atomic lock creation prevents simultaneous local/CI writers.
    lock=data_dir/'collect.lock'
    try: fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY)
    except FileExistsError: raise SystemExit('collector already running; inspect stale lock before removing')
    try:
        os.close(fd)
        raise SystemExit(run(args))
    finally: lock.unlink(missing_ok=True)
