"""Bounded, repeatable announcement collection. No login or application submission.

python scripts/collect.py --pages 8 --days 30
Source failures preserve old records and their last successful verification.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
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

ROOT = Path(__file__).resolve().parents[1]
TZ = dt.timezone(dt.timedelta(hours=8))
CITIES = '济南 青岛 淄博 枣庄 东营 烟台 潍坊 济宁 泰安 威海 日照 临沂 德州 聊城 滨州 菏泽 北京 天津 上海 重庆 南京 苏州 杭州 宁波 合肥 福州 厦门 广州 深圳 珠海 东莞 佛山 武汉 长沙 郑州 西安 成都 昆明 贵阳 南昌 南宁 海口 太原 石家庄 沈阳 大连 长春 哈尔滨 兰州 西宁 银川 乌鲁木齐 拉萨'.split()
LOCATION_LABEL = r'(?:工作地点|工作城市|岗位地点|工作地域|招聘地点|招聘机构|工作区域|意向工作地|意向城市|工作地|招聘城市|所属分行|所属分公司)'
PROVINCES_LIST = '北京 天津 上海 重庆 河北 山西 辽宁 吉林 黑龙江 江苏 浙江 安徽 福建 江西 山东 河南 湖北 湖南 广东 广西 海南 四川 贵州 云南 陕西 甘肃 青海 宁夏 新疆 内蒙古 西藏 香港 澳门 台湾'.split()

try:
    from parse_positions import extract_all_positions, enrich_job_with_positions, deduplicate_positions
except ImportError:
    try:
        from scripts.parse_positions import extract_all_positions, enrich_job_with_positions, deduplicate_positions
    except ImportError:
        def extract_all_positions(html, **kw): return []
        def enrich_job_with_positions(job, positions): return job
        def deduplicate_positions(positions): return positions


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

    for province in PROVINCES_LIST:
        if re.search(rf'{province}(?:省)?(?:分行|分公司|分院|管辖行)', name_scope):
            evidence.append(f'工作地点：{province}省各分支机构（标题/单位明确机构）')

    return list(dict.fromkeys(evidence))

SOURCES = [
    {'id': 'nankai', 'name': '南开大学就业网', 'url': 'https://career.nankai.edu.cn/correcruit/index.html'},
    {'id': 'jinan', 'name': '济南市政府 · 求职招聘', 'url': 'https://www.jinan.gov.cn/zt/2025nzt/yhyshj/rcbf/qzzp/index.html'},
    {'id': 'sdu', 'name': '山东大学就业信息网', 'url': 'https://jobcareer.sdu.edu.cn/eweb/jygl/index.so?modcode=null&subsyscode=zpfw&type=ssoSearchZxzp&xxlb=5100'},
    {'id': 'hrss', 'name': '济南市人社局 · 事业单位招聘', 'url': 'https://jnhrss.jinan.gov.cn/col/col18625/index.html'},
    {'id': 'gzw', 'name': '济南市国资委 · 国企招聘', 'url': 'https://jngzw.jinan.gov.cn/col/col23870/index.html'},
]
SDEI_SCHOOLS = [
    ('jobsdufe', '山东财经大学'), ('ujn', '济南大学'), ('sdut', '山东理工大学'), ('qlu', '齐鲁工业大学'),
    ('sdnu', '山东师范大学'), ('sdsmu', '山东第二医科大学'), ('qust', '青岛科技大学'), ('qdu', '青岛大学'),
    ('ytu', '烟台大学'), ('ldu', '鲁东大学'), ('sdfmu', '山东第一医科大学'),
    ('bzmc', '滨州医学院'), ('lcu', '聊城大学'), ('lyu', '临沂大学'),
    ('sdtbu', '山东工商学院'), ('dzu', '德州学院'), ('sdua', '山东农业工程学院'),
]
for school, name in SDEI_SCHOOLS:
    for channel, label in [('announcements', '招聘公告'), ('positions', '具体岗位')]:
        SOURCES.append({'id': f'{school}-{channel}', 'name': f'{name} · {label}',
                        'url': f'https://school.gxjy.sdei.edu.cn/{school}/front/JiuYeInfo?type=' + ('zwxx' if channel == 'positions' else 'zpgg'),
                        'adapter': 'sdei', 'school': school, 'channel': channel})
SOURCES.append({'id': 'upc', 'name': '中国石油大学（华东）就业网', 'url': 'https://career.upc.edu.cn/career/zpxx/zpxx', 'adapter': 'upc'})
SOURCES.append({'id': 'qdhrss', 'name': '青岛市人社局 · 招聘与引才', 'url': 'https://hrss.qingdao.gov.cn/zxzx_47/tzgg_47/', 'adapter': 'qdhrss'})
SOURCES.append({'id': 'wondercv', 'name': '超级简历 · 公开校招线索', 'url': 'https://www.wondercv.com/xiaozhao/', 'adapter': 'wondercv'})
SOURCES.append({'id': 'offerjack', 'name': 'Jacky学长校招 · 公开招聘线索', 'url': 'https://www.offerjack.cn/', 'adapter': 'offerjack'})
VOID = {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}


def connect_ipv4_first(address, timeout=socket._GLOBAL_DEFAULT_TIMEOUT, source_address=None):
    """Prefer reachable IPv4 on dual-stack hosts, retain IPv6 fallback and TLS checks."""
    host,port=address
    candidates=socket.getaddrinfo(host,port,0,socket.SOCK_STREAM)
    candidates.sort(key=lambda row: row[0]!=socket.AF_INET)
    error=None
    for family,kind,proto,_,sockaddr in candidates:
        sock=socket.socket(family,kind,proto)
        try:
            if timeout is not socket._GLOBAL_DEFAULT_TIMEOUT: sock.settimeout(timeout)
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


def fetch(url, form=None):
    # Per-process, sequential traffic; two tries, no TLS weakening or login bypass.
    for attempt in range(2):
        try:
            time.sleep(0.3)
            req = urllib.request.Request(url, data=urllib.parse.urlencode(form).encode() if form is not None else None,
                headers={'User-Agent':'JobOpportunityReader/0.1', 'Accept':'text/html,application/json',
                         **({'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'} if form is not None else {})})
            with OPENER.open(req, timeout=18) as r:
                raw = r.read(3_000_001)
                charset = r.headers.get_content_charset() or 'utf-8'
            if len(raw) > 3_000_000:
                raise ValueError('response exceeds size limit')
            return raw.decode(charset)
        except Exception:
            if attempt:
                raise
            time.sleep(1)


def fetch_bytes(url, max_size=3_500_000, timeout=6):
    """Safely fetch raw binary content for Excel/PDF attachments with strict timeout and size limits."""
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'JobOpportunityReader/0.1'})
        with OPENER.open(req, timeout=timeout) as r:
            raw = r.read(max_size + 1)
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


def gov_list(html, base):
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
    return items, max(1,(count+rows-1)//rows)


def sdu_list(html, base):
    root=Tree(html).root
    items=[]
    for a in root.find('a',cls='omit'):
        match=re.search(r"viewZpxx\('([^']+)'",a.attrs.get('onclick',''))
        if not match: continue
        row=a.parent.parent
        date=re.search(r'20\d{2}-\d{2}-\d{2}',row.text()) if row else None
        url=urllib.parse.urljoin(base,'/eweb/jygl/index.so?')+urllib.parse.urlencode({'modcode':'jygl_zpxxck','subsyscode':'zpfw','rklx':'jyw','lmxhV':'0402','type':'ssoZxzpView','id':match[1]})
        items.append({'url':url,'title':clean(a.text()),'published_at':date[0] if date else None})
    next_links=[safe_url(a.attrs.get('href',''),base) for a in root.find('a') if 'pageMethod=next' in a.attrs.get('href','')]
    return items, next_links[0] if next_links else None


def sdei_list(source, page):
    base=f"https://school.gxjy.sdei.edu.cn/{source['school']}/"
    positions=source['channel']=='positions'
    params={'pageNum':page,'pageSize':20}
    url=base+('school/companyissueinfo/list1' if positions else 'front/indexZpggList')
    payload=json.loads(fetch(url,params) if positions else fetch(url+'?'+urllib.parse.urlencode(params)))
    if not isinstance(payload.get('rows'),list) or 'total' not in payload:
        raise ValueError('public list response missing rows/total')
    items=[]
    for row in payload['rows']:
        if positions:
            company=(row.get('companyName') or row.get('companyname') or row.get('unitName') or
                     row.get('orgName') or '招聘单位见原页面')
            role=row.get('jobsort2') or row.get('jobName') or '招聘岗位'
            title=str(company)+' · '+str(role)
            comid=row.get('comid') or row.get('id')
            if not comid: raise ValueError('position row missing company id')
            url=base+'school/companyissueinfo/edit1/'+str(comid)
            values=[('工作地点',row.get('areaString')),('学历要求',row.get('degreereq')),('专业要求',row.get('specialty')),
                    ('薪资',row.get('basewage')),('招聘人数',row.get('requestnum')),('岗位职责',row.get('jobdescribe')),
                    ('任职要求',row.get('workexp')),('报名截止',row.get('endtime'))]
            body=''.join('<p>'+html_lib.escape(f'{key}：{value}')+'</p>' for key,value in values if value is not None)
            published=(row.get('starttime') or row.get('createtime') or '')[:10] or None
        else:
            title=row['gonggaoTitle']
            url=base+'jiuye/zhaopingg/detail/'+str(row['gonggaoId'])
            body=row.get('gonggaoContent') or ''
            published=(row.get('checkTime') or row.get('createTime') or '')[:10] or None
        items.append({'url':url,'title':title,'published_at':published,'inline_html':'<div id="zoom">'+body+'</div>',
                      'structured':row,'kind':'具体岗位' if positions else '招聘公告'})
    return items,(int(payload['total'])+19)//20


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
        if not re.search(r'报名时间|报名截止|投递截止|网申截止|报名日期|招聘截止日期|截止时间',line):
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
    for m in re.finditer(r'(?<!\d)(20\d{2})\s*(?:[届屆]|应届|年度(?:校园招聘)?|年应届|年(?:高校)?毕业)', text):
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
    if not row.get('application_url') and len(set(application))==1:
        row['application_url']=application[0]
    row['emails']=list(dict.fromkeys(emails))
    return row


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
        company=structured.get('dwmc') or ''
        published=item.get('published_at')
    elif source.get('adapter')=='qdhrss':
        contents=root.find(cls='wencon') or root.find(cls='article') or root.find(id='zoom')
        body=contents[0] if contents else root
        title=metas.get('articletitle') or item['title']
        company='青岛市人社局'
        published=(metas.get('pubdate') or item.get('published_at') or '')[:10] or None
    else:
        contents=root.find(id='zoom')
        if not contents:
            raise ValueError('announcement body missing')
        body=contents[0]
        title=metas.get('articletitle') or item['title']
        company=structured.get('companyname') or structured.get('companyName') or structured.get('enterpriseName') or ''
        published=(metas.get('pubdate') or item.get('published_at') or '')[:10] or None
    text=clean(body.text())
    if len(text)<30:
        text=(text+'\n公告文字较少或以图片展示，请打开原公告查看完整岗位与报名要求。').strip()
    combined=title+'\n'+text
    types=[]
    if source.get('adapter')=='wondercv' or re.search(r'校园招聘|校招|应届.*招聘|20\d{2}[届屆].*招聘',combined): types.append('校招')
    if re.search(r'社会招聘|社招|社会公开招聘',combined): types.append('社招')
    years=extract_graduation_years(combined)
    if source.get('adapter')=='offerjack':
        batch=structured.get('recruitmentBatch') or ''
        if re.search('社招|社会',batch): types=['社招']
        elif re.search('秋招|春招|校招|提前批',batch): types=['校招']
        # A list such as 2026/2027届 explicitly names both eligible cohorts.
        structured_years=[y for y in re.findall(r'20\d{2}',structured.get('graduationYear') or '') if VALID_GRADUATION_YEAR_MIN <= int(y) <= VALID_GRADUATION_YEAR_MAX]
        years=sorted(set(years+structured_years))
    sectors=[label for label,pattern in [('银行',r'银行'),('国企',r'国有企业|国有独资|国有控股|央企|国企'),('事业单位',r'事业单位'),('公务员',r'公务员')] if re.search(pattern,combined)] or ['企业 / 其他']
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
    if source.get('adapter')=='upc' and structured.get('dwwz'):
        website=safe_url(structured['dwwz'],item['url'],True)
        if website and website!=item['url'] and re.search(r'job|career|campus|apply|hr|zhaopin|hire|recruit|zp', website, re.I):
            application_url=website
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
    # Explicit recruitment URL text only; other links remain reference links.
    if not application_url:
        m=re.search(r'(?:报名网址|投递网址|网申地址|招聘官网)[：:\s（(]*?(https?://[^\s<>，。；）)]+)',text)
        if m: application_url=safe_url(m[1],item['url'],True)
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
            'education':fields.get('学历要求') or structured.get('degreereq') or structured.get('graduationYear') or '未明确 / 见原公告',
            'deadline':expires,'deadline_evidence':expires_text,'deadline_precision':precision,
            'application_url':application_url,'emails':emails,'attachments':attachments,'links':links[:20],
            'qr_attachment':bool(re.search(r'扫码|二维码',text)),
            'excerpt':text[:300],'body':text[:18000], 'classification_note':'标签根据公告文字整理；具体岗位资格请核对原文。'})
    return enrich_job_with_positions(raw_job, positions)


def compute_lifecycle_stage(job, now_str):
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
        detected_event = None

        # 1. Deadline extension
        old_dl = old.get('deadline') or ''
        new_dl = job.get('deadline') or ''
        if old_dl and new_dl and new_dl > old_dl:
            detail = f'报名截止时间延长至 {new_dl}（原截止时间：{old_dl}）'
            detected_event = {
                'date': today,
                'timestamp': now,
                'type': 'deadline_extended',
                'title': '截止延期',
                'detail': detail,
            }
            recent_change = {'type': 'deadline_extended', 'label': '截止延期', 'date': today, 'detail': detail}

        # 2. Position updates
        old_pc = old.get('position_count') or 0
        new_pc = job.get('position_count') or 0
        old_majors = set(old.get('majors') or [])
        new_majors = set(job.get('majors') or [])
        if not detected_event and (new_pc != old_pc or (new_majors - old_majors)):
            added = list(new_majors - old_majors)[:3]
            major_text = f"，新增专业：{'、'.join(added)}" if added else ''
            detail = f'岗位需求变动为 {new_pc} 个职位{major_text}'
            detected_event = {
                'date': today,
                'timestamp': now,
                'type': 'positions_updated',
                'title': '岗位表更新',
                'detail': detail,
            }
            recent_change = {'type': 'positions_updated', 'label': '岗位表更新', 'date': today, 'detail': detail}

        # 3. Supplemental
        old_supp = bool(re.search(r'补录|补招|追加|第[二两三]批|续聘', old.get('title', '')))
        new_supp = bool(re.search(r'补录|补招|追加|第[二两三]批|续聘', job.get('title', '')))
        if not detected_event and (new_supp and not old_supp):
            detail = '招聘变更为补录 / 追加招聘批次'
            detected_event = {
                'date': today,
                'timestamp': now,
                'type': 'supplemental',
                'title': '补录招募启动',
                'detail': detail,
            }
            recent_change = {'type': 'supplemental', 'label': '补录招募', 'date': today, 'detail': detail}

        # 4. Selection stage
        old_sel = bool(re.search(r'笔试|面试|初试|复试|录用名单|拟录用|公示', old.get('title', '')))
        new_sel = bool(re.search(r'笔试|面试|初试|复试|录用名单|拟录用|公示', job.get('title', '')))
        if not detected_event and (new_sel and not old_sel):
            detail = '发布笔试/面试或录用公示通知'
            detected_event = {
                'date': today,
                'timestamp': now,
                'type': 'selection_stage',
                'title': '考核选拔进展',
                'detail': detail,
            }
            recent_change = {'type': 'selection_stage', 'label': '考核进展', 'date': today, 'detail': detail}

        # 5. General content update
        if not detected_event:
            detail = '招聘公告正文或附件内容已同步最新变动'
            detected_event = {
                'date': today,
                'timestamp': now,
                'type': 'content_updated',
                'title': '信息更新',
                'detail': detail,
            }
            recent_change = {'type': 'content_updated', 'label': '内容更新', 'date': today, 'detail': detail}

        if detected_event:
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


def merge(previous, incoming, now):
    result=dict(previous)
    counts={'new':0,'changed':0,'unchanged':0}
    for job in incoming:
        fingerprint=hashlib.sha256(json.dumps(job,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        old=previous.get(job['id'])
        changed=bool(old and old['fingerprint']!=fingerprint)
        timeline, recent_change = detect_job_events(job, old, now, changed)
        stage = compute_lifecycle_stage({**job, 'recent_change': recent_change}, now)
        row=dict(job,fingerprint=fingerprint,first_seen_at=old['first_seen_at'] if old else now,
                 updated_at=now if changed or not old else old['updated_at'],last_verified_at=now,
                 revision=old.get('revision',1)+int(changed) if old else 1,
                 timeline=timeline, recent_change=recent_change, lifecycle_stage=stage)
        result[job['id']]=row
        counts['changed' if changed else 'unchanged' if old else 'new']+=1
    return result,counts


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
    c = re.sub(r'(?:有限责任公司|股份有限公司|有限公司|集团有限公司|集团)$', '', c)
    return c.strip()


def normalize_title_core(title):
    if not title:
        return ''
    t = re.sub(r'\s+', '', title).translate(str.maketrans('（）', '()'))
    t = re.sub(r'^[【\[\(（][^】\]\)）]{1,20}[】\]\)）]', '', t)
    t = re.sub(r'(?:校园招聘(?:简章|公告|启事)?|招聘(?:简章|公告|启事|信息)?|简章|公告|启事|专场)$', '', t)
    return t.strip()


def deduplicate(jobs):
    """Collapse same-opportunity reposts and cross-channel listings.
    Preserve every source URL, application URLs, and differing job/location facts.
    """
    groups = {}
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
            title_cohorts = re.findall(r'(20\d{2})\s*届', job.get('title', ''))
            cohorts = tuple(sorted(set(title_cohorts or job.get('graduation_years', []))))
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

        if key not in groups:
            groups[key] = dict(job, duplicate_sources=[], duplicate_ids=[])
        else:
            parent = groups[key]
            existing_urls = {parent.get('source_url')} | {s.get('url') for s in parent['duplicate_sources']}
            duplicate_facts = {
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
                'body': job.get('body'),
                'excerpt': job.get('excerpt'),
            }
            parent['duplicate_sources'].append({
                'id': job['id'],
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
                    if new_p > curr_p:
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
        'positions',
    }
    row={k:v for k,v in job.items() if k not in heavy}
    if 'timeline' in row and isinstance(row['timeline'], list) and len(row['timeline']) > 5:
        row['timeline'] = row['timeline'][-5:]
    if 'duplicate_sources' in row and isinstance(row['duplicate_sources'], list):
        cleaned_sources = []
        for s in row['duplicate_sources']:
            s_clean = dict(s)
            if 'facts' in s_clean and isinstance(s_clean['facts'], dict):
                s_clean['facts'] = {fk: fv for fk, fv in s_clean['facts'].items() if fk not in {'positions', 'body'}}
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
    jobs=state['jobs']
    public_jobs=sorted(deduplicate([public_record(j) for j in jobs.values()]),
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
              'schedule_enabled':schedule_enabled(),'raw_records':len(jobs),
              'duplicates_merged':len(jobs)-len(public_jobs),'coverage_days':days,'cities':CITIES,
              'detail_shards':detail_shards,'search_url':search_url,
              'jobs':[public_summary(j) for j in public_jobs],
              'sources':list(state['sources'].values()),'changes':changes or {}}
    atomic_json(public_dir/'jobs.json',snapshot,pretty=False)
    return snapshot


def run(args):
    data_dir=Path(getattr(args,'data_dir','') or (ROOT/'data')).expanduser()
    data_dir.mkdir(parents=True,exist_ok=True)
    public_dir=Path(getattr(args,'public_dir','') or (ROOT/'public')).expanduser()
    public_dir.mkdir(parents=True,exist_ok=True)
    path=data_dir/'state.json'
    previous=json.loads(path.read_text(encoding='utf-8')) if path.exists() else {'jobs':{},'sources':{}}
    now=dt.datetime.now(TZ).isoformat(timespec='seconds')
    cutoff=(dt.datetime.now(TZ)-dt.timedelta(days=args.days)).date().isoformat()
    incoming=[]
    sources=dict(previous['sources'])
    for source in SOURCES:
        if args.sources and source['id'] not in args.sources.split(','): continue
        source=dict(source)
        if source['id']=='nankai' and args.nankai_area:
            source['url']=f'https://career.nankai.edu.cn/correcruit/index/sel_area/{args.nankai_area}.html'
        status=dict(source,last_attempt_at=now,last_success_at=previous['sources'].get(source['id'],{}).get('last_success_at'),pages=0,discovered=0,parsed=0,errors=[],status='ok',coverage='近期分页，非全量历史')
        try:
            first=fetch(source['url']) if source.get('adapter') not in {'sdei','offerjack','upc'} else ''
            if not source.get('adapter') and source['id'] not in {'nankai','sdu'}: query,endpoint=gov_query(first)
            known=set()
            items=[]
            is_offerjack=source.get('adapter')=='offerjack'
            offerjack_cities=([args.target_city] if args.target_city else ['']+CITIES) if is_offerjack else []
            offerjack_query_limit=(getattr(args,'offerjack_pages',0) or 1000) if is_offerjack else 0
            page_budget=offerjack_query_limit*len(offerjack_cities) if is_offerjack else args.pages
            offerjack_city_index=0
            offerjack_page=1
            offerjack_limited=False
            for page in range(1,page_budget+1):
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
                    elif source.get('adapter')=='upc':
                        found,total=upc_list(page)
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
                        found,total=gov_list(html,source['url'])
                    status['pages']+=1
                    if (page_number if is_offerjack else page)==1 and not found and total!=0: raise ValueError('no announcement links; parser or source may have changed')
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
                        if not item['published_at'] or item['published_at']>=cutoff: items.append(item)
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
                    status['coverage']='已读至来源列表末页（保留所选时间范围）'
                    break
                if found and all(i['published_at'] and i['published_at']<cutoff for i in found):
                    status['coverage']=f'已读至 {args.days} 天前；更早公告未读取'
                    break
            else:
                status['coverage']=f'最近 {page_budget} 页；仍有更早公告未读取'
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
            cached=0
            remaining=[]
            for item in items:
                old=previous['jobs'].get(hashlib.sha256(item.get('identity',item['url']).encode()).hexdigest()[:20])
                if 'inline_html' not in item and old and not old.get('classification_note','').startswith('仅核实') and args.refresh_hours and old['last_verified_at']>=(dt.datetime.now(TZ)-dt.timedelta(hours=args.refresh_hours)).isoformat():
                    cached+=1
                else: remaining.append(item)
            status['cached']=cached
            # Active announcement probe: inspect historical unexpired jobs for this source that need re-verification.
            today_str=dt.datetime.now(TZ).date().isoformat()
            recent_expiry_cutoff=(dt.datetime.now(TZ).date()-dt.timedelta(days=7)).isoformat()
            probe_refresh_cutoff=(dt.datetime.now(TZ)-dt.timedelta(hours=args.refresh_hours)).isoformat() if args.refresh_hours else ''
            existing_urls={i.get('url') for i in items if i.get('url')}
            existing_ids={hashlib.sha256(i.get('identity',i['url']).encode()).hexdigest()[:20] for i in items if i.get('url')}

            probe_candidates=[]
            for j_id,old_job in previous.get('jobs',{}).items():
                if old_job.get('source_id')!=source['id']: continue
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
                remaining.append({
                    'url':p_job['source_url'],
                    'title':p_job.get('title',''),
                    'published_at':p_job.get('published_at'),
                    'identity':p_job.get('identity') or p_job.get('source_url'),
                    'target_id':p_job['id'],
                    'is_probe':True,
                })

            def read_detail(item):
                res = parse_detail(item['inline_html'] if 'inline_html' in item else fetch(item['url']),item,source)
                if item.get('target_id'):
                    res['id'] = item['target_id']
                if item.get('identity'):
                    res['identity'] = item['identity']
                return res
            # Bounded to two concurrent requests per source; retain progress on disk.
            with ThreadPoolExecutor(max_workers=2) as pool:
                pending={pool.submit(read_detail,item):item for item in remaining}
                for future in as_completed(pending):
                    item=pending[future]
                    try:
                        incoming.append(future.result())
                        status['parsed']+=1
                    except Exception as e:
                        if item.get('is_probe'):
                            status.setdefault('probe_errors',[]).append({'url':item['url'],'reason':str(e)[:200]})
                            if item.get('target_id') and item['target_id'] in previous['jobs']:
                                previous['jobs'][item['target_id']]['probe_attempt_at'] = now
                        else:
                            status['errors'].append({'url':item['url'],'reason':str(e)[:200]})
                            # Keep verified list discoveries when external detail templates are unsupported.
                            # Never replace a previously parsed record with a weaker fallback.
                            identifier=hashlib.sha256(item.get('identity',item['url']).encode()).hexdigest()[:20]
                            if identifier not in previous['jobs']:
                                fallback=parse_detail('<div id="zoom">详情尚未读取，请打开原公告核对岗位、工作地点与报名要求。</div>',item,{'id':'fallback','name':source['name']})
                                fallback.update(source_id=source['id'],classification_note='仅核实列表标题和发布日期；详情与资格待核对。')
                                incoming.append(fallback)
                    if (status['parsed']+len(status['errors']))%25==0:
                        atomic_json(data_dir/'checkpoint.json',{'run_at':now,'incoming':incoming,'source':status})
                    if (status['parsed']+len(status['errors']))%10==0:
                        print(source['id'],'progress',status['parsed'],'/',len(items),flush=True)
            if status['errors']:
                status['status']='partial'
            elif not status['parsed'] and not cached and total!=0:
                status['status']='failed'
            if status['status']=='ok': status['last_success_at']=dt.datetime.now(TZ).isoformat(timespec='seconds')
        except Exception as e:
            status['status']='failed'
            status['errors'].append({'url':source['url'],'reason':str(e)[:200]})
        sources[source['id']]=status
        if source['id']=='nankai' and args.nankai_area:
            status['coverage']=f'省份定向列表（原站区域 {args.nankai_area}）；'+status['coverage']
        if source['id']=='offerjack' and args.target_city:
            status['coverage']=f'{args.target_city}定向列表；'+status['coverage']
        # Save completed sources so an interruption never discards earlier source progress.
        saved,_=merge(previous['jobs'],incoming,now)
        atomic_json(path,{'jobs':saved,'sources':sources,'last_run_at':now})
        print(source['id'],status['status'],status['pages'],status['parsed'],flush=True)
    now=dt.datetime.now(TZ).isoformat(timespec='seconds')
    jobs,changes=merge(previous['jobs'],incoming,now)
    state={'jobs':jobs,'sources':sources,'last_run_at':now}
    atomic_json(path,state)
    export_snapshot(state,public_dir,args.days,changes)
    print(json.dumps({'total':len(jobs),'changes':changes},ensure_ascii=False),flush=True)
    return 0 if all(s['status']=='ok' for s in sources.values() if not args.sources or s['id'] in args.sources.split(',')) else 2


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--pages',type=int,default=100)
    parser.add_argument('--days',type=int,default=120)
    parser.add_argument('--sources',default='',help='comma-separated source ids; omitted sources retain previous state')
    parser.add_argument('--refresh-hours',type=int,default=24,help='reuse recently verified details; 0 forces refresh')
    parser.add_argument('--nankai-area',type=int,default=0,help='optional original-site region filter; 15 is Shandong')
    parser.add_argument('--target-city',default='',help='optional city filter on public structured supplemental source')
    parser.add_argument('--offerjack-pages',type=int,default=0,help='OfferJack pages per city query; 0 keeps reading until the public endpoint stops or authentication is required')
    parser.add_argument('--data-dir',default=os.environ.get('JOB_RADAR_DATA_DIR',''),help='state/checkpoint directory; defaults to ./data')
    parser.add_argument('--public-dir',default=os.environ.get('JOB_RADAR_PUBLIC_DIR',''),help='generated snapshot directory; defaults to ./public')
    parser.add_argument('--probe-budget',type=int,default=10,help='maximum number of active historical announcements to probe/re-check per source')
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
