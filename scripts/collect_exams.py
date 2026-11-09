"""Dedicated collector and builder for the isolated Civil Service & Public Institution (考公考编) workspace.

Generates `public/exams.json` without mixing into corporate job postings.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import sys
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import collect as c
from bs4 import BeautifulSoup
from city_registry import PROVINCE_CITIES, cities_in_text
from parse_exam_positions import (
    clean_exam_title,
    enrich_exam_record,
    parse_exam_excel_bytes,
    parse_exam_pdf_bytes,
    parse_exam_table_grid,
)
from parse_positions import _table_to_grid, parse_html_tables

ROOT = SCRIPT_DIR.parents[0]
TZ = dt.timezone(dt.timedelta(hours=8))
SHANDONG_CITIES = list(PROVINCE_CITIES.get('山东', []))

EXAM_SUBJECT_RE = re.compile(
    r'公务员|选调|事业单位|事业编|控制总量|备案制|三支一扶|文职|社区工作者|'
    r'公开招聘|公开招考|公开选聘|公开遴选|竞争性选调|招录|招考|'
    r'引进.*人才|青年人才|急需紧缺|优才|高层次人才|党政储备|公费师范|'
    r'教师.*招聘|教育系统.*招聘|教体局.*招聘|卫健.*招聘|卫生.*招聘|医院.*招聘|疾控.*招聘',
    re.I,
)

EXAM_PROGRESS_RE = re.compile(
    r'笔试|面试|资格复审|资格审查|准考证|成绩|分数线|体检|考察|递补|拟聘|拟录用|拟录取|核减',
    re.I,
)

EXAM_INCLUDE_TITLE_RE = re.compile(
    f'(?:{EXAM_SUBJECT_RE.pattern}|{EXAM_PROGRESS_RE.pattern})',
    re.I,
)

EXAM_NOISE_TITLE_RE = re.compile(
    r'劳动能力鉴定|仲裁裁决|工伤保险|失业保险|稳岗返还|技能提升补贴|一次性扩岗|'
    r'农民工工资|职业技能大赛|培训机构|培训班|新聘用人员岗前|招标公告|采购公告|磋商公告|竞争性评审|'
    r'使用说明|操作说明|宣传片|工作年度报表|行风建设|工作会议|圆满举办|成功举办|结硕果|'
    r'生活补贴|生活补助|补贴工种|发放人员名单|信息公开规定|制定办法|健康体检办法|体检标准|'
    r'考试大纲|走上训练场|面试现场|作用日趋|创业平台|外军|维护.*权益|规范文职人员|全面展开|'
    r'考察纪实|总书记|专项整治|宣讲公告|招聘推介|需求目录|编外合同制|劳务派遣|非事业编.*工勤岗|'
    r'关于做好.*工作的通知|关于做好.*有关问题的通知|关于印发|关于调整.*式样的通知|'
    r'奖励证书|收入分配|激励政策|报考指南|咨询服务电话|报名照片|202[0-4]年',
    re.I,
)

CORPORATE_COMPANY_RE = re.compile(
    r'有限公司|股份公司|有限责任公司|集团公司|银行|证券|保险|基金|期货|'
    r'科技|电子|软件|信息|网络|通信|制造|机械|重工|汽车|化工|制药|生物|医药|新材料|'
    r'地产|置业|建筑|工程|物流|商贸|贸易|餐饮|酒店|传媒|文化|服饰|纺织|食品|啤酒|轮胎',
    re.I,
)

STRICT_EXAM_TITLE_RE = re.compile(
    r'公务员|选调生|选调应届|事业单位|事业编|控制总量|人员控制总量|备案制|三支一扶|军队文职|文职人员|'
    r'公开遴选|竞争性选调|教育系统.*公开招聘|教体局.*公开招聘|教育和体育局.*公开招聘|中小学教师.*招聘|公费师范|'
    r'卫健.*公开招聘|卫生健康.*公开招聘|公立医院.*公开招聘|人民医院.*公开招聘|中医院.*公开招聘|妇幼保健.*公开招聘|'
    r'引进高层次|急需紧缺人才|青年人才引进|优才计划|名校人才直通车|党政储备人才',
    re.I,
)

ANNOUNCEMENT_ACTION_RE = re.compile(
    r'公告|简章|通知|启事|计划|方案|名单|公示|成绩|复审|审查|笔试|面试|遴选|招考|招录|选调|招募|引进|公开招聘|选聘|聘用',
    re.I,
)

NATIONAL_OR_CROSS_EXAM_RE = re.compile(
    r'中央机关|国家公务员|国考|军队文职|文职人员|全军|北部战区|南部战区|东部战区|西部战区|中部战区|'
    r'火箭军|武警|联勤保障|军事科学院|国防科技大学|'
    r'中国科学院.*山东|中国水产科学研究院黄海|中国工业互联网研究院山东|中国农业大学烟台|'
    r'部属公费师范|驻鲁|驻山东|面向山东省|'
    r'(?:^|共\d+人[！!]?)(?:陆军|海军|空军).*(?:文职|人才)',
    re.I,
)

SHANDONG_KEYWORD_RE = re.compile(
    r'山东|鲁南|鲁北|鲁中|齐鲁|胶东|(?:^|202\d年[度]?|驻济|山东省?)(?:省属|省直)|驻济|康复大学|泰山学院|莱芜|'
    + '|'.join(SHANDONG_CITIES),
    re.I,
)

OUT_OF_PROVINCE_RE = re.compile(
    r'北京|上海|天津|重庆|河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|河南|湖北|湖南|广东|海南|'
    r'四川|贵州|云南|陕西|甘肃|青海|内蒙古|广西|西藏|宁夏|新疆|兵团|草湖|'
    r'厦门|深圳|大连|宁波|武汉|长沙|广州|杭州|南京|成都|西安|长江水利',
    re.I,
)

DEDICATED_SHANDONG_SOURCES = {
    '81rc-wenzhi',
    'sd-hrss-rsks',
    'sdei-civil-exams',
    'sdei-exam-dispatch',
    'hrss',
    'qdhrss',
    'jinan-gov',
    'jinan-hrss-exam',
    'qingdao-hrss-exam',
    'zibo-hrss-exam',
    'zaozhuang-hrss-exam',
    'dongying-hrss-exam',
    'yantai-hrss-exam',
    'weifang-hrss-exam',
    'jining-hrss-exam',
    'taian-hrss-exam',
    'weihai-hrss-exam',
    'rizhao-hrss-exam',
    'linyi-hrss-exam',
    'dezhou-hrss-exam',
    'liaocheng-hrss-exam',
    'binzhou-hrss-exam',
    'heze-hrss-exam',
}

EXAM_SOURCES: List[Dict[str, Any]] = [
    # 1. 国家级统考与军队文职
    {
        'id': '81rc-wenzhi',
        'name': '军队人才网 · 军队文职公开招考',
        'url': 'http://81rc.81.cn/wzry/index.html',
        'city': '全国',
        'level': '国家级',
        'adapter': 'generic_gov',
    },
    # 2. 山东省级核心招考平台
    {
        'id': 'sd-hrss-rsks',
        'name': '山东省人社厅 · 山东人事考试信息网',
        'url': 'http://hrss.shandong.gov.cn/rsks/',
        'city': '省属/全省',
        'level': '省级',
        'adapter': 'generic_gov',
    },
    {
        'id': 'sdei-civil-exams',
        'name': '山东省大学生就业服务平台 · 招考与基层项目',
        'url': 'https://gxjy.sdei.edu.cn/JobFairs/channel?classId=99',
        'class_id': 99,
        'city': '省属/全省',
        'level': '省级',
        'adapter': 'sdei_exam_channel',
    },
    {
        'id': 'sdei-exam-dispatch',
        'name': '山东省大学生就业服务平台 · 全省事编与教师医疗招考',
        'url': 'https://gxjy.sdei.edu.cn/JobFairs/channel?classId=86',
        'class_id': 86,
        'city': '省属/全省',
        'level': '省级',
        'adapter': 'sdei_exam_channel',
    },
    # 3. 山东 16 地市人社局与人事考试中心
    {
        'id': 'jinan-hrss-exam',
        'name': '济南市人社局 · 事业单位公开招聘',
        'url': 'https://jnhrss.jinan.gov.cn/col/col18625/index.html',
        'city': '济南',
        'level': '市级',
        'adapter': 'jinan_cms_exam',
        'cms_web_id': '16',
        'cms_page_id': '18625',
        'cms_tag_id': '当前栏目标题',
        'cms_tpl_set_id': 'MAMvqpH003gztRDn5troz',
    },
    {
        'id': 'qingdao-hrss-exam',
        'name': '青岛市人社局 · 公开招聘与引才专区',
        'url': 'https://hrss.qingdao.gov.cn/zxzx_47/tzgg_47/',
        'city': '青岛',
        'level': '市级',
        'adapter': 'generic_gov',
    },
    {
        'id': 'zibo-hrss-exam',
        'name': '淄博市人社局 · 事业单位招考与引才',
        'url': 'https://hrss.zibo.gov.cn/',
        'city': '淄博',
        'level': '市级',
        'adapter': 'generic_gov',
    },
    {
        'id': 'zaozhuang-hrss-exam',
        'name': '枣庄市人社局 · 人事考试与事编招聘',
        'url': 'http://zzhrss.zaozhuang.gov.cn/',
        'city': '枣庄',
        'level': '市级',
        'adapter': 'generic_gov',
    },
    {
        'id': 'dongying-hrss-exam',
        'name': '东营市人社局 · 事业单位与人才招引',
        'url': 'http://dyhrss.dongying.gov.cn/',
        'city': '东营',
        'level': '市级',
        'adapter': 'generic_gov',
    },
    {
        'id': 'yantai-hrss-exam',
        'name': '烟台市人社局 · 事业单位公开招聘与选调',
        'url': 'https://rshj.yantai.gov.cn/',
        'city': '烟台',
        'level': '市级',
        'adapter': 'generic_gov',
    },
    {
        'id': 'weifang-hrss-exam',
        'name': '潍坊市人社局 · 人事考试与招聘公告',
        'url': 'http://rsj.weifang.gov.cn/rsjzxzx/rsjtzgg/',
        'city': '潍坊',
        'level': '市级',
        'adapter': 'generic_gov',
    },
    {
        'id': 'jining-hrss-exam',
        'name': '济宁市人社局 · 事业单位招考与名校引才',
        'url': 'https://hrss.jining.gov.cn/',
        'city': '济宁',
        'level': '市级',
        'adapter': 'generic_gov',
    },
    {
        'id': 'taian-hrss-exam',
        'name': '泰安市人社局 · 公开招聘与人事考试公告',
        'url': 'https://rsj.taian.gov.cn/col/col47929/index.html',
        'city': '泰安',
        'level': '市级',
        'adapter': 'generic_gov',
    },
    {
        'id': 'weihai-hrss-exam',
        'name': '威海市人社局 · 事业单位公开招聘专栏',
        'url': 'http://www.weihai.gov.cn/col/col74500/index.html',
        'city': '威海',
        'level': '市级',
        'adapter': 'generic_gov',
    },
    {
        'id': 'rizhao-hrss-exam',
        'name': '日照市人社局 · 事业单位与招考公示',
        'url': 'http://hrss.rizhao.gov.cn/col/col33220/index.html',
        'city': '日照',
        'level': '市级',
        'adapter': 'generic_gov',
    },
    {
        'id': 'linyi-hrss-exam',
        'name': '临沂市人社局 · 事业单位招聘与紧缺引才',
        'url': 'https://rsj.linyi.gov.cn/',
        'city': '临沂',
        'level': '市级',
        'adapter': 'generic_gov',
    },
    {
        'id': 'dezhou-hrss-exam',
        'name': '德州市人社局 · 事业单位公开招聘专栏',
        'url': 'http://hrss.dezhou.gov.cn/',
        'city': '德州',
        'level': '市级',
        'adapter': 'generic_gov',
    },
    {
        'id': 'liaocheng-hrss-exam',
        'name': '聊城市人社局 · 公开招聘与人才引育',
        'url': 'http://rsj.liaocheng.gov.cn/channel_t_190_13627/',
        'city': '聊城',
        'level': '市级',
        'adapter': 'generic_gov',
    },
    {
        'id': 'binzhou-hrss-exam',
        'name': '滨州市人社局 · 事业单位公开招聘',
        'url': 'http://rs.binzhou.gov.cn/col/col258221/index.html',
        'city': '滨州',
        'level': '市级',
        'adapter': 'generic_gov',
    },
    {
        'id': 'heze-hrss-exam',
        'name': '菏泽市人社局 · 人事考试与急需紧缺招考',
        'url': 'http://hzrsj.heze.gov.cn/col/col120190/index.html',
        'city': '菏泽',
        'level': '市级',
        'adapter': 'generic_gov',
    },
    # 4. 高校就业网官方选调生 / 人才引进 / 教育医疗事编分流池
    {
        'id': 'campus-exam-hub',
        'name': '驻鲁及重点高校就业网 · 选调生/优才/事编官方招考池',
        'url': 'https://jobcareer.sdu.edu.cn/',
        'city': '山东及全国',
        'level': '高校招考分流',
        'adapter': 'snapshot_extract',
    },
]


def is_in_shandong_or_national_scope(title: str, source_id: str = '', excerpt: str = '') -> bool:
    """Ensure exam record belongs to Shandong (provincial + 16 cities/counties) or National/Military/Selected-Graduates scope."""
    if OUT_OF_PROVINCE_RE.search(title):
        if not SHANDONG_KEYWORD_RE.search(title) and not re.search(
            r'中央机关|国家公务员|军队文职|文职人员|全军|北部战区', title
        ):
            return False
    if source_id in DEDICATED_SHANDONG_SOURCES:
        return True
    if NATIONAL_OR_CROSS_EXAM_RE.search(title):
        return True
    if SHANDONG_KEYWORD_RE.search(title):
        return True
    title_cities = cities_in_text(title, infer_counties=True)
    if any(c_name in SHANDONG_CITIES for c_name in title_cities):
        return True
    if any(w in title for w in ('这家', '这些', '这个', '这两家')) and SHANDONG_KEYWORD_RE.search(excerpt or ''):
        return True
    return False


def is_civil_exam_record(job: Dict[str, Any]) -> bool:
    """Strictly determine whether a record belongs to Civil Service & Public Institution Exams (考公考编)."""
    source_id = str(job.get('source_id') or '')
    raw_title = str(job.get('title') or '').strip()
    title = clean_exam_title(raw_title)
    company = str(job.get('company') or '').strip()
    excerpt = str(job.get('excerpt') or job.get('body') or '')[:300]
    combined = f'{title} {company}'

    if not title or len(title) < 7 or EXAM_NOISE_TITLE_RE.search(title):
        return False

    # Never include campus talks / job fairs or online single-position directory rows ("单位 · 岗位")
    if (
        job.get('kind') == '宣讲会'
        or source_id.endswith(('-talks', '-positions', '-jobs'))
        or source_id == 'sdei-jobfairs'
        or ' · ' in raw_title
    ):
        return False

    # Reject joint corporate recruitment disguised with HRSS prefix (e.g. "人社局 & 某某有限公司")
    if '&' in title and CORPORATE_COMPANY_RE.search(title):
        return False

    # Require an actual announcement/notice action word (exclude bare organization names or "XX人社局招聘")
    if not ANNOUNCEMENT_ACTION_RE.search(title) or re.fullmatch(
        r'[\u4e00-\u9fa5（）()]+(?:人力资源和社会保障局|人社局|组织部|卫健局|教育局)招聘',
        title,
    ):
        return False

    # Never include corporate Beisen/Haier/Bank/Enterprise sources
    if source_id in {'gzw', 'wondercv', 'offerjack'} or any(
        source_id.startswith(p)
        for p in ('haier', 'hisense', 'weichai', 'tsingtao', 'qilu-pharma', 'linglong', 'taiping', 'picc', 'chinalife', 'chinastock', 'boc', 'psbc')
    ):
        return False

    # Enforce geographic scope (Shandong provincial + 16 cities/counties + National/Military/Selected Graduates)
    if not is_in_shandong_or_national_scope(title, source_id=source_id, excerpt=excerpt):
        return False

    # Dedicated exam sources still require exam subject or valid exam progress context
    if source_id in {'sdei-civil-exams', 'hrss'}:
        return bool(EXAM_SUBJECT_RE.search(title))

    # Exclude corporate companies unless title explicitly announces government 选调/公务员/事业单位/人社局/组织部/教育局/卫健委
    if CORPORATE_COMPANY_RE.search(combined) and not re.search(
        r'人社局|人力资源和社会保障|组织部|选调生|公务员|事业单位公开招聘|控制总量|三支一扶|军队文职|教体局|教育局|卫健委|卫生健康',
        title,
    ):
        return False

    if STRICT_EXAM_TITLE_RE.search(title):
        return True

    # Public university / hospital / research institute official recruitment in Shandong or national level
    if re.search(r'大学|学院|医院|疾控|研究院|科学院|中学|小学|学校|教体局|卫健|人社局', combined) and re.search(
        r'公开招聘|公开选聘|公开遴选|招聘简章|招聘工作人员|招聘人员|招聘教师|招聘高层次|招聘博士|控制总量|事业编|备案制|选调',
        title,
    ):
        return True

    return False


def is_valid_gov_article_title(title: str) -> bool:
    """Validate titles crawled from government or military portals."""
    cleaned = clean_exam_title(title)
    if len(cleaned) < 8 or len(cleaned) > 120:
        return False
    if EXAM_NOISE_TITLE_RE.search(cleaned):
        return False
    if not ANNOUNCEMENT_ACTION_RE.search(cleaned):
        return False
    # Require explicit exam/recruitment subject word (prevent general news with "考察" or "体检" from leaking in)
    if not EXAM_SUBJECT_RE.search(cleaned):
        return False
    return True


def fetch_html_quick(url: str, timeout: float = 6.0, referer: str = '') -> str:
    headers = dict(c.DEFAULT_HEADERS)
    if referer:
        headers['Referer'] = referer
    req = urllib.request.Request(url, headers=headers)
    with c.OPENER.open(req, timeout=timeout) as resp:
        raw = resp.read(350_000)
        charset = resp.headers.get_content_charset() or 'utf-8'
    for enc in (charset, 'utf-8', 'gb18030'):
        try:
            return raw.decode(enc)
        except Exception:
            continue
    return raw.decode('utf-8', errors='ignore')


def fetch_bytes_quick(url: str, timeout: float = 6.0, max_bytes: int = 4_000_000) -> Optional[bytes]:
    try:
        req = urllib.request.Request(url, headers=c.DEFAULT_HEADERS)
        with c.OPENER.open(req, timeout=timeout) as resp:
            return resp.read(max_bytes)
    except Exception:
        return None


def parse_detail_body_and_tables(url: str, fallback_title: str, source_city: str = '') -> Dict[str, Any]:
    """Fetch an official exam detail page and extract body text, attachments, and position tables."""
    try:
        html = fetch_html_quick(url, timeout=6.0)
    except Exception:
        return {
            'body': f'{fallback_title}\n请点击上方「查看原公告」核对完整招考简章与岗位汇总表附件。',
            'attachments': [],
            'exam_positions': [],
        }

    root = c.Tree(html).root
    containers = (
        root.find(id='zoom')
        or root.find(cls='TRS_Editor')
        or root.find(cls='x1_tit2')
        or root.find(cls='sub_x')
        or root.find(cls='wencon')
        or root.find(cls='article')
        or root.find(cls='content')
        or root.find('body')
    )
    body_node = containers[0] if containers else root
    text = c.clean(body_node.text())
    if len(text) < 40:
        text = c.clean(root.text())

    attachments: List[Dict[str, str]] = []
    seen_att_urls = set()
    for a in body_node.find('a'):
        href = c.safe_url(a.attrs.get('href', ''), url)
        if not href or href in seen_att_urls:
            continue
        a_title = c.clean(a.text()) or clean_exam_title(a.attrs.get('title', '')) or '官方附件'
        if re.search(r'\.(xlsx?|xls|pdf|docx?|zip|rar)(?:\?|$)', href, re.I) or re.search(
            r'附件|岗位|职位|汇总表|需求表|计划表|报名表|一览表', a_title
        ):
            seen_att_urls.add(href)
            attachments.append({'title': a_title[:100], 'url': href})

    exam_id = hashlib.sha256(url.encode('utf-8')).hexdigest()[:20]
    exam_positions: List[Dict[str, Any]] = []
    if BeautifulSoup is not None and '<table' in html.lower():
        try:
            soup = BeautifulSoup(html, 'html.parser')
            for tbl in soup.find_all('table'):
                grid = _table_to_grid(tbl)
                if grid:
                    exam_positions.extend(
                        parse_exam_table_grid(grid, exam_id=exam_id, default_city=source_city)
                    )
            if not exam_positions:
                exam_positions.extend(parse_html_tables(soup))
        except Exception:
            pass

    return {
        'body': text[:18000] if text else fallback_title,
        'attachments': attachments[:15],
        'exam_positions': exam_positions,
    }


def crawl_sdei_exam_channel(source: Dict[str, Any], max_pages: int = 3) -> List[Dict[str, Any]]:
    """Crawl gxjy.sdei.edu.cn exam channels (classId=99 and classId=86)."""
    class_id = int(source.get('class_id') or 99)
    discovered: List[Dict[str, Any]] = []
    for page in range(1, max_pages + 1):
        try:
            items, total_pages = c.sdei_news_list(page, page_size=40, source={'id': source['id'], 'class_id': class_id})
        except Exception:
            break
        for it in items:
            title = clean_exam_title(it.get('title', ''))
            if not is_valid_gov_article_title(title):
                continue
            if class_id != 99 and not STRICT_EXAM_TITLE_RE.search(title):
                continue
            if not is_in_shandong_or_national_scope(title, source_id=source['id']):
                continue
            discovered.append({
                'id': hashlib.sha256(it['url'].encode('utf-8')).hexdigest()[:20],
                'title': title,
                'source_id': source['id'],
                'source_name': source['name'],
                'source_url': it['url'],
                'source_city': '' if source.get('city') in ('省属/全省', '全国', '山东及全国') else source.get('city', ''),
                'published_at': it.get('published_at'),
            })
        if page >= total_pages:
            break
    return discovered


def crawl_jinan_cms_exam(source: Dict[str, Any], max_pages: int = 2) -> List[Dict[str, Any]]:
    """Crawl Jinan HRSS public institution recruitment column including exam progress notices."""
    discovered: List[Dict[str, Any]] = []
    for page in range(1, max_pages + 1):
        try:
            src_copy = dict(source)
            src_copy.pop('exclude_title_re', None)
            items, _ = c.jinan_cms_list(src_copy, page, page_size=20)
            for it in items:
                title = clean_exam_title(it.get('title', ''))
                if not is_valid_gov_article_title(title):
                    continue
                discovered.append({
                    'id': hashlib.sha256(it['url'].encode('utf-8')).hexdigest()[:20],
                    'title': title,
                    'source_id': source['id'],
                    'source_name': source['name'],
                    'source_url': it['url'],
                    'source_city': '济南',
                    'published_at': it.get('published_at'),
                })
        except Exception:
            break
    return discovered


def crawl_generic_gov_portal(source: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Crawl provincial/municipal HRSS or military exam pages (static HTML + Hanweb JPAAS API + XML datastore)."""
    url = source['url']
    try:
        html = fetch_html_quick(url, timeout=6.0)
    except Exception:
        return []

    html_chunks = [html]

    # Auto-discover Hanweb JPAAS dynamic list units (used by Yantai, Jining, Weihai, Binzhou, Taian, Rizhao, Zibo)
    for qd_raw in re.findall(r'queryData="(\{[^"]+\})"', html, re.I):
        try:
            qd = json.loads(qd_raw.replace("'", '"'))
            tag_id = str(qd.get('tagId') or '')
            if any(skip in tag_id for skip in ('位置', '导航', '头部', '底部', '页脚', 'banner')):
                continue
            if not qd.get('webId') or not qd.get('pageId'):
                continue
            api = urllib.parse.urljoin(url, '/api-gateway/jpaas-publish-server/front/page/build/unit')
            query = {
                'parseType': qd.get('parseType', 'bulidstatic'),
                'webId': qd['webId'],
                'tplSetId': qd.get('tplSetId', ''),
                'pageType': qd.get('pageType', 'column'),
                'tagId': tag_id,
                'editType': 'null',
                'pageId': qd['pageId'],
                'paramJson': json.dumps({'pageNo': 1, 'pageSize': 25}, ensure_ascii=False),
            }
            payload = json.loads(fetch_html_quick(api + '?' + urllib.parse.urlencode(query), timeout=5.0, referer=url))
            inner_html = (payload.get('data') or {}).get('html')
            if isinstance(inner_html, str) and len(inner_html) > 50:
                html_chunks.append(inner_html)
        except Exception:
            continue

    combined_html = '\n'.join(html_chunks)
    discovered: List[Dict[str, Any]] = []
    seen_urls = set()

    # Match <a href="...">title</a> across normal HTML, JPAAS units, and CDATA blocks
    for m in re.finditer(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', combined_html, re.I | re.S):
        raw_href = m.group(1).strip()
        if not raw_href or raw_href.startswith(('javascript', '#', 'mailto')):
            continue
        raw_inner = m.group(2)
        title_attr = re.search(r'title=["\']([^"\']+)["\']', m.group(0), re.I)
        title = c.clean(title_attr.group(1) if title_attr else re.sub(r'<[^>]+>|<!\[CDATA\[|\]\]>|&middot;|&nbsp;', ' ', raw_inner))
        title = re.sub(r'\s*202\d[-./年]\d{1,2}[-./月]\d{1,2}日?$', '', title).strip()
        title = clean_exam_title(title)
        if not is_valid_gov_article_title(title):
            continue

        full_url = c.safe_url(raw_href, url)
        if not full_url or full_url in seen_urls:
            continue
        # Ensure it's an article link, not a generic nav link
        if not re.search(r'(?:202\d|art_|/info/|t202\d|\d{5,}\.(?:htm|html|shtml))', full_url, re.I):
            continue
        seen_urls.add(full_url)

        # Extract date from URL or surrounding text
        pub_date = None
        url_date = re.search(r'(202\d)[/-]?(\d{2})[/-]?(\d{2})', full_url)
        if url_date:
            try:
                pub_date = dt.date(int(url_date.group(1)), int(url_date.group(2)), int(url_date.group(3))).isoformat()
            except ValueError:
                pass
        if not pub_date:
            ctx = combined_html[max(0, m.start() - 120) : min(len(combined_html), m.end() + 200)]
            dm = re.search(r'(202\d)[-.年/](\d{1,2})[-.月/](\d{1,2})', ctx)
            if dm:
                try:
                    pub_date = dt.date(int(dm.group(1)), int(dm.group(2)), int(dm.group(3))).isoformat()
                except ValueError:
                    pass

        src_city = source.get('city', '')
        if src_city in ('省属/全省', '全国', '山东及全国'):
            src_city = ''

        discovered.append({
            'id': hashlib.sha256(full_url.encode('utf-8')).hexdigest()[:20],
            'title': title,
            'source_id': source['id'],
            'source_name': source['name'],
            'source_url': full_url,
            'source_city': src_city,
            'published_at': pub_date,
        })

    return discovered[:30]


def load_hydrated_existing_jobs(public_dir: Path, live_site: str = 'https://sites-project.job-radar.workers.dev') -> List[Dict[str, Any]]:
    """Load existing jobs from public/exams.json, public/jobs.json (and live production snapshot + detail_shards) to extract civil exam records."""
    jobs_by_id: Dict[str, Dict[str, Any]] = {}
    local_detail_shards: Dict[str, str] = {}
    live_detail_shards: Dict[str, str] = {}

    # 0. Existing public/exams.json seed
    exams_path = public_dir / 'exams.json'
    if exams_path.exists():
        try:
            existing_snap = json.loads(exams_path.read_text(encoding='utf-8'))
            exam_detail_by_id: Dict[str, Dict[str, Any]] = {}
            for shard_rel in (existing_snap.get('detail_shards') or {}).values():
                shard_file = public_dir / str(shard_rel).lstrip('/')
                if shard_file.is_file():
                    try:
                        shard_json = json.loads(shard_file.read_text(encoding='utf-8'))
                        for eid, entry in (shard_json.get('exams') or {}).items():
                            if isinstance(entry, dict):
                                exam_detail_by_id[eid] = entry
                    except Exception:
                        pass
            for ex in existing_snap.get('exams') or []:
                if isinstance(ex, dict) and ex.get('id') and ex.get('source_url'):
                    merged_ex = dict(ex)
                    if ex['id'] in exam_detail_by_id:
                        for k in ('body', 'attachments', 'links'):
                            if merged_ex.get(k) is None and exam_detail_by_id[ex['id']].get(k) is not None:
                                merged_ex[k] = exam_detail_by_id[ex['id']][k]
                    jobs_by_id[ex['id']] = merged_ex
        except Exception:
            pass

    # 1. Local public/jobs.json
    jobs_path = public_dir / 'jobs.json'
    if jobs_path.exists():
        try:
            snapshot = json.loads(jobs_path.read_text(encoding='utf-8'))
            local_detail_shards = dict(snapshot.get('detail_shards') or {})
            jobs_list = list(snapshot.get('jobs') or [])
            if not jobs_list and snapshot.get('index_shards'):
                for shard_rel in snapshot['index_shards']:
                    shard_file = public_dir / shard_rel.lstrip('/')
                    if shard_file.exists():
                        shard_data = json.loads(shard_file.read_text(encoding='utf-8'))
                        jobs_list.extend(shard_data.get('jobs') or [])
            for j in jobs_list:
                if is_civil_exam_record(j) and j.get('id') and j['id'] not in jobs_by_id:
                    jobs_by_id[j['id']] = dict(j)
        except Exception:
            pass

    # 2. Live production snapshot (25,000+ records across all 123 sources)
    if live_site:
        try:
            raw_live = fetch_html_quick(f'{live_site}/jobs.json', timeout=10.0)
            live_snap = json.loads(raw_live)
            live_detail_shards = dict(live_snap.get('detail_shards') or {})
            shard_urls: List[str] = []
            browse = live_snap.get('browse_index') or {}
            if isinstance(browse.get('shards'), list) and browse['shards']:
                shard_urls = [f'{live_site}{s}' for s in browse['shards']]
            elif isinstance(live_snap.get('index_shards'), list) and live_snap['index_shards']:
                shard_urls = [f'{live_site}{s}' for s in live_snap['index_shards']]

            def fetch_shard(u: str) -> List[Dict[str, Any]]:
                try:
                    req = urllib.request.Request(u, headers=c.DEFAULT_HEADERS)
                    with c.OPENER.open(req, timeout=12.0) as resp:
                        raw = resp.read(15_000_000)
                    data = json.loads(raw.decode('utf-8'))
                    return [row for row in (data.get('jobs') or []) if is_civil_exam_record(row)]
                except Exception:
                    return []

            if shard_urls:
                with ThreadPoolExecutor(max_workers=6) as pool:
                    for rows in pool.map(fetch_shard, shard_urls):
                        for r in rows:
                            rid = r.get('id')
                            if rid and rid not in jobs_by_id:
                                jobs_by_id[rid] = dict(r)
        except Exception:
            pass

    # 3. Hydrate full detail fields (body, positions, attachments, links, emails) from detail_shards
    needed_prefixes = sorted({jid[:2] for jid in jobs_by_id if len(jid) >= 2})
    for prefix in needed_prefixes:
        rel = local_detail_shards.get(prefix)
        if not rel:
            continue
        p = public_dir / rel.lstrip('/')
        if p.exists():
            try:
                shard_obj = json.loads(p.read_text(encoding='utf-8'))
                for jid, detail_rec in (shard_obj.get('jobs') or {}).items():
                    if jid in jobs_by_id and isinstance(detail_rec, dict):
                        jobs_by_id[jid].update(detail_rec)
            except Exception:
                pass

    if live_site and live_detail_shards:
        missing_prefixes = sorted({
            jid[:2]
            for jid, rec in jobs_by_id.items()
            if len(jid) >= 2 and not rec.get('body') and jid[:2] in live_detail_shards
        })

        def fetch_live_detail_shard(prefix: str) -> Dict[str, Dict[str, Any]]:
            u = f"{live_site}{live_detail_shards[prefix]}"
            try:
                req = urllib.request.Request(u, headers=c.DEFAULT_HEADERS)
                with c.OPENER.open(req, timeout=10.0) as resp:
                    data = json.loads(resp.read(15_000_000).decode('utf-8'))
                return data.get('jobs') or {}
            except Exception:
                return {}

        if missing_prefixes:
            with ThreadPoolExecutor(max_workers=10) as pool:
                for shard_jobs in pool.map(fetch_live_detail_shard, missing_prefixes):
                    for jid, detail_rec in shard_jobs.items():
                        if jid in jobs_by_id and isinstance(detail_rec, dict):
                            jobs_by_id[jid].update(detail_rec)

    return list(jobs_by_id.values())


def parse_position_attachments_for_items(items: List[Dict[str, Any]], max_items: int = 20) -> None:
    """Download and parse .xlsx position table attachments for announcements that lack tabular positions."""
    candidates: List[Dict[str, Any]] = []
    for item in items:
        if item.get('exam_positions') or item.get('positions'):
            continue
        atts = item.get('attachments') or []
        has_pos_att = any(
            re.search(r'\.xlsx(?:\?|$)', str(a.get('url') or ''), re.I)
            and re.search(r'岗位|职位|计划|汇总|需求|一览', str(a.get('title') or ''))
            for a in atts
        )
        if has_pos_att:
            candidates.append(item)

    candidates.sort(key=lambda x: x.get('published_at') or '', reverse=True)

    def parse_item_atts(item: Dict[str, Any]) -> None:
        exam_id = item.get('id') or hashlib.sha256((item.get('source_url') or '').encode('utf-8')).hexdigest()[:20]
        src_city = item.get('source_city') or (item.get('cities') or [''])[0]
        parsed_rows: List[Dict[str, Any]] = []
        for att in (item.get('attachments') or [])[:3]:
            att_url = str(att.get('url') or '')
            att_title = str(att.get('title') or '')
            if not att_url or not re.search(r'岗位|职位|计划|汇总|需求|一览', att_title):
                continue
            if not re.search(r'\.xlsx(?:\?|$)', att_url, re.I):
                continue
            raw_bytes = fetch_bytes_quick(att_url, timeout=5.0)
            if not raw_bytes:
                continue
            rows = parse_exam_excel_bytes(raw_bytes, exam_id=exam_id, default_city=src_city, filename=att_title)
            if rows:
                for r in rows:
                    r['source_url'] = att_url
                parsed_rows.extend(rows)
                att['parse_status'] = 'parsed'
        if parsed_rows:
            item['exam_positions'] = parsed_rows

    if candidates:
        with ThreadPoolExecutor(max_workers=6) as pool:
            list(pool.map(parse_item_atts, candidates[:max_items]))


NOTICE_STRIP_RE = re.compile(
    r'面试|笔试|成绩|总成绩|准考证|资格审查|资格复审|现场资格|体检|考察|政审|递补|'
    r'拟聘用|拟录用|拟聘|聘用|录用|公示|通知|公告|简章|有关事项|相关事项|关于|人员|名单|'
    r'时间|安排|进入|范围|及|与|和|的|[\s\W_]+',
    re.I,
)


def _core_title_chars(title: str) -> set[str]:
    stripped = NOTICE_STRIP_RE.sub('', clean_exam_title(title or ''))
    return set(stripped)


def link_related_exam_notices(exams: List[Dict[str, Any]]) -> None:
    """Link follow-up exam notices to their parent recruitment announcement (招考简章)."""
    parents = [e for e in exams if e.get('notice_role') == '招考简章']
    if not parents:
        return

    parent_cores = [(p, _core_title_chars(p.get('title') or '')) for p in parents]
    for notice in exams:
        role = notice.get('notice_role')
        if not role or role == '招考简章':
            continue
        org = notice.get('organizer')
        if not org:
            continue
        notice_core = _core_title_chars(notice.get('title') or '')
        if len(notice_core) < 3:
            continue
        notice_pub = (notice.get('published_at') or '')[:10]

        best_parent: Optional[Dict[str, Any]] = None
        best_ratio = 0.0
        for parent, p_core in parent_cores:
            if parent.get('id') == notice.get('id') or parent.get('organizer') != org:
                continue
            if not p_core:
                continue
            parent_pub = (parent.get('published_at') or '')[:10]
            if notice_pub and parent_pub:
                try:
                    d_notice = dt.date.fromisoformat(notice_pub)
                    d_parent = dt.date.fromisoformat(parent_pub)
                    diff_days = (d_notice - d_parent).days
                    if diff_days < 0 or diff_days > 180:
                        continue
                except Exception:
                    pass
            denom = max(1, min(len(notice_core), len(p_core)))
            ratio = len(notice_core & p_core) / denom
            if ratio >= 0.6 and ratio > best_ratio:
                best_ratio = ratio
                best_parent = parent

        if best_parent is not None:
            notice['parent_exam_id'] = best_parent['id']
            notice['parent_exam_title'] = best_parent['title']
            rel_list = list(best_parent.get('related_notices') or [])
            if not any(r.get('id') == notice['id'] for r in rel_list):
                notice_type = '补充更正' if role == '补充公告' else role
                rel_list.append({
                    'id': notice['id'],
                    'title': notice['title'],
                    'published_at': notice.get('published_at'),
                    'notice_type': notice_type,
                    'url': notice.get('source_url') or '',
                    'source_name': notice.get('source_name') or '',
                })
                rel_list.sort(key=lambda r: (r.get('published_at') or '', r.get('id') or ''))
                best_parent['related_notices'] = rel_list


def collect_and_export_exams(
    public_dir: Path = ROOT / 'public',
    live_crawl: bool = True,
) -> Dict[str, Any]:
    now_iso = dt.datetime.now(TZ).isoformat(timespec='seconds')
    today_str = now_iso[:10]

    raw_by_url: Dict[str, Dict[str, Any]] = {}
    source_stats: Dict[str, Dict[str, Any]] = {
        s['id']: {
            'id': s['id'],
            'name': s['name'],
            'url': s['url'],
            'city': s.get('city', '山东'),
            'level': s.get('level', '官方招考源'),
            'status': 'ok',
            'count': 0,
            'last_success_at': now_iso,
            'errors': [],
        }
        for s in EXAM_SOURCES
    }

    city_to_src = {
        '济南': 'jinan-hrss-exam',
        '青岛': 'qingdao-hrss-exam',
        '淄博': 'zibo-hrss-exam',
        '枣庄': 'zaozhuang-hrss-exam',
        '东营': 'dongying-hrss-exam',
        '烟台': 'yantai-hrss-exam',
        '潍坊': 'weifang-hrss-exam',
        '济宁': 'jining-hrss-exam',
        '泰安': 'taian-hrss-exam',
        '威海': 'weihai-hrss-exam',
        '日照': 'rizhao-hrss-exam',
        '临沂': 'linyi-hrss-exam',
        '德州': 'dezhou-hrss-exam',
        '聊城': 'liaocheng-hrss-exam',
        '滨州': 'binzhou-hrss-exam',
        '菏泽': 'heze-hrss-exam',
    }

    # 1. Extract civil exam records already present in public/jobs.json and live snapshot
    existing_exam_jobs = load_hydrated_existing_jobs(
        public_dir,
        live_site='https://sites-project.job-radar.workers.dev' if live_crawl else '',
    )
    for job in existing_exam_jobs:
        url = job.get('source_url') or ''
        if not url:
            continue
        orig_src = job.get('source_id', '')
        mapped_src = orig_src if orig_src in DEDICATED_SHANDONG_SOURCES else 'campus-exam-hub'
        if orig_src == 'sdei-civil-exams':
            mapped_src = 'sdei-civil-exams'
        elif orig_src in ('hrss', 'jinan-gov'):
            mapped_src = 'jinan-hrss-exam'
        elif orig_src == 'qdhrss':
            mapped_src = 'qingdao-hrss-exam'
        elif orig_src == 'sdei-news':
            mapped_src = 'sdei-exam-dispatch'
        else:
            job_cities = cities_in_text(job.get('title', ''), infer_counties=True) or list(job.get('cities') or [])
            for c_name in job_cities:
                if c_name in city_to_src and re.search(r'人社|事业|组织部|选调|教体|教育|卫健|卫生|医院|优才|引进', job.get('title', '')):
                    mapped_src = city_to_src[c_name]
                    break

        rec = dict(job)
        rec['source_id'] = mapped_src
        raw_by_url[url] = rec

    # 2. Live crawl official exam portals in parallel
    if live_crawl:
        def run_source(src: Dict[str, Any]) -> Tuple[str, List[Dict[str, Any]], Optional[str]]:
            sid = src['id']
            adapter = src.get('adapter')
            try:
                if adapter == 'sdei_exam_channel':
                    return sid, crawl_sdei_exam_channel(src, max_pages=3), None
                if adapter == 'jinan_cms_exam':
                    return sid, crawl_jinan_cms_exam(src, max_pages=2), None
                if adapter == 'generic_gov':
                    return sid, crawl_generic_gov_portal(src), None
                return sid, [], None
            except Exception as exc:
                return sid, [], str(exc)

        active_sources = [s for s in EXAM_SOURCES if s.get('adapter') != 'snapshot_extract']
        with ThreadPoolExecutor(max_workers=8) as pool:
            for sid, items, err in pool.map(run_source, active_sources):
                if err:
                    source_stats[sid]['status'] = 'partial'
                    source_stats[sid]['errors'] = [err]
                for it in items:
                    u = it['source_url']
                    if u not in raw_by_url:
                        raw_by_url[u] = it

        # Fetch details for newly discovered items that lack full body text (bounded to top 40 newest)
        need_detail = [
            it for it in raw_by_url.values()
            if len(str(it.get('body') or '')) < 80
        ]
        need_detail.sort(key=lambda x: x.get('published_at') or '', reverse=True)

        def enrich_one(item: Dict[str, Any]) -> None:
            detail_info = parse_detail_body_and_tables(
                item['source_url'],
                item['title'],
                source_city=item.get('source_city', ''),
            )
            if len(detail_info.get('body') or '') >= len(str(item.get('body') or '')):
                item['body'] = detail_info['body']
            if detail_info.get('attachments') and not item.get('attachments'):
                item['attachments'] = detail_info['attachments']
            if detail_info.get('exam_positions') and not item.get('exam_positions'):
                item['exam_positions'] = detail_info['exam_positions']

        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(enrich_one, need_detail[:40]))

        # Parse .xlsx / .pdf position table attachments for announcements that lack tabular positions
        parse_position_attachments_for_items(list(raw_by_url.values()), max_items=25)

    # 3. Enrich all records into ExamAnnouncement objects and deduplicate identical announcements
    deduped_exams: Dict[str, Dict[str, Any]] = {}
    for raw_item in raw_by_url.values():
        exam_obj = enrich_exam_record(raw_item, today_str=today_str)
        # Re-verify scope after title/organizer enrichment
        if not is_in_shandong_or_national_scope(
            f"{exam_obj['title']} {exam_obj['organizer']}",
            source_id=exam_obj.get('source_id', ''),
            excerpt=exam_obj.get('excerpt', ''),
        ):
            continue

        norm_title = re.sub(r'[\s【】()（）·|｜!！~～]+', '', exam_obj['title'])
        dedup_key = f"{norm_title}::{exam_obj['organizer']}" if len(norm_title) >= 10 else exam_obj['id']

        existing = deduped_exams.get(dedup_key)
        if not existing:
            deduped_exams[dedup_key] = exam_obj
        else:
            # Prefer non-campus-hub official source, or record with more positions/longer body
            existing_score = (
                (1 if existing.get('source_id') != 'campus-exam-hub' else 0),
                len(existing.get('positions') or []),
                len(existing.get('body') or ''),
            )
            new_score = (
                (1 if exam_obj.get('source_id') != 'campus-exam-hub' else 0),
                len(exam_obj.get('positions') or []),
                len(exam_obj.get('body') or ''),
            )
            if new_score > existing_score:
                deduped_exams[dedup_key] = exam_obj

    all_deduped = list(deduped_exams.values())
    official_keys = {
        (e['organizer'], e.get('schedule', {}).get('reg_end'), e.get('total_headcount'))
        for e in all_deduped
        if not any(w in e['title'] for w in ('这家', '这些', '这个', '这两家', '不要错过', '快来报名'))
    }
    official_org_dates = {
        (e['organizer'], e.get('published_at'))
        for e in all_deduped
        if not any(w in e['title'] for w in ('这家', '这些', '这个', '这两家', '不要错过', '快来报名'))
    }
    exams = [
        e for e in all_deduped
        if not (
            any(w in e['title'] for w in ('这家', '这些', '这个', '这两家', '不要错过', '快来报名'))
            and (
                (e['organizer'], e.get('schedule', {}).get('reg_end'), e.get('total_headcount')) in official_keys
                or (e['organizer'], e.get('published_at')) in official_org_dates
            )
        )
    ]
    for exam_obj in exams:
        sid = exam_obj.get('source_id', 'campus-exam-hub')
        if sid in source_stats:
            source_stats[sid]['count'] = source_stats[sid].get('count', 0) + 1

    link_related_exam_notices(exams)

    # Sort newest first
    exams.sort(key=lambda x: (x.get('published_at') or '', x.get('id') or ''), reverse=True)

    total_positions = sum(len(e.get('positions') or []) for e in exams)
    total_headcount = sum(int(e['total_headcount']) for e in exams if e.get('total_headcount') is not None)
    total_exams_with_positions = sum(1 for e in exams if e.get('positions'))
    all_cities = sorted({c_name for e in exams for c_name in (e.get('cities') or []) if c_name})

    payload = {
        'schema_version': 1,
        'generated_at': now_iso,
        'last_success_at': now_iso,
        'total_exams': len(exams),
        'total_positions': total_positions,
        'total_headcount': total_headcount,
        'total_exams_with_positions': total_exams_with_positions,
        'cities': all_cities,
        'exams': exams,
        'sources': list(source_stats.values()),
    }

    return write_exam_snapshot(payload, public_dir)


def exam_shard_prefix(exam_id: str) -> str:
    cleaned = re.sub(r'[^0-9a-z]', '0', str(exam_id or '').lower())
    return (cleaned + '00')[:2]


def write_exam_snapshot(payload: Dict[str, Any], public_dir: Path) -> Dict[str, Any]:
    public_dir = Path(public_dir).resolve()
    assets_dir = (public_dir / 'exam-assets').resolve()
    assets_dir.mkdir(parents=True, exist_ok=True)

    # Remove old detail-*.json files inside public/exam-assets/ before generating new ones.
    for old in assets_dir.glob('detail-*.json'):
        if old.resolve().is_relative_to(assets_dir):
            old.unlink()

    shard_groups: Dict[str, Dict[str, Dict[str, Any]]] = {}
    slim_exams: List[Dict[str, Any]] = []

    for exam in payload.get('exams') or []:
        eid = str(exam.get('id') or '')
        prefix = exam_shard_prefix(eid)
        detail_entry: Dict[str, Any] = {}
        for field in ('body', 'attachments', 'links'):
            if exam.get(field) is not None:
                detail_entry[field] = exam[field]
        shard_groups.setdefault(prefix, {})[eid] = detail_entry
        slim_exams.append({k: v for k, v in exam.items() if k not in ('body', 'attachments', 'links')})

    detail_shards: Dict[str, str] = {}
    for prefix, group_exams in sorted(shard_groups.items()):
        shard_payload = {
            'schema_version': 1,
            'exams': group_exams,
        }
        raw_bytes = json.dumps(shard_payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        digest20 = hashlib.sha256(raw_bytes).hexdigest()[:20]
        filename = f'detail-{prefix}-{digest20}.json'
        (assets_dir / filename).write_bytes(raw_bytes)
        detail_shards[prefix] = f'/exam-assets/{filename}'

    out_payload = {
        **payload,
        'detail_shards': detail_shards,
        'exams': slim_exams,
    }
    out_path = public_dir / 'exams.json'
    out_path.write_bytes(json.dumps(out_payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
    return out_payload


def main() -> None:
    parser = argparse.ArgumentParser(description='Collect and export Civil Service & Public Institution exams.')
    parser.add_argument('--public-dir', default=str(ROOT / 'public'))
    parser.add_argument('--offline-only', action='store_true', help='Only extract from existing snapshot without network requests')
    args = parser.parse_args()

    res = collect_and_export_exams(
        public_dir=Path(args.public_dir),
        live_crawl=not args.offline_only,
    )
    print(
        f"Exported exams.json: total_exams={res['total_exams']}, "
        f"total_positions={res['total_positions']}, total_headcount={res['total_headcount']}, "
        f"cities={len(res['cities'])}"
    )


if __name__ == '__main__':
    main()
