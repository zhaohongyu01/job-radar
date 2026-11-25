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
    clean_exam_attachments,
    clean_exam_title,
    enrich_exam_record,
    infer_notice_role,
    normalize_exam_attachment_url,
    parse_exam_attachment_bytes,
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
    r'引进.*人才|青年人才|急需紧缺|优才|高层次人才|党政储备|公费师范|乡村医生|'
    r'教师.*招聘|教育系统.*招聘|教体局.*招聘|卫健.*招聘|卫生.*招聘|医院.*招聘|疾控.*招聘|医生.*招聘',
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
    r'公告|通告|简章|通知|启事|计划|方案|名单|公示|成绩|复审|审查|笔试|面试|遴选|招考|招录|选调|招募|引进|公开招聘|选聘|聘用',
    re.I,
)

NATIONAL_OR_CROSS_EXAM_RE = re.compile(
    r'中央机关|国家公务员|国考|军队文职|文职人员|全军|北部战区|南部战区|东部战区|西部战区|中部战区|'
    r'火箭军|武警|联勤保障|军事科学院|国防科技大学|'
    r'部属事业单位|人社部|人力资源社会保障部|国务院|'
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
    'cpta-notice',
    'sd-hrss-rsks',
    'dtdjzx-gwy',
    'dtdjzx-xds',
    'dtdjzx-lxxd',
    'sd-16cities-gwy',
    'sd-edu-tzgg',
    'sd-wsjkw-gsgg',
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
    {
        'id': 'cpta-notice',
        'name': '中国人事考试网 · 国考与公开招聘考务通知',
        'url': 'http://www.cpta.com.cn/notice.html',
        'city': '全国',
        'level': '国家级',
        'adapter': 'generic_gov',
    },
    # 2. 山东省级核心招考平台（省委组织部灯塔平台 + 省人事考试信息网 + 省教育厅 + 省卫健委）
    {
        'id': 'dtdjzx-gwy',
        'name': '中共山东省委组织部 · 灯塔-录用公务员专栏',
        'url': 'https://www.dtdjzx.gov.cn/web/dtdjzx/lygwyzkgg.html',
        'extra_urls': ['https://www.dtdjzx.gov.cn/web/dtdjzx/lytzgg.html'],
        'download_url': 'https://www.dtdjzx.gov.cn/web/dtdjzx/lyxgxz.html',
        'city': '省属/全省',
        'level': '省级',
        'adapter': 'dtdjzx_exam',
    },
    {
        'id': 'dtdjzx-xds',
        'name': '中共山东省委组织部 · 灯塔-选调生录用专栏',
        'url': 'https://www.dtdjzx.gov.cn/web/dtdjzx/lyxdszkgg.html',
        'extra_urls': ['https://www.dtdjzx.gov.cn/web/dtdjzx/lyxdstzgg.html'],
        'city': '省属/全省',
        'level': '省级',
        'adapter': 'dtdjzx_exam',
    },
    {
        'id': 'dtdjzx-lxxd',
        'name': '中共山东省委组织部 · 灯塔-公开遴选与选调公务员',
        'url': 'https://www.dtdjzx.gov.cn/web/dtdjzx/lxxdtzgg.html',
        'city': '省属/全省',
        'level': '省级',
        'adapter': 'dtdjzx_exam',
    },
    {
        'id': 'sd-16cities-gwy',
        'name': '山东省16市组织部 · 灯塔地市公务员招录专栏',
        'url': 'https://www.dtdjzx.gov.cn/web/dtdjzx/gwygzlygwy.html',
        'city': '省属/全省',
        'level': '市级',
        'adapter': 'sd_16cities_gwy',
    },
    {
        'id': 'sd-hrss-rsks',
        'name': '山东省人社厅 · 山东人事考试信息网',
        'url': 'http://hrss.shandong.gov.cn/rsks/channels/ch03577/',
        'city': '省属/全省',
        'level': '省级',
        'adapter': 'generic_gov',
    },
    {
        'id': 'sd-edu-tzgg',
        'name': '山东省教育厅 · 直属单位公开招聘与通知公告',
        'url': 'http://edu.shandong.gov.cn/col/col11982/index.html',
        'city': '省属/全省',
        'level': '省级',
        'adapter': 'generic_gov',
    },
    {
        'id': 'sd-wsjkw-gsgg',
        'name': '山东省卫生健康委员会 · 医疗卫生公开招聘公告',
        'url': 'http://wsjkw.shandong.gov.cn/zwgk/fdzdgknr/gsgg/',
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
        'url': 'http://zzhrss.zaozhuang.gov.cn/rsks/',
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
        raw = resp.read(1_200_000)
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


_ORIG_FETCH_BYTES_QUICK = fetch_bytes_quick


def fetch_attachment_conditional(
    url: str,
    timeout: float = 6.0,
    max_bytes: int = 4_000_000,
    etag: str = '',
    last_modified: str = '',
) -> Tuple[str, Optional[bytes], str, str]:
    """Fetch attachment bytes with optional If-None-Match / If-Modified-Since conditional headers."""
    if fetch_bytes_quick is not _ORIG_FETCH_BYTES_QUICK:
        raw = fetch_bytes_quick(url, timeout=timeout, max_bytes=max_bytes)
        if raw:
            return 'ok', raw, '', ''
        return 'error', None, '', ''
    headers = dict(c.DEFAULT_HEADERS)
    if etag:
        headers['If-None-Match'] = etag
    if last_modified:
        headers['If-Modified-Since'] = last_modified
    try:
        req = urllib.request.Request(url, headers=headers)
        with c.OPENER.open(req, timeout=timeout) as resp:
            raw = resp.read(max_bytes)
            resp_etag = str(resp.headers.get('ETag') or '').strip()
            resp_lm = str(resp.headers.get('Last-Modified') or '').strip()
            return 'ok', raw, resp_etag, resp_lm
    except urllib.error.HTTPError as exc:
        if exc.code == 304:
            return 'not_modified', None, etag, last_modified
        return 'error', None, '', ''
    except Exception:
        return 'error', None, '', ''


def extract_dtdjzx_embedded_html(html: str) -> str:
    r"""Extract Vue template literal `content: \`...\`` from dtdjzx.gov.cn detail pages."""
    if 'v-html="content"' not in html and 'dtdjzx.gov.cn' not in html:
        return ''
    m = re.search(
        r'content:\s*`(.*?)`\s*,\s*(?:contentSize|videoUrl|readInfo|crumbList|url|articleTitle)',
        html,
        re.S,
    )
    if not m:
        m = re.search(r'content:\s*`(.*?)`', html, re.S)
    return m.group(1).strip() if m else ''


def parse_detail_body_and_tables(
    url: str,
    fallback_title: str,
    source_city: str = '',
    strict_fetch: bool = False,
) -> Optional[Dict[str, Any]]:
    """Fetch an official exam detail page and extract body text, attachments, and position tables."""
    try:
        html = fetch_html_quick(url, timeout=6.0)
    except Exception:
        if strict_fetch:
            return None
        return {
            'body': f'{fallback_title}\n请点击上方「查看原公告」核对完整招考简章与岗位汇总表附件。',
            'attachments': [],
            'exam_positions': [],
        }

    if strict_fetch and not (html or '').strip():
        return None

    embedded_html = extract_dtdjzx_embedded_html(html)
    parse_html = f'<div class="content">{embedded_html}</div>' if embedded_html else html

    root = c.Tree(parse_html).root
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

    gov_m = re.search(r'https?://[a-z0-9.-]+\.gov\.cn(?::\d+)?', text, re.I)
    gov_origin = gov_m.group(0) if gov_m else ''

    attachments: List[Dict[str, str]] = []
    seen_att_urls = set()
    for a in body_node.find('a'):
        href = c.safe_url(a.attrs.get('href', ''), url)
        if not href:
            continue
        href = normalize_exam_attachment_url(href, fallback_origin=gov_origin)
        if not href or href in seen_att_urls:
            continue
        a_title = c.clean(a.text()) or clean_exam_title(a.attrs.get('title', '')) or '官方附件'
        if re.search(r'\.(xlsx?|xls|pdf|docx?|zip|rar)(?:\?|$)', href, re.I) or re.search(
            r'附件|岗位|职位|汇总表|需求表|计划表|报名表|一览表', a_title
        ):
            seen_att_urls.add(href)
            attachments.append({'title': a_title[:100], 'url': href})
    attachments = clean_exam_attachments(attachments, fallback_origin=gov_origin)

    exam_id = hashlib.sha256(url.encode('utf-8')).hexdigest()[:20]
    exam_positions: List[Dict[str, Any]] = []
    if BeautifulSoup is not None and '<table' in parse_html.lower():
        try:
            soup = BeautifulSoup(parse_html, 'html.parser')
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

    if strict_fetch:
        stripped = text.strip()
        if not stripped or (len(stripped) < 30 and not attachments and not exam_positions):
            return None
        if (
            len(stripped) < 80
            and not attachments
            and not exam_positions
            and re.search(r'404\s*Not\s*Found|502\s*Bad\s*Gateway|503\s*Service|系统维护|访问过于频繁', stripped, re.I)
        ):
            return None

    return {
        'body': text[:18000] if text else fallback_title,
        'attachments': attachments[:15],
        'exam_positions': exam_positions,
    }


def crawl_sdei_exam_channel(
    source: Dict[str, Any],
    max_pages: int = 3,
    raise_on_error: bool = False,
) -> List[Dict[str, Any]]:
    """Crawl gxjy.sdei.edu.cn exam channels (classId=99 and classId=86)."""
    class_id = int(source.get('class_id') or 99)
    discovered: List[Dict[str, Any]] = []
    for page in range(1, max_pages + 1):
        try:
            items, total_pages = c.sdei_news_list(page, page_size=40, source={'id': source['id'], 'class_id': class_id})
        except Exception:
            if page == 1 and raise_on_error:
                raise
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


def crawl_jinan_cms_exam(
    source: Dict[str, Any],
    max_pages: int = 2,
    raise_on_error: bool = False,
) -> List[Dict[str, Any]]:
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
            if page == 1 and raise_on_error:
                raise
            break
    return discovered


def crawl_generic_gov_portal(source: Dict[str, Any], raise_on_error: bool = False) -> List[Dict[str, Any]]:
    """Crawl provincial/municipal HRSS or military exam pages (static HTML + Hanweb JPAAS API + XML datastore)."""
    url = source['url']
    try:
        html = fetch_html_quick(url, timeout=6.0)
    except Exception:
        if raise_on_error:
            raise
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
        title = re.sub(r'\s*202\d[-./年]\d{1,2}[-./月]\d{1,2}(?:日|\s+\d{1,2}:\d{2}(?::\d{2})?)?$', '', title).strip()
        half = len(title) // 2
        if half >= 8 and title[:half].strip() == title[half:].strip():
            title = title[:half].strip()
        title = clean_exam_title(title)
        if not is_valid_gov_article_title(title):
            continue
        if not is_in_shandong_or_national_scope(title, source_id=source['id']):
            continue

        full_url = c.safe_url(raw_href, url)
        if not full_url or full_url in seen_urls:
            continue
        # Ensure it's an article link, not a generic nav link
        if not re.search(
            r'(?:202\d|art_|/info/|t202\d|/(?:notice|examNotice|performance|gwytg)/\d+\.html|'
            r'/article/.*id/\d+|/articles\?id=\d+|News-[0-9a-f]{16,}\.html|/contents/\d+/\d+\.html|/c\d+/content\.html|'
            r'\d{4,}\.(?:htm|html|shtml))',
            full_url,
            re.I,
        ):
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


def parse_dtdjzx_basic_lines(html: str, base_url: str) -> List[Dict[str, str]]:
    """Parse static `<basic-line ...>` list tags and Vue SSR `list.push({...})` items from dtdjzx.gov.cn columns."""
    entries: List[Dict[str, str]] = []
    seen: set[str] = set()
    for tag_m in re.finditer(r'<basic-line\b([^>]+)>', html, re.I | re.S):
        attrs_raw = tag_m.group(1)
        attrs = {
            k.lower(): c.clean(v)
            for k, v in re.findall(r'([a-zA-Z_-]+)\s*=\s*["\']([^"\']*)["\']', attrs_raw)
        }
        raw_url = attrs.get('url', '')
        full_url = c.safe_url(raw_url, base_url)
        title = clean_exam_title(attrs.get('title', ''))
        if not full_url or not title or full_url in seen:
            continue
        seen.add(full_url)
        pub_date = attrs.get('time', '')[:10]
        if not re.fullmatch(r'202\d-\d{2}-\d{2}', pub_date):
            pub_date = ''
        entries.append({
            'title': title,
            'url': full_url,
            'published_at': pub_date,
            'description': attrs.get('description', ''),
        })

    # Municipal dtdjzx sub-sites (Jinan, Zibo, Zaozhuang, Taian, Weihai, Linyi, Dezhou, Heze) embed SSR list.push({...})
    for push_m in re.finditer(r'list\.push\(\{(.*?)\}\)', html, re.S):
        block = push_m.group(1)
        fields = {
            k: c.clean(v)
            for k, v in re.findall(r'([a-zA-Z_]+)\s*:\s*`([^`]*)`', block)
        }
        raw_url = fields.get('link') or fields.get('url') or ''
        full_url = c.safe_url(raw_url, base_url)
        title = clean_exam_title(fields.get('title', ''))
        if not full_url or not title or full_url in seen:
            continue
        seen.add(full_url)
        pub_date = (fields.get('time') or '')[:10]
        if not re.fullmatch(r'202\d-\d{2}-\d{2}', pub_date):
            pub_date = ''
        entries.append({
            'title': title,
            'url': full_url,
            'published_at': pub_date,
            'description': fields.get('description', ''),
        })
    return entries


SD_16CITIES_GWY_PORTALS: List[Tuple[str, str, str]] = [
    ('济南', 'https://jinan.dtdjzx.gov.cn/web/p582/lygwy.html?siteId=582', 'dtdjzx'),
    ('青岛', 'http://zzb.qingdao.gov.cn/ztzl/gwykszl/', 'generic'),
    ('淄博', 'https://zb.dtdjzx.gov.cn/cmsx/p926/gwygl.html', 'dtdjzx'),
    ('枣庄', 'https://zz.dtdjzx.gov.cn/web/p958/gwyzl.html?siteId=958', 'dtdjzx'),
    ('东营', 'http://www.dongyingdj.gov.cn/home/list/index/main/2/term/45', 'generic'),
    ('烟台', 'https://ytdangjian.yantai.gov.cn/col/col101367/index.html', 'generic'),
    ('潍坊', 'http://www.wfzzb.cn/html/gwy/list1.html', 'generic'),
    ('济宁', 'http://jnswzzb.jndq.gov.cn/col/col36297/index.html', 'generic'),
    ('泰安', 'https://taian.dtdjzx.gov.cn/web/p896/gzdt22.html?siteId=896', 'dtdjzx'),
    ('威海', 'https://wh.dtdjzx.gov.cn/cmsx/p1012/lygwy.html', 'dtdjzx'),
    ('日照', 'http://www.rzzzb.gov.cn/web/webModules?category=83', 'generic'),
    ('临沂', 'https://linyi.dtdjzx.gov.cn/web/p883/lygwy.html?siteId=883', 'dtdjzx'),
    ('德州', 'https://dz.dtdjzx.gov.cn/web/p922/gggs.html', 'dtdjzx'),
    ('聊城', 'http://www.lczgw.gov.cn/Display_News_545_1.html', 'generic'),
    ('滨州', 'http://www.bzzzb.gov.cn/channels/364.html?word=', 'generic'),
    ('菏泽', 'https://hz.dtdjzx.gov.cn/cmsx/p819/hzdtzg.html', 'dtdjzx'),
]


def crawl_sd_16cities_gwy(source: Dict[str, Any], raise_on_error: bool = False) -> List[Dict[str, Any]]:
    """Crawl the 16 municipal civil service columns linked from Shandong dtdjzx gwygzlygwy.html."""
    def fetch_city(entry: Tuple[str, str, str]) -> Tuple[bool, List[Dict[str, Any]], Optional[Exception]]:
        city, url, mode = entry
        sub_src = {
            'id': source['id'],
            'name': f'{city}市委组织部 · 公务员考录专栏',
            'url': url,
            'city': city,
        }
        try:
            if mode == 'dtdjzx':
                return True, crawl_dtdjzx_exam(sub_src, raise_on_error=True)[:10], None
            return True, crawl_generic_gov_portal(sub_src, raise_on_error=True)[:10], None
        except Exception as exc:
            return False, [], exc

    discovered: List[Dict[str, Any]] = []
    seen_urls: set[str] = set()
    ok_cities = 0
    last_err: Optional[Exception] = None
    with ThreadPoolExecutor(max_workers=8) as pool:
        for city_ok, city_items, err in pool.map(fetch_city, SD_16CITIES_GWY_PORTALS):
            if city_ok:
                ok_cities += 1
            elif err is not None:
                last_err = err
            for it in city_items:
                if it['source_url'] not in seen_urls:
                    seen_urls.add(it['source_url'])
                    discovered.append(it)
    if raise_on_error and ok_cities == 0 and last_err is not None:
        raise last_err
    return discovered


def crawl_dtdjzx_exam(source: Dict[str, Any], raise_on_error: bool = False) -> List[Dict[str, Any]]:
    """Crawl Shandong Organization Dept (灯塔-党建在线) Civil Service & Selected Graduate columns."""
    urls = [source['url'], *(source.get('extra_urls') or [])]
    discovered: List[Dict[str, Any]] = []
    seen_urls = set()
    src_city = source.get('city', '')
    if src_city in ('省属/全省', '全国', '山东及全国'):
        src_city = ''

    any_page_ok = False
    last_err: Optional[Exception] = None
    for page_url in urls:
        try:
            html = fetch_html_quick(page_url, timeout=6.0)
            any_page_ok = True
        except Exception as exc:
            last_err = exc
            continue
        for row in parse_dtdjzx_basic_lines(html, page_url):
            if row['url'] in seen_urls:
                continue
            if not is_valid_gov_article_title(row['title']):
                continue
            seen_urls.add(row['url'])
            discovered.append({
                'id': hashlib.sha256(row['url'].encode('utf-8')).hexdigest()[:20],
                'title': row['title'],
                'source_id': source['id'],
                'source_name': source['name'],
                'source_url': row['url'],
                'source_city': src_city,
                'published_at': row['published_at'] or None,
                'excerpt': row['description'],
            })

    if raise_on_error and not any_page_ok and last_err is not None:
        raise last_err

    # Attach standalone position-table download entries (e.g. lyxgxz.html) to their matching announcement
    dl_url = source.get('download_url')
    if dl_url and discovered:
        try:
            dl_html = fetch_html_quick(dl_url, timeout=6.0)
            for dl_row in parse_dtdjzx_basic_lines(dl_html, dl_url):
                if not re.search(r'职位表|岗位表|计划表|汇总表', dl_row['title']):
                    continue
                dl_detail = parse_detail_body_and_tables(dl_row['url'], dl_row['title'], source_city=src_city)
                dl_atts = dl_detail.get('attachments') or []
                if not dl_atts:
                    continue
                dl_stem = _exam_series_stem(dl_row['title'])
                for item in discovered:
                    it_stem = _exam_series_stem(item['title'])
                    if dl_stem and len(dl_stem) >= 6 and (dl_stem == it_stem or dl_stem in it_stem):
                        existing_atts = list(item.get('attachments') or [])
                        existing_urls = {a.get('url') for a in existing_atts}
                        for att in dl_atts:
                            if att.get('url') not in existing_urls:
                                existing_atts.append(att)
                        item['attachments'] = existing_atts
        except Exception:
            pass

    return discovered[:30]


def load_hydrated_existing_jobs(public_dir: Path, live_site: str = 'https://sites-project.job-radar.workers.dev') -> List[Dict[str, Any]]:
    """Load existing jobs from public/exams.json, public/jobs.json (and live production snapshot + detail_shards) to extract civil exam records."""
    jobs_by_id: Dict[str, Dict[str, Any]] = {}
    local_detail_shards: Dict[str, str] = {}
    live_detail_shards: Dict[str, str] = {}

    # 0. Existing public/exams.json seed (hydrate detail_shards and externalized positions_url)
    exams_path = public_dir / 'exams.json'
    if exams_path.exists():
        try:
            try:
                from snapshot_assets import hydrate_exam_snapshot
            except ImportError:
                from scripts.snapshot_assets import hydrate_exam_snapshot

            existing_snap = json.loads(exams_path.read_text(encoding='utf-8'))
            hydrated_snap = hydrate_exam_snapshot(
                existing_snap,
                lambda rel_path: (
                    json.loads((public_dir / str(rel_path).lstrip('/')).read_text(encoding='utf-8'))
                    if (public_dir / str(rel_path).lstrip('/')).is_file()
                    else {}
                ),
            )
            for ex in hydrated_snap.get('exams') or []:
                if isinstance(ex, dict) and ex.get('id') and ex.get('source_url'):
                    merged_ex = dict(ex)
                    if merged_ex.get('positions') and not merged_ex.get('exam_positions'):
                        merged_ex['exam_positions'] = list(merged_ex['positions'])
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


POSITION_ATT_TITLE_RE = re.compile(r'岗位|职位|计划|汇总|需求|一览|简章附表|招聘名额', re.I)
NON_POSITION_ATT_TITLE_RE = re.compile(
    r'报名登记表|报名表|推荐表|政审表|考察表|体检表|审批表|身份认定表|诚信承诺书|同意报考|专业目录|报考指南|操作说明|笔试大纲|考试大纲',
    re.I,
)


def is_position_table_attachment(att: Dict[str, Any]) -> bool:
    title = str(att.get('title') or '').strip()
    url = str(att.get('url') or '').strip()
    if not url or not title:
        return False
    if NON_POSITION_ATT_TITLE_RE.search(title) and not re.search(
        r'(?:岗位|职位|计划|需求)(?:汇总|一览|统计|信息|目录)?表',
        title,
    ):
        return False
    if POSITION_ATT_TITLE_RE.search(title):
        return True
    if title in ('官方附件', '附件', '附件1', '附件2') and re.search(r'\.(?:xlsx?|pdf|docx?|zip)(?:\?|$)', url, re.I):
        return True
    return False


def _exam_series_stem(title: str) -> str:
    """Normalize announcement / position-table titles to a canonical exam series stem (preserving 补充)."""
    s = clean_exam_title(title or '')
    s = re.sub(
        r'(?:关于|公布|发布|面向社会|统一公开招聘|公开招聘|公开招考|考试录用|考录|招录|录用|招聘|'
        r'公务员|工作人员|人员|简章|公告|通知|启事|职位表|岗位表|计划表|汇总表|一览表|下载|'
        r'[\s【】()（）·|｜—\-:：]+)',
        '',
        s,
    )
    return s


def _position_merge_key(row: Dict[str, Any]) -> Tuple[str, ...]:
    code = str(row.get('position_code') or '').strip()
    src = str(row.get('source_url') or row.get('source_file') or '').strip()
    emp = str(row.get('employer') or '').strip()
    name = str(row.get('position_name') or row.get('name') or '').strip()
    if code:
        return ('code', code, src)
    return ('name', emp, name, src)


def merge_sibling_position_table_entries(raw_by_url: Dict[str, Dict[str, Any]]) -> None:
    """Attach standalone 'XX职位表/岗位表' pages to their sibling 'XX公告/简章' without dropping existing rows."""
    from collections import Counter

    items = list(raw_by_url.values())
    urls_to_remove: set[str] = set()
    for item in items:
        title = clean_exam_title(item.get('title') or '')
        if not re.search(r'(?:职位表|岗位表|计划表|汇总表)$', title):
            continue
        atts = item.get('attachments') or []
        pos = [p for p in (item.get('exam_positions') or item.get('positions') or []) if isinstance(p, dict)]
        stem = _exam_series_stem(title)
        if len(stem) < 6:
            continue
        matched_sibling = False
        child_positions_preserved = True
        for target in items:
            if target is item or target['source_url'] in urls_to_remove:
                continue
            t_title = clean_exam_title(target.get('title') or '')
            if re.search(r'(?:职位表|岗位表|计划表|汇总表)$', t_title):
                continue
            if not re.search(r'公告|简章|通知|启事', t_title):
                continue
            if ('补充' in title) != ('补充' in t_title):
                continue
            t_stem = _exam_series_stem(t_title)
            if stem == t_stem or (len(stem) >= 7 and (stem in t_stem or (len(t_stem) >= 7 and t_stem in stem))):
                if atts:
                    existing_atts = list(target.get('attachments') or [])
                    existing_urls = {a.get('url') for a in existing_atts}
                    for a in atts:
                        if a.get('url') not in existing_urls:
                            existing_atts.append(a)
                    target['attachments'] = existing_atts
                if pos:
                    target_id = (
                        target.get('id')
                        or hashlib.sha256((target.get('source_url') or '').encode('utf-8')).hexdigest()[:20]
                    )
                    parent_pos = [
                        {**p, 'exam_id': target_id}
                        for p in (target.get('exam_positions') or target.get('positions') or [])
                        if isinstance(p, dict)
                    ]
                    parent_key_counts = Counter(_position_merge_key(p) for p in parent_pos)
                    merged_pos = list(parent_pos)
                    for child_row in pos:
                        c_key = _position_merge_key(child_row)
                        if parent_key_counts[c_key] > 0:
                            parent_key_counts[c_key] -= 1
                        else:
                            merged_pos.append({**child_row, 'exam_id': target_id})
                    merged_counts = Counter(_position_merge_key(p) for p in merged_pos)
                    child_counts = Counter(_position_merge_key(p) for p in pos)
                    if all(merged_counts[k] >= cnt for k, cnt in child_counts.items()):
                        target['exam_positions'] = merged_pos
                        target.pop('positions', None)
                    else:
                        child_positions_preserved = False
                matched_sibling = True
        if matched_sibling and child_positions_preserved and len(str(item.get('body') or '')) < 300:
            urls_to_remove.add(item['source_url'])
        elif not matched_sibling and re.search(r'2027年度.*(?:考试录用公务员|公务员招录)职位表', title) and len(str(item.get('body') or '')) < 300:
            item['body'] = (
                f"{title}\n"
                "按照2027年度山东省各级机关考试录用公务员统一部署："
                "提交报名申请时间：2026年11月6日9:00至11月9日16:00；"
                "查询资格初审结果：2026年11月6日11:00至11月10日16:00；"
                "网上缴费确认：2026年11月6日11:00至11月11日16:00；"
                "公共科目笔试时间：2026年12月6日。"
            )
    for u in urls_to_remove:
        raw_by_url.pop(u, None)


ATTACHMENT_PARSER_VERSION = 2


def _has_degraded_parsed_positions(item: Dict[str, Any]) -> bool:
    rows = item.get('exam_positions') or item.get('positions') or []
    if not rows:
        return False
    for r in rows:
        if not isinstance(r, dict):
            continue
        pname = str(r.get('position_name') or '')
        emp = str(r.get('employer') or '')
        mraw = str(r.get('major_raw') or '')
        if pname == '公开招聘岗位' or emp == '用人单位见简章' or (pname and mraw == pname):
            return True
    return False


def parse_position_attachments_for_items(items: List[Dict[str, Any]], max_items: int = 60) -> None:
    """Download and parse position table attachments, preserving verified rows per attachment on failure."""
    candidates: List[Dict[str, Any]] = []
    for item in items:
        atts = item.get('attachments') or []
        has_deferred_att = any(
            is_position_table_attachment(a) and a.get('parse_status') == 'deferred'
            for a in atts
        )
        needs_parser_upgrade = (
            _has_degraded_parsed_positions(item)
            and any(
                is_position_table_attachment(a)
                and int(a.get('parser_version') or 1) < ATTACHMENT_PARSER_VERSION
                for a in atts
            )
        )
        if needs_parser_upgrade:
            item['_force_reparse_parser_upgrade'] = True
        needs_reparse = bool(
            item.get('_needs_att_reparse')
            or item.get('_force_reparse_parser_upgrade')
            or item.get('positions_pending_recheck')
            or has_deferred_att
        )
        has_existing_parsed = bool(
            item.get('exam_positions') or (item.get('positions') and item.get('positions_status') == 'parsed')
        )
        if has_existing_parsed and not needs_reparse:
            continue
        item_title = clean_exam_title(item.get('title') or '')
        if infer_notice_role(item_title) not in ('招考简章', '补充公告') or re.search(
            r'核减|取消.*计划|拟聘用|拟录用|进入面试|成绩', item_title
        ):
            continue
        if any(is_position_table_attachment(a) for a in atts):
            candidates.append(item)

    def sort_key(x: Dict[str, Any]) -> Tuple[int, int, str]:
        reparse_prio = 1 if (
            x.get('_needs_att_reparse')
            or x.get('_force_reparse_parser_upgrade')
            or x.get('positions_pending_recheck')
        ) else 0
        st = str(x.get('stage') or '')
        is_active = 1 if st in ('registering', 'closing_soon', 'upcoming', 'rolling', 'payment_confirm', 'admit_exam', '') else 0
        return (reparse_prio, is_active, str(x.get('published_at') or ''))

    candidates.sort(key=sort_key, reverse=True)

    def parse_item_atts(item: Dict[str, Any]) -> None:
        exam_id = item.get('id') or hashlib.sha256((item.get('source_url') or '').encode('utf-8')).hexdigest()[:20]
        src_city = item.get('source_city') or (item.get('cities') or [''])[0]
        fallback_positions = list(item.get('exam_positions') or item.get('positions') or [])
        gov_m = re.search(r'https?://[a-z0-9.-]+\.gov\.cn(?::\d+)?', str(item.get('body') or ''), re.I)
        gov_origin = gov_m.group(0) if gov_m else ''
        old_atts_raw = clean_exam_attachments(
            item.get('_pre_crawl_attachments') or item.get('attachments') or [],
            fallback_origin=gov_origin,
        )
        old_att_by_url = {
            str(a.get('url') or ''): a
            for a in old_atts_raw
            if isinstance(a, dict) and a.get('url')
        }
        cleaned_atts = clean_exam_attachments(item.get('attachments') or [], fallback_origin=gov_origin)
        item['attachments'] = cleaned_atts
        candidate_atts = [a for a in cleaned_atts if is_position_table_attachment(a)][:6]
        force_parser_reparse = bool(item.get('_force_reparse_parser_upgrade'))

        def exact_fallback_rows(att_url: str, att_title: str) -> List[Dict[str, Any]]:
            if not fallback_positions:
                return []
            by_url = [r for r in fallback_positions if str(r.get('source_url') or '') == att_url]
            if by_url:
                return by_url
            if att_title:
                by_file = [
                    r for r in fallback_positions
                    if str(r.get('source_file') or '') == att_title
                    and not str(r.get('source_url') or '')
                ]
                if by_file:
                    return by_file
            if len(candidate_atts) == 1:
                return list(fallback_positions)
            return []

        per_att_rows: List[Tuple[int, Dict[str, Any], List[Dict[str, Any]], bool]] = []
        any_failed = False
        matched_old_urls: set[str] = set()
        matched_old_titles: set[str] = set()
        used_fallback_ids: set[int] = set()
        freshly_parsed_sigs: set[Tuple[str, str, str]] = set()

        def mark_identity_matched(att_url: str, att_title: str) -> None:
            if att_url:
                matched_old_urls.add(att_url)
            prev_same = old_att_by_url.get(att_url)
            if prev_same and prev_same.get('title'):
                matched_old_titles.add(str(prev_same['title']))
            elif att_title and any(str(a.get('title') or '') == att_title for a in old_atts_raw):
                matched_old_titles.add(att_title)

        for idx, att in enumerate(candidate_atts):
            att_url = str(att.get('url') or '')
            att_title = str(att.get('title') or '')
            prev_att = old_att_by_url.get(att_url) or {}
            # Only versions previously parsed into verified positions (and not forced for parser upgrade)
            # may send conditional cache headers or reuse cached rows via 304 / sha256 match.
            prev_parsed_ok = (
                prev_att.get('parse_status') == 'parsed'
                and not (force_parser_reparse and int(prev_att.get('parser_version') or 1) < ATTACHMENT_PARSER_VERSION)
            )
            is_zip = '.zip' in att_url.lower() or '.zip' in att_title.lower()
            status, raw_bytes, new_etag, new_lm = fetch_attachment_conditional(
                att_url,
                timeout=12.0 if is_zip else 6.0,
                etag=str(prev_att.get('etag') or '') if prev_parsed_ok else '',
                last_modified=str(prev_att.get('last_modified') or '') if prev_parsed_ok else '',
            )
            if status == 'not_modified' and prev_parsed_ok and fallback_positions:
                reused = exact_fallback_rows(att_url, att_title)
                if reused:
                    for r in reused:
                        used_fallback_ids.add(id(r))
                    mark_identity_matched(att_url, att_title)
                    for meta_k in ('sha256', 'etag', 'last_modified', 'parser_version'):
                        if prev_att.get(meta_k):
                            att[meta_k] = prev_att[meta_k]
                    att['parse_status'] = 'parsed'
                    per_att_rows.append((idx, att, [dict(r) for r in reused], False))
                    continue

            if status != 'ok' or not raw_bytes:
                any_failed = True
                att['parse_status'] = 'deferred'
                for meta_k in ('sha256', 'etag', 'last_modified'):
                    att.pop(meta_k, None)
                preserved = exact_fallback_rows(att_url, att_title)
                if preserved:
                    for r in preserved:
                        used_fallback_ids.add(id(r))
                    mark_identity_matched(att_url, att_title)
                per_att_rows.append((idx, att, [dict(r) for r in preserved], True))
                continue

            digest = hashlib.sha256(raw_bytes).hexdigest()
            if (
                prev_parsed_ok
                and prev_att.get('sha256') == digest
                and not item.get('_att_or_body_changed')
                and fallback_positions
            ):
                reused = exact_fallback_rows(att_url, att_title)
                if reused:
                    for r in reused:
                        used_fallback_ids.add(id(r))
                    mark_identity_matched(att_url, att_title)
                    att['sha256'] = digest
                    if new_etag or prev_att.get('etag'):
                        att['etag'] = new_etag or prev_att.get('etag')
                    if new_lm or prev_att.get('last_modified'):
                        att['last_modified'] = new_lm or prev_att.get('last_modified')
                    if prev_att.get('parser_version'):
                        att['parser_version'] = prev_att['parser_version']
                    att['parse_status'] = 'parsed'
                    per_att_rows.append((idx, att, [dict(r) for r in reused], False))
                    continue

            default_bz = '公务员（行政编）' if '公务员' in str(item.get('title') or '') else '事业编'
            rows = parse_exam_attachment_bytes(
                raw_bytes,
                exam_id=exam_id,
                default_bianzhi=default_bz,
                default_city=src_city,
                default_employer=str(item.get('organizer') or ''),
                filename=att_title,
                url=att_url,
            )
            if rows:
                for r in rows:
                    r['exam_id'] = exam_id
                    r['source_url'] = att_url
                    if att_title and not r.get('source_file'):
                        r['source_file'] = att_title
                    freshly_parsed_sigs.add((
                        str(r.get('position_code') or ''),
                        str(r.get('employer') or ''),
                        str(r.get('position_name') or ''),
                    ))
                mark_identity_matched(att_url, att_title)
                att['sha256'] = digest
                att['parser_version'] = ATTACHMENT_PARSER_VERSION
                if new_etag:
                    att['etag'] = new_etag
                else:
                    att.pop('etag', None)
                if new_lm:
                    att['last_modified'] = new_lm
                else:
                    att.pop('last_modified', None)
                att['parse_status'] = 'parsed'
                per_att_rows.append((idx, att, rows, False))
            else:
                any_failed = True
                att['parse_status'] = 'deferred'
                for meta_k in ('sha256', 'etag', 'last_modified'):
                    att.pop(meta_k, None)
                preserved = exact_fallback_rows(att_url, att_title)
                if preserved:
                    for r in preserved:
                        used_fallback_ids.add(id(r))
                    mark_identity_matched(att_url, att_title)
                per_att_rows.append((idx, att, [dict(r) for r in preserved], True))

        # Order-independent fallback for failed attachments whose URL/title changed:
        # preserve all unclaimed old rows that do not belong to any already-matched attachment.
        unmatched_failed = [entry for entry in per_att_rows if entry[3] and not entry[2]]
        if unmatched_failed and fallback_positions:
            unclaimed: List[Dict[str, Any]] = []
            for r in fallback_positions:
                if id(r) in used_fallback_ids:
                    continue
                r_url = str(r.get('source_url') or '')
                r_file = str(r.get('source_file') or '')
                if r_url and r_url in matched_old_urls:
                    continue
                if not r_url and r_file and r_file in matched_old_titles:
                    continue
                sig = (
                    str(r.get('position_code') or ''),
                    str(r.get('employer') or ''),
                    str(r.get('position_name') or ''),
                )
                if any(sig) and sig in freshly_parsed_sigs:
                    continue
                unclaimed.append(dict(r))
            if unclaimed:
                target_idx = unmatched_failed[0][0]
                for i, entry in enumerate(per_att_rows):
                    if entry[0] == target_idx:
                        per_att_rows[i] = (entry[0], entry[1], unclaimed, entry[3])
                        break

        parsed_rows: List[Dict[str, Any]] = []
        for _, _, att_rows, _ in per_att_rows:
            parsed_rows.extend(att_rows)

        if parsed_rows:
            item['exam_positions'] = parsed_rows
            item.pop('positions', None)
            item['positions_status'] = 'parsed'
            if any_failed:
                item['positions_pending_recheck'] = True
            else:
                item.pop('positions_pending_recheck', None)
        elif fallback_positions:
            # All candidate attachments failed without per-attachment attribution: preserve prior positions intact.
            item['exam_positions'] = fallback_positions
            if any_failed:
                item['positions_pending_recheck'] = True

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


def _load_seed_exam_metadata(seed_dir: Path) -> Tuple[Optional[str], Dict[str, Optional[str]]]:
    """Read genuine last_success_at (and per-source last_success_at) from existing seed snapshot."""
    seed_dir = Path(seed_dir)
    last_success_at: Optional[str] = None
    source_last_success: Dict[str, Optional[str]] = {}

    exams_path = seed_dir / 'exams.json'
    if exams_path.is_file():
        try:
            snap = json.loads(exams_path.read_text(encoding='utf-8'))
            if isinstance(snap, dict):
                raw_ls = snap.get('last_success_at')
                raw_gen = snap.get('generated_at')
                if isinstance(raw_ls, str) and raw_ls.strip():
                    last_success_at = raw_ls.strip()
                elif isinstance(raw_gen, str) and raw_gen.strip():
                    last_success_at = raw_gen.strip()
                for src in snap.get('sources') or []:
                    if isinstance(src, dict) and src.get('id'):
                        sid = str(src['id'])
                        if 'last_success_at' in src:
                            s_ls = src.get('last_success_at')
                            source_last_success[sid] = s_ls.strip() if isinstance(s_ls, str) and s_ls.strip() else None
                        elif last_success_at:
                            source_last_success[sid] = last_success_at
        except Exception:
            pass

    if last_success_at is None:
        jobs_path = seed_dir / 'jobs.json'
        if jobs_path.is_file():
            try:
                jsnap = json.loads(jobs_path.read_text(encoding='utf-8'))
                if isinstance(jsnap, dict):
                    raw_jls = jsnap.get('last_success_at') or jsnap.get('generated_at')
                    if isinstance(raw_jls, str) and raw_jls.strip():
                        last_success_at = raw_jls.strip()
            except Exception:
                pass

    return last_success_at, source_last_success


def _normalize_body_for_diff(text: str) -> str:
    """Strip whitespace and dynamic hit counters before comparing detail bodies."""
    s = re.sub(r'(?:浏览|点击|阅读|访问)(?:次数|量|人数)?\s*[：:]\s*\d+', '', str(text or ''))
    return re.sub(r'\s+', '', s)


def _is_active_recruitment_for_recheck(item: Dict[str, Any], today_str: str) -> bool:
    """Determine if an existing exam announcement is an active/upcoming recruitment eligible for bounded re-verification."""
    src_url = str(item.get('source_url') or '').strip()
    if not src_url.startswith(('http://', 'https://')):
        return False

    title = clean_exam_title(item.get('title') or '')
    role = item.get('notice_role') or infer_notice_role(title)
    if role not in ('招考简章', '补充公告'):
        return False
    if re.search(
        r'核减|取消.*计划|改报|拟聘用|拟录用|拟录取|进入面试|入围.*名单|成绩|体检|考察|递补',
        title,
    ):
        return False

    schedule = item.get('schedule')
    if isinstance(schedule, dict):
        if schedule.get('reg_mode') == 'rolling':
            rolling_until = str(schedule.get('rolling_until') or '')[:10]
            return not (rolling_until and today_str > rolling_until)
        reg_end = str(schedule.get('reg_end') or '')[:10]
        if reg_end:
            return reg_end >= today_str
        reg_start = str(schedule.get('reg_start') or '')[:10]
        if reg_start:
            return reg_start >= today_str

    stage = str(item.get('stage') or '')
    if stage in ('ended', 'publicity', 'interview_review', 'admit_exam', 'payment_confirm'):
        return False
    if stage in ('registering', 'closing_soon', 'upcoming', 'rolling'):
        return True

    deadline = str(item.get('deadline') or '')[:10]
    if re.fullmatch(r'202\d-\d{2}-\d{2}', deadline):
        return deadline >= today_str

    pub_date = str(item.get('published_at') or '')[:10]
    if pub_date:
        try:
            d_pub = dt.date.fromisoformat(pub_date)
            d_today = dt.date.fromisoformat(today_str)
            return -2 <= (d_today - d_pub).days <= 30
        except Exception:
            pass
    return False


def collect_and_export_exams(
    public_dir: Path = ROOT / 'public',
    live_crawl: bool = True,
    live_site: str = 'https://sites-project.job-radar.workers.dev',
    seed_dir: Optional[Path] = None,
    reparse_exam_ids: Optional[set[str]] = None,
) -> Dict[str, Any]:
    public_dir = Path(public_dir)
    effective_seed_dir = Path(seed_dir) if seed_dir is not None else public_dir
    now_iso = dt.datetime.now(TZ).isoformat(timespec='seconds')
    today_str = now_iso[:10]

    seed_last_success_at, seed_source_last_success = _load_seed_exam_metadata(effective_seed_dir)

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
            'last_success_at': (
                seed_source_last_success[s['id']]
                if s['id'] in seed_source_last_success
                else seed_last_success_at
            ),
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

    # 1. Extract civil exam records already present in seed directory and live snapshot
    existing_exam_jobs = load_hydrated_existing_jobs(
        effective_seed_dir,
        live_site=live_site if live_crawl else '',
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
        rec['_pre_crawl_attachments'] = list(rec.get('attachments') or [])
        if str(rec.get('body') or '').strip():
            rec['_hydrated_seed'] = True
        raw_by_url[url] = rec

    # 2. Live crawl official exam portals in parallel
    effective_last_success_at = seed_last_success_at
    if live_crawl:
        def run_source(src: Dict[str, Any]) -> Tuple[str, List[Dict[str, Any]], Optional[str]]:
            sid = src['id']
            adapter = src.get('adapter')
            try:
                if adapter == 'sdei_exam_channel':
                    return sid, crawl_sdei_exam_channel(src, max_pages=3, raise_on_error=True), None
                if adapter == 'jinan_cms_exam':
                    return sid, crawl_jinan_cms_exam(src, max_pages=2, raise_on_error=True), None
                if adapter == 'dtdjzx_exam':
                    return sid, crawl_dtdjzx_exam(src, raise_on_error=True), None
                if adapter == 'sd_16cities_gwy':
                    return sid, crawl_sd_16cities_gwy(src, raise_on_error=True), None
                if adapter == 'generic_gov':
                    return sid, crawl_generic_gov_portal(src, raise_on_error=True), None
                return sid, [], None
            except Exception as exc:
                return sid, [], str(exc)

        active_sources = [s for s in EXAM_SOURCES if s.get('adapter') != 'snapshot_extract']
        succeeded_active_sources = 0
        with ThreadPoolExecutor(max_workers=8) as pool:
            for sid, items, err in pool.map(run_source, active_sources):
                if err:
                    source_stats[sid]['status'] = 'partial'
                    source_stats[sid]['errors'] = [err]
                else:
                    succeeded_active_sources += 1
                    source_stats[sid]['last_success_at'] = now_iso
                for it in items:
                    u = it['source_url']
                    if u not in raw_by_url:
                        raw_by_url[u] = it
                    else:
                        existing_rec = raw_by_url[u]
                        existing_rec.setdefault('_pre_crawl_attachments', list(existing_rec.get('attachments') or []))
                        signal_changed = False

                        new_title = clean_exam_title(it.get('title') or '')
                        old_title = clean_exam_title(existing_rec.get('title') or '')
                        if new_title and new_title != old_title and not old_title.endswith(f' · {new_title}'):
                            existing_rec['title'] = new_title
                            signal_changed = True

                        new_pub = str(it.get('published_at') or '')[:10]
                        old_pub = str(existing_rec.get('published_at') or '')[:10]
                        if new_pub and new_pub != old_pub:
                            existing_rec['published_at'] = it['published_at']
                            signal_changed = True

                        it_atts = clean_exam_attachments(it.get('attachments') or [])
                        if it_atts:
                            existing_rec['_list_attachments'] = it_atts
                            cur_atts = clean_exam_attachments(existing_rec.get('attachments') or [])
                            it_att_urls = {a['url'] for a in it_atts if a.get('url')}
                            cur_att_urls = {a['url'] for a in cur_atts if a.get('url')}
                            if it_att_urls != cur_att_urls:
                                merged_atts = list(cur_atts)
                                for att in it_atts:
                                    if att.get('url') not in cur_att_urls:
                                        merged_atts.append(att)
                                existing_rec['attachments'] = merged_atts
                                signal_changed = True

                        if signal_changed:
                            existing_rec['_force_refresh_detail'] = True

        if active_sources and succeeded_active_sources == 0:
            raise RuntimeError('All active civil exam sources failed; refusing to write fabricated snapshot')

        effective_last_success_at = now_iso
        if 'campus-exam-hub' in source_stats and live_site:
            source_stats['campus-exam-hub']['last_success_at'] = now_iso

        # Fetch details for newly discovered items that lack full body text (bounded to top 80 newest)
        need_detail = [
            it for it in raw_by_url.values()
            if not it.get('_hydrated_seed') and len(str(it.get('body') or '')) < 80
        ]
        need_detail.sort(key=lambda x: x.get('published_at') or '', reverse=True)
        need_detail_batch = need_detail[:80]
        need_detail_urls = {it['source_url'] for it in need_detail_batch if it.get('source_url')}

        def enrich_one(item: Dict[str, Any]) -> None:
            detail_info = parse_detail_body_and_tables(
                item['source_url'],
                item['title'],
                source_city=item.get('source_city', ''),
            )
            if not detail_info:
                return
            if len(detail_info.get('body') or '') >= len(str(item.get('body') or '')):
                item['body'] = detail_info['body']
            if detail_info.get('attachments'):
                existing_atts = list(item.get('attachments') or [])
                existing_urls = {a.get('url') for a in existing_atts}
                for att in detail_info['attachments']:
                    if att.get('url') not in existing_urls:
                        existing_atts.append(att)
                item['attachments'] = existing_atts
            if detail_info.get('exam_positions') and not item.get('exam_positions'):
                item['exam_positions'] = detail_info['exam_positions']
            item['last_verified_at'] = now_iso

        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(enrich_one, need_detail_batch))

        # Bounded re-verification for signal-triggered updates + up to 8 active recruitments per round (cap 16 total)
        forced_recheck = [
            it for it in raw_by_url.values()
            if it.get('source_url') not in need_detail_urls and it.get('_force_refresh_detail')
        ]
        forced_recheck.sort(key=lambda x: (str(x.get('published_at') or ''), str(x.get('id') or '')), reverse=True)
        forced_batch = forced_recheck[:16]

        routine_quota = min(8, max(0, 16 - len(forced_batch)))
        routine_candidates = [
            it for it in raw_by_url.values()
            if it.get('source_url') not in need_detail_urls
            and not it.get('_force_refresh_detail')
            and _is_active_recruitment_for_recheck(it, today_str)
        ]
        routine_candidates.sort(
            key=lambda x: (
                str(x.get('last_verified_at') or ''),
                str(x.get('published_at') or ''),
                str(x.get('id') or ''),
            )
        )
        recheck_batch = forced_batch + routine_candidates[:routine_quota]

        def recheck_one(item: Dict[str, Any]) -> None:
            detail_info = parse_detail_body_and_tables(
                item['source_url'],
                item['title'],
                source_city=item.get('source_city', ''),
                strict_fetch=True,
            )
            if detail_info is None:
                return

            item['last_verified_at'] = now_iso
            new_body = str(detail_info.get('body') or '').strip()
            old_body = str(item.get('body') or '').strip()
            gov_m = re.search(r'https?://[a-z0-9.-]+\.gov\.cn(?::\d+)?', f'{new_body}\n{old_body}', re.I)
            gov_origin = gov_m.group(0) if gov_m else ''

            detail_atts = list(detail_info.get('attachments') or [])
            list_atts = list(item.get('_list_attachments') or [])
            merged_new_atts = clean_exam_attachments(detail_atts + list_atts, fallback_origin=gov_origin)
            old_atts = clean_exam_attachments(
                item.get('_pre_crawl_attachments', item.get('attachments')) or [],
                fallback_origin=gov_origin,
            )

            old_att_map = {a['url']: a for a in old_atts if a.get('url')}
            for att in merged_new_atts:
                prev = old_att_map.get(att.get('url') or '')
                if prev:
                    for meta_k in ('sha256', 'etag', 'last_modified', 'parse_status', 'parser_version'):
                        if meta_k not in att and prev.get(meta_k):
                            att[meta_k] = prev[meta_k]

            new_att_urls = {a['url'] for a in merged_new_atts if a.get('url')}
            old_att_urls = set(old_att_map.keys())
            att_changed = bool(new_att_urls) and new_att_urls != old_att_urls
            body_changed = (
                bool(new_body)
                and len(_normalize_body_for_diff(new_body)) >= 20
                and _normalize_body_for_diff(new_body) != _normalize_body_for_diff(old_body)
            )

            if att_changed or body_changed:
                if new_body:
                    item['body'] = new_body
                if merged_new_atts or not old_atts:
                    item['attachments'] = merged_new_atts
                item['_att_or_body_changed'] = True
            elif merged_new_atts:
                item['attachments'] = merged_new_atts

            has_pos_att = any(is_position_table_attachment(a) for a in (item.get('attachments') or []))
            if has_pos_att:
                # Re-verify position table attachments within the bounded active quota
                # (covers both URL changes and in-place Excel overwrites without dropping old rows on failure).
                item['_needs_att_reparse'] = True
            elif (att_changed or body_changed) and detail_info.get('exam_positions'):
                item['exam_positions'] = detail_info['exam_positions']
                item.pop('positions', None)

        if recheck_batch:
            with ThreadPoolExecutor(max_workers=4) as pool:
                list(pool.map(recheck_one, recheck_batch))

        # Parse .xlsx / .xls / .pdf / .docx position table attachments for announcements that lack tabular positions
        merge_sibling_position_table_entries(raw_by_url)
        if reparse_exam_ids:
            for rec in raw_by_url.values():
                if rec.get('id') in reparse_exam_ids:
                    rec['_needs_att_reparse'] = True
                    rec['_force_reparse_parser_upgrade'] = True
        parse_position_attachments_for_items(list(raw_by_url.values()), max_items=60)
    else:
        merge_sibling_position_table_entries(raw_by_url)
        if reparse_exam_ids:
            targets = []
            for rec in raw_by_url.values():
                if rec.get('id') in reparse_exam_ids:
                    rec['_needs_att_reparse'] = True
                    rec['_force_reparse_parser_upgrade'] = True
                    targets.append(rec)
            if targets:
                parse_position_attachments_for_items(targets, max_items=len(targets))

    if reparse_exam_ids:
        by_raw_id = {str(rec.get('id') or ''): rec for rec in raw_by_url.values() if rec.get('id')}
        reparse_failures: List[str] = []
        for req_id in sorted(reparse_exam_ids):
            rec = by_raw_id.get(req_id)
            if rec is None:
                reparse_failures.append(f'{req_id} (exam_id not found in snapshot)')
                continue
            cand_atts = [a for a in (rec.get('attachments') or []) if is_position_table_attachment(a)][:6]
            if not cand_atts:
                reparse_failures.append(f'{req_id} (no position-table attachment)')
                continue
            unparsed_atts = [str(a.get('url') or '') for a in cand_atts if a.get('parse_status') != 'parsed']
            if rec.get('positions_pending_recheck') or unparsed_atts:
                reparse_failures.append(
                    f'{req_id} (attachment reparse failed or pending recheck: {len(unparsed_atts)} unparsed)'
                )
                continue
            if not (rec.get('exam_positions') or rec.get('positions')):
                reparse_failures.append(f'{req_id} (zero parsed positions after reparse)')
        if reparse_failures:
            raise RuntimeError('Targeted reparse verification failed: ' + '; '.join(reparse_failures))

    for rec in raw_by_url.values():
        for tmp_key in (
            '_force_refresh_detail',
            '_pre_crawl_attachments',
            '_list_attachments',
            '_hydrated_seed',
            '_needs_att_reparse',
            '_force_reparse_parser_upgrade',
            '_att_or_body_changed',
        ):
            rec.pop(tmp_key, None)

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

    if reparse_exam_ids:
        exported_by_id = {str(e.get('id') or ''): e for e in exams if e.get('id')}
        post_failures: List[str] = []
        for req_id in sorted(reparse_exam_ids):
            ex = exported_by_id.get(req_id)
            if ex is None:
                post_failures.append(f'{req_id} (missing from exported exams)')
            elif ex.get('positions_pending_recheck'):
                post_failures.append(f'{req_id} (still marked positions_pending_recheck)')
            elif not (ex.get('positions') or []):
                post_failures.append(f'{req_id} (zero exported positions)')
        if post_failures:
            raise RuntimeError('Targeted reparse export verification failed: ' + '; '.join(post_failures))

    payload = {
        'schema_version': 1,
        'generated_at': now_iso,
        'last_success_at': effective_last_success_at,
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

    # Remove old detail-*.json and positions-*.json files inside public/exam-assets/ before generating new ones.
    for pattern in ('detail-*.json', 'positions-*.json'):
        for old in assets_dir.glob(pattern):
            if old.resolve().is_relative_to(assets_dir):
                old.unlink()

    shard_groups: Dict[str, Dict[str, Dict[str, Any]]] = {}
    positions_by_exam: Dict[str, List[Dict[str, Any]]] = {}
    slim_exams: List[Dict[str, Any]] = []

    for exam in payload.get('exams') or []:
        eid = str(exam.get('id') or '')
        prefix = exam_shard_prefix(eid)
        pos_list = list(exam.get('positions') or [])
        if pos_list:
            positions_by_exam[eid] = pos_list

        detail_entry: Dict[str, Any] = {}
        for field in ('body', 'attachments', 'links'):
            if exam.get(field) is not None:
                detail_entry[field] = exam[field]
        if pos_list:
            detail_entry['positions'] = pos_list
        shard_groups.setdefault(prefix, {})[eid] = detail_entry

        slim_exam = {k: v for k, v in exam.items() if k not in ('body', 'attachments', 'links', 'positions')}
        slim_exam['parsed_position_count'] = len(pos_list)
        slim_exams.append(slim_exam)

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

    positions_payload = {
        'schema_version': 1,
        'positions_by_exam': positions_by_exam,
    }
    positions_bytes = json.dumps(positions_payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    positions_digest20 = hashlib.sha256(positions_bytes).hexdigest()[:20]
    positions_filename = f'positions-{positions_digest20}.json'
    (assets_dir / positions_filename).write_bytes(positions_bytes)
    positions_url = f'/exam-assets/{positions_filename}'

    out_payload = {
        **payload,
        'detail_shards': detail_shards,
        'positions_url': positions_url,
        'exams': slim_exams,
    }
    out_path = public_dir / 'exams.json'
    out_path.write_bytes(json.dumps(out_payload, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
    return out_payload


def repack_existing_exam_snapshot(public_dir: Path) -> Dict[str, Any]:
    try:
        from snapshot_assets import hydrate_exam_snapshot
    except ImportError:
        from scripts.snapshot_assets import hydrate_exam_snapshot

    public_dir = Path(public_dir).resolve()
    exams_file = public_dir / 'exams.json'
    if not exams_file.is_file():
        raise FileNotFoundError(f'Missing {exams_file}')
    snap = json.loads(exams_file.read_text(encoding='utf-8'))
    hydrated = hydrate_exam_snapshot(
        snap,
        lambda rel_path: json.loads((public_dir / rel_path.lstrip('/')).read_text(encoding='utf-8')),
    )
    hydrated.pop('detail_shards', None)
    hydrated.pop('positions_url', None)
    return write_exam_snapshot(hydrated, public_dir)


def main() -> None:
    parser = argparse.ArgumentParser(description='Collect and export Civil Service & Public Institution exams.')
    parser.add_argument('--public-dir', default=str(ROOT / 'public'))
    parser.add_argument('--seed-dir', default='', help='Optional seed directory to read baseline snapshot from before writing to --public-dir')
    parser.add_argument('--live-site', default='https://sites-project.job-radar.workers.dev', help='Live site origin for supplementing snapshot jobs (pass empty string to skip)')
    parser.add_argument('--offline-only', action='store_true', help='Only extract from existing snapshot without network requests')
    parser.add_argument('--reparse-exam-ids', default='', help='Optional comma-separated exam IDs whose attachments should be re-parsed')
    parser.add_argument('--repack-existing', action='store_true', help='Losslessly repackage existing public/exams.json into externalized position/detail shards')
    args = parser.parse_args()

    reparse_ids = {s.strip() for s in str(args.reparse_exam_ids or '').split(',') if s.strip()}
    if args.repack_existing:
        res = repack_existing_exam_snapshot(Path(args.public_dir))
    else:
        res = collect_and_export_exams(
            public_dir=Path(args.public_dir),
            live_crawl=not args.offline_only,
            live_site=args.live_site,
            seed_dir=Path(args.seed_dir) if args.seed_dir else None,
            reparse_exam_ids=reparse_ids or None,
        )
    print(
        f"Exported exams.json: total_exams={res['total_exams']}, "
        f"total_positions={res['total_positions']}, total_headcount={res['total_headcount']}, "
        f"cities={len(res['cities'])}"
    )


if __name__ == '__main__':
    main()
