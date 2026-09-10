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
SOURCES = [
    {'id': 'nankai', 'name': '南开大学就业网', 'url': 'https://career.nankai.edu.cn/correcruit/index.html'},
    {'id': 'jinan', 'name': '济南市政府 · 求职招聘', 'url': 'https://www.jinan.gov.cn/zt/2025nzt/yhyshj/rcbf/qzzp/index.html'},
    {'id': 'sdu', 'name': '山东大学就业信息网', 'url': 'https://jobcareer.sdu.edu.cn/eweb/jygl/index.so?modcode=null&subsyscode=zpfw&type=ssoSearchZxzp&xxlb=5100'},
    {'id': 'hrss', 'name': '济南市人社局 · 事业单位招聘', 'url': 'https://jnhrss.jinan.gov.cn/col/col18625/index.html'},
    {'id': 'gzw', 'name': '济南市国资委 · 国企招聘', 'url': 'https://jngzw.jinan.gov.cn/col/col23870/index.html'},
]
for school,name in [('jobsdufe','山东财经大学'),('ujn','济南大学'),('sdut','山东理工大学'),('qlu','齐鲁工业大学')]:
    for channel,label in [('announcements','招聘公告'),('positions','具体岗位')]:
        SOURCES.append({'id':f'{school}-{channel}','name':f'{name} · {label}',
                        'url':f'https://school.gxjy.sdei.edu.cn/{school}/front/JiuYeInfo?type='+('zwxx' if channel=='positions' else 'zpgg'),
                        'adapter':'sdei','school':school,'channel':channel})
SOURCES.append({'id':'wondercv','name':'超级简历 · 公开校招线索','url':'https://www.wondercv.com/xiaozhao/','adapter':'wondercv'})
SOURCES.append({'id':'offerjack','name':'Jacky学长校招 · 公开招聘线索','url':'https://www.offerjack.cn/','adapter':'offerjack'})
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


def clean(value):
    return '\n'.join(re.sub(r'\s+', ' ', s).strip() for s in value.splitlines() if s.strip())


def safe_url(value, base, keep_fragment=False):
    url = urllib.parse.urljoin(base, value.strip())
    p = urllib.parse.urlsplit(url)
    return urllib.parse.urlunsplit((p.scheme,p.netloc,p.path,p.query,p.fragment if keep_fragment else '')) if p.scheme in {'http','https'} and p.netloc else None


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
            title=(row.get('companyName') or '招聘单位见原页面')+' · '+(row.get('jobsort2') or '招聘岗位')
            url=base+'school/companyissueinfo/edit1/'+str(row['comid'])
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


def offerjack_list(page, city=''):
    params={'pageNum':page,'pageSize':20}
    if city: params['workLocation']=city
    payload=json.loads(fetch('https://www.offerjack.cn/api/offer/page?'+urllib.parse.urlencode(params)))
    if payload.get('code')!=0 or not isinstance(payload.get('data',{}).get('records'),list):
        raise ValueError('public recruitment list unavailable; no authenticated fallback')
    items=[]
    for row in payload['data']['records']:
        values=[('企业',row.get('enterpriseName')),('工作地点',row.get('workLocation')),('招聘批次',row.get('recruitmentBatch')),
                ('毕业届别与学历',row.get('graduationYear')),('招聘岗位',row.get('position')),('企业性质',row.get('enterpriseNature')),
                ('所属行业',row.get('industry')),('报名截止',row.get('deadline'))]
        body=''.join('<p>'+html_lib.escape(f'{k}：{v}')+'</p>' for k,v in values if v)
        body+='<p>第三方公开整理的招聘线索；岗位城市和投递入口尚未通过企业原公告交叉核验。</p>'
        original=safe_url(row.get('announcementLink') or '', 'https://www.offerjack.cn/',True)
        if original: body+='<p><a href="'+html_lib.escape(original,quote=True)+'">原招聘公告（来源提供）</a></p>'
        items.append({'identity':'offerjack:'+str(row['id']), 'url':original or 'https://www.offerjack.cn/',
            'title':row['enterpriseName']+' · '+(row.get('recruitmentBatch') or '')+'招聘',
            'published_at':(row.get('updateTime') or row.get('createTime') or '')[:10] or None,
            'inline_html':'<div id="zoom">'+body+'</div>', 'structured':row})
    return items,int(payload['data']['pages'])


def deadline(text):
    candidates = []
    for line in text.splitlines():
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
    unique={v[0]:v for v in candidates}
    return next(iter(unique.values())) if len(unique)==1 else (None,None,None)


def parse_detail(html, item, source):
    root=Tree(html).root
    metas={n.attrs.get('name','').lower():n.attrs.get('content','') for n in root.find('meta')}
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
    else:
        contents=root.find(id='zoom')
        if not contents:
            raise ValueError('announcement body missing')
        body=contents[0]
        title=metas.get('articletitle') or item['title']
        company=item.get('structured',{}).get('companyname') or item.get('structured',{}).get('companyName') or item.get('structured',{}).get('enterpriseName') or ''
        published=(metas.get('pubdate') or item.get('published_at') or '')[:10] or None
    text=clean(body.text())
    if len(text)<30:
        text=(text+'\n公告文字较少或以图片展示，请打开原公告查看完整岗位与报名要求。').strip()
    combined=title+'\n'+text
    types=[]
    if source.get('adapter')=='wondercv' or re.search(r'校园招聘|校招|应届.*招聘|20\d{2}[届屆].*招聘',combined): types.append('校招')
    if re.search(r'社会招聘|社招|社会公开招聘',combined): types.append('社招')
    years=sorted(set(re.findall(r'(20\d{2})\s*[届屆]',combined)))
    years=sorted(set(years+['20'+year for year in re.findall(r'(?<!\d)(2\d)(?:届|秋招|春招)',combined)]))
    if source.get('adapter')=='offerjack':
        batch=item['structured'].get('recruitmentBatch') or ''
        if re.search('社招|社会',batch): types=['社招']
        elif re.search('秋招|春招|校招|提前批',batch): types=['校招']
        # A list such as 2026/2027届 explicitly names both eligible cohorts.
        years=sorted(set(re.findall(r'20\d{2}',item['structured'].get('graduationYear') or '')))
    sectors=[label for label,pattern in [('银行',r'银行'),('国企',r'国有企业|国有独资|国有控股|央企|国企'),('事业单位',r'事业单位'),('公务员',r'公务员')] if re.search(pattern,combined)] or ['企业 / 其他']
    # City evidence comes from job-location fields/sections/tables, never a headquarters paragraph.
    location_evidence=[]
    if fields.get('工作地域'): location_evidence.append(fields['工作地域'])
    if fields.get('工作地点'): location_evidence.append('工作地点：'+fields['工作地点'])
    lines=text.splitlines()
    for index,line in enumerate(lines):
        m=re.search(r'(?:工作地点|工作城市|岗位地点|工作地域|招聘地点)[\]】 ：:\t]*(.*)',line)
        if not m: continue
        value=m[1].strip()
        if not value and index+1<len(lines): value=lines[index+1]
        if value: location_evidence.append('工作地点：'+value[:1200])
    for table in body.find('table'):
        rows=table.find('tr')
        if rows and re.search('工作地点|工作城市',rows[0].text()):
            headers=rows[0].find('td') or rows[0].find('th')
            indexes=[i for i,c in enumerate(headers) if re.search('工作地点|工作城市',c.text())]
            for row in rows[1:]:
                cells=row.find('td')
                for i in indexes:
                    if i<len(cells): location_evidence.append(clean(cells[i].text()))
    cities=[city for city in CITIES if any(city in s for s in location_evidence)]
    # Province platform supplies a standard administrative code even for district-only labels.
    code=str(item.get('structured',{}).get('workplace2') or '')
    shandong={'3701':'济南','3702':'青岛','3703':'淄博','3704':'枣庄','3705':'东营','3706':'烟台','3707':'潍坊','3708':'济宁','3709':'泰安','3710':'威海','3711':'日照','3713':'临沂','3714':'德州','3715':'聊城','3716':'滨州','3717':'菏泽'}
    if len(code)==6 and code[:4] in shandong:
        city=shandong[code[:4]]
        if city not in cities: cities.append(city)
        location_evidence.append(f"岗位工作地行政区划代码 {code}，归属{city}（来源结构化字段）")
    possible=[city for city in CITIES if city in combined and city not in cities]
    expires,expires_text,precision=deadline(text)
    application_url=None
    if fields.get('职位投递网址链接'):
        m=re.search(r'https?://[^\s<>，。；）]+',fields['职位投递网址链接'])
        if m: application_url=safe_url(m[0],item['url'],True)
    if source.get('adapter')=='offerjack' and item['structured'].get('deliveryAddress'):
        delivery=safe_url(item['structured']['deliveryAddress'],item['url'],True)
        if delivery and delivery!=item['url']: application_url=delivery
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
    return {'id':hashlib.sha256(item.get('identity',item['url']).encode()).hexdigest()[:20], 'title':title,'company':company,
            'source_id':source['id'],'source_name':source['name'],'source_url':item['url'],
            'published_at':published,'date_label':'更新' if source.get('adapter')=='offerjack' else '收录' if secondary else '发布',
            'provenance':'第三方线索' if secondary else '公开原始来源',
            'kind':item.get('kind','招聘公告'),'types':types,'graduation_years':years,
            'sectors':sectors,'directions':directions,'cities':cities,'possible_cities':possible,
            'location_evidence':location_evidence[:12],'province_possible':'山东' in combined,
            'education':fields.get('学历要求') or item.get('structured',{}).get('degreereq') or item.get('structured',{}).get('graduationYear') or '未明确 / 见原公告',
            'deadline':expires,'deadline_evidence':expires_text,'deadline_precision':precision,
            'application_url':application_url,'emails':emails,'attachments':attachments,'links':links[:20],
            'qr_attachment':bool(re.search(r'扫码|二维码',text)),
            'excerpt':text[:300],'body':text[:18000], 'classification_note':'标签根据公告文字整理；具体岗位资格请核对原文。'}


def merge(previous, incoming, now):
    result=dict(previous)
    counts={'new':0,'changed':0,'unchanged':0}
    for job in incoming:
        fingerprint=hashlib.sha256(json.dumps(job,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        old=previous.get(job['id'])
        changed=bool(old and old['fingerprint']!=fingerprint)
        row=dict(job,fingerprint=fingerprint,first_seen_at=old['first_seen_at'] if old else now,
                 updated_at=now if changed or not old else old['updated_at'],last_verified_at=now,
                 revision=old.get('revision',1)+int(changed) if old else 1)
        result[job['id']]=row
        counts['changed' if changed else 'unchanged' if old else 'new']+=1
    return result,counts


def atomic_json(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_suffix('.tmp')
    temp.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
    os.replace(temp,path)


def deduplicate(jobs):
    """Collapse exact reposts only. Preserve every source URL and differing job/location facts."""
    groups={}
    for job in sorted(jobs,key=lambda j:(j['first_seen_at'],j['id'])):
        # Identical titles alone are insufficient: different branches and roles must survive.
        text=re.sub(r'\s+','',job['body'])
        key=(re.sub(r'\s+','',job['title']),job['kind'],tuple(sorted(job['cities'])),text)
        if len(text)<60: key=key+(job['id'],)
        if key not in groups:
            groups[key]=dict(job,duplicate_sources=[],duplicate_ids=[])
        else:
            groups[key]['duplicate_sources'].append({'title':job['source_name'],'url':job['source_url']})
            groups[key]['duplicate_ids'].append(job['id'])
    return list(groups.values())


def public_record(job):
    """Recompute derived location labels from retained text, without advancing verification time."""
    row={k:v for k,v in job.items() if k!='fingerprint'}
    label=r'(?:工作地点|工作城市|岗位地点|工作地域|招聘地点)'
    # Preserve structured regions, table cells and district-code evidence; re-read text sections.
    evidence=[s for s in row.get('location_evidence',[]) if not re.match(label,s)]
    lines=row['body'].splitlines()
    for index,line in enumerate(lines):
        m=re.search(label+r'[\]】 ：:\t]*(.*)',line)
        if m:
            value=m[1].strip() or (lines[index+1] if index+1<len(lines) else '')
            if value: evidence.append('工作地点：'+value[:1200])
    # Some structured location fields do not appear in body; retain their first value line.
    for old in row.get('location_evidence',[]):
        if re.match(label,old):
            parts=old.splitlines()
            value=re.sub('^'+label+r'[\]】 ：:\t]*','',parts[0]).strip()
            if not value and len(parts)>1: value=parts[1]
            if value: evidence.append('工作地点：'+value)
    row['location_evidence']=list(dict.fromkeys(evidence))
    row['cities']=[city for city in CITIES if any(city in s for s in evidence)]
    if row['source_id']=='wondercv':
        row['types']=list(dict.fromkeys(row['types']+['校招']))
        combined=row['title']+'\n'+row['body']
        row['graduation_years']=sorted(set(row['graduation_years']+['20'+y for y in re.findall(r'(?<!\d)(2\d)(?:届|秋招|春招)',combined)]))
        if not row.get('deadline'):
            row['deadline'],row['deadline_evidence'],row['deadline_precision']=deadline(row['body'])
    return row


def run(args):
    path=ROOT/'data/state.json'
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
            first=fetch(source['url']) if source.get('adapter') not in {'sdei','offerjack'} else ''
            if not source.get('adapter') and source['id'] not in {'nankai','sdu'}: query,endpoint=gov_query(first)
            known=set()
            items=[]
            for page in range(1,args.pages+1):
                if source.get('adapter')=='offerjack':
                    found,total=offerjack_list(page,args.target_city)
                elif source.get('adapter')=='sdei':
                    found,total=sdei_list(source,page)
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
                if page==1 and not found and total!=0: raise ValueError('no announcement links; parser or source may have changed')
                repeated=bool(found) and all(i.get('identity',i['url']) in known for i in found)
                if repeated: raise ValueError('pagination repeated; coverage incomplete')
                for item in found:
                    if item.get('identity',item['url']) not in known:
                        known.add(item.get('identity',item['url']))
                        if not item['published_at'] or item['published_at']>=cutoff: items.append(item)
                if page>=total:
                    status['coverage']='已读至来源列表末页（保留所选时间范围）'
                    break
                if found and all(i['published_at'] and i['published_at']<cutoff for i in found):
                    status['coverage']=f'已读至 {args.days} 天前；更早公告未读取'
                    break
            else:
                status['coverage']=f'最近 {args.pages} 页；仍有更早公告未读取'
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
            def read_detail(item):
                return parse_detail(item['inline_html'] if 'inline_html' in item else fetch(item['url']),item,source)
            # Bounded to two concurrent requests per source; retain progress on disk.
            with ThreadPoolExecutor(max_workers=2) as pool:
                pending={pool.submit(read_detail,item):item for item in remaining}
                for future in as_completed(pending):
                    item=pending[future]
                    try:
                        incoming.append(future.result())
                        status['parsed']+=1
                    except Exception as e:
                        status['errors'].append({'url':item['url'],'reason':str(e)[:200]})
                        # Keep verified list discoveries when external detail templates are unsupported.
                        # Never replace a previously parsed record with a weaker fallback.
                        identifier=hashlib.sha256(item.get('identity',item['url']).encode()).hexdigest()[:20]
                        if identifier not in previous['jobs']:
                            fallback=parse_detail('<div id="zoom">详情尚未读取，请打开原公告核对岗位、工作地点与报名要求。</div>',item,{'id':'fallback','name':source['name']})
                            fallback.update(source_id=source['id'],classification_note='仅核实列表标题和发布日期；详情与资格待核对。')
                            incoming.append(fallback)
                    if (status['parsed']+len(status['errors']))%25==0:
                        atomic_json(ROOT/'data/checkpoint.json',{'run_at':now,'incoming':incoming,'source':status})
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
    public_jobs=[]
    for job in jobs.values():
        row=public_record(job)
        public_jobs.append(row)
    public_jobs=deduplicate(public_jobs)
    snapshot={'schema_version':1,'generated_at':now,'last_success_at':max((j['last_verified_at'] for j in jobs.values()),default=None),'schedule_enabled':False,
              'raw_records':len(jobs),'duplicates_merged':len(jobs)-len(public_jobs),
              'coverage_days':args.days,'cities':CITIES,'jobs':sorted(public_jobs,key=lambda j:j['published_at'] or '',reverse=True),
              'sources':list(sources.values()),'changes':changes}
    atomic_json(ROOT/'public/jobs.json',snapshot)
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
    args=parser.parse_args()
    if not 1<=args.pages<=500 or not 1<=args.days<=365: parser.error('pages 1..500; days 1..365')
    if set(filter(None,args.sources.split(',')))-{s['id'] for s in SOURCES}: parser.error('unknown source id')
    ROOT.joinpath('data').mkdir(exist_ok=True)
    # Atomic lock creation prevents simultaneous local/CI writers.
    lock=ROOT/'data/collect.lock'
    try: fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY)
    except FileExistsError: raise SystemExit('collector already running; inspect stale lock before removing')
    try:
        os.close(fd)
        raise SystemExit(run(args))
    finally: lock.unlink(missing_ok=True)
