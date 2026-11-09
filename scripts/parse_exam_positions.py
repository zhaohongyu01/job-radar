"""Structured parser for Civil Service & Public Institution (考公考编) announcements and position tables."""
from __future__ import annotations

import datetime as dt
import hashlib
import io
import re
from typing import Any, Dict, List, Optional, Tuple

try:
    import openpyxl
except ImportError:
    openpyxl = None

try:
    import fitz
except ImportError:
    fitz = None

try:
    from bs4 import BeautifulSoup
except ImportError:
    BeautifulSoup = None

try:
    from city_registry import PROVINCE_CITIES, cities_in_text
except ImportError:
    from scripts.city_registry import PROVINCE_CITIES, cities_in_text

try:
    from parse_positions import (
        clean_cell,
        split_majors,
        _table_to_grid,
        parse_excel_bytes,
        parse_pdf_bytes,
        extract_positions_from_text,
    )
except ImportError:
    from scripts.parse_positions import (
        clean_cell,
        split_majors,
        _table_to_grid,
        parse_excel_bytes,
        parse_pdf_bytes,
        extract_positions_from_text,
    )

SHANDONG_CITIES = list(PROVINCE_CITIES.get('山东', []))

RANGE_SEP = r'(?:至|到|－|—|–|-|~|～|〜|起至)'
ROLLING_RE = re.compile(r'长期招聘|招满即止|招满为止|长期有效|常年招聘|常年有效|随到随审')
UNTIL_RE = re.compile(r'(?:有效期(?:至|截至|到)|自发布公告(?:之)?日起至)\s*(?:(202\d)\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日')

# Exam-specific composite column header patterns
COL_DEPARTMENT = re.compile(r'(?:主管部门|主管机关|主办单位|所属部门|上级主管部门|招录机关)', re.I)
COL_EMPLOYER = re.compile(r'(?:招聘单位|用人单位|单位名称|招考单位|聘用单位|工作单位|学校名称|医院名称|^单位$)', re.I)
COL_POS_NAME = re.compile(r'(?:岗位名称|职位名称|招聘岗位|招聘职位|需求岗位|招考职位|具体岗位|拟聘岗位|^岗位$|^职位$)', re.I)
COL_POS_CODE = re.compile(r'(?:岗位代码|职位代码|岗位编号|职位编号|岗位代号|代码)', re.I)
COL_POS_CAT = re.compile(r'(?:岗位类别|职位类别|岗位性质|岗位等级|专业技术岗位|考试类别|试卷类别|笔试类别)', re.I)
COL_BIANZHI = re.compile(r'(?:编制性质|经费形式|编制类型|经费来源|管理方式|总量控制)', re.I)
COL_COUNT = re.compile(r'(?:招聘人数|招录人数|计划人数|拟聘人数|需求人数|招聘计划|招考人数|计划数|人数|名额)', re.I)
COL_EDUCATION = re.compile(r'(?:^学历$|学历要求|文化程度|最低学历|学历层次)', re.I)
COL_DEGREE = re.compile(r'(?:^学位$|学位要求|最低学位)', re.I)
COL_EDU_DEGREE = re.compile(r'(?:学历学位|学历/学位|学历及学位)', re.I)
COL_MAJORS = re.compile(r'(?:专业要求|专业名称|所学专业|需求专业|招聘专业|专业范围|学科专业|专业目录|^专业$)', re.I)
COL_POLITICAL = re.compile(r'(?:政治面貌|党派|党员)', re.I)
COL_FRESH_GRAD = re.compile(r'(?:招聘对象|招聘范围|应届要求|生源范围|毕业生范围|基层工作经历|工作经历|人员范围)', re.I)
COL_AGE = re.compile(r'(?:年龄|年龄要求|年龄限制|出生日期)', re.I)
COL_HUKOU = re.compile(r'(?:户籍|生源地|户籍要求|生源要求)', re.I)
COL_CITY = re.compile(r'(?:工作地点|工作地|所在地区|考区|城市|地点)', re.I)
COL_SUBJECTS = re.compile(r'(?:笔试科目|考试科目|考试内容|专业科目)', re.I)
COL_RATIO = re.compile(r'(?:开考比例|比例)', re.I)
COL_PHONE = re.compile(r'(?:咨询电话|联系电话|单位电话)', re.I)
COL_NOTES = re.compile(r'(?:其他条件|其他要求|备注|其他资格条件|说明|附加条件)', re.I)

EXAM_HEADER_KEYWORD = re.compile(
    r'^(?:序号|编号|代码|主管部门|主管机关|招聘单位|用人单位|单位名称|招录机关|单位|'
    r'岗位名称|职位名称|招聘岗位|招聘职位|岗位代码|职位代码|岗位编号|岗位类别|职位类别|岗位等级|岗位性质|'
    r'经费形式|编制性质|招聘人数|招录人数|计划人数|需求人数|人数|名额|'
    r'学历|学历要求|学位|学位要求|学历学位|专业|专业要求|所学专业|需求专业|学科|'
    r'政治面貌|年龄|年龄要求|招聘对象|招聘范围|应届|基层工作经历|工作经历|户籍|生源|'
    r'开考比例|笔试科目|考试科目|工作地点|地点|其他条件|其他要求|资格条件|备注|咨询电话|联系电话)'
    r'(?:[（(【\[][^】\)】\]]{0,30}[）)】\]]|[/:：、及&+].*)?$',
    re.I,
)

CAMPUS_PORTAL_HOSTS = {
    '山东省大学生就业服务平台',
    '山东大学就业信息网',
    '南开大学就业网',
    '学生就业指导中心 代发',
    '学生就业创业指导中心',
    '招聘单位待核实',
    '未知',
    '济南市政府',
    '济南人社',
    '军队人才网',
    '官方招考主管部门',
}


def clean_exam_title(raw_title: str) -> str:
    """Normalize announcement title by stripping portal prefixes, trailing dates, and salary tags."""
    if not raw_title:
        return ''
    title = re.sub(r'\s+', ' ', str(raw_title)).strip()
    title = re.sub(r'^(?:主题[：:]\s*|招聘\s*[|｜]\s*|事业单位\s*[|｜]\s*)', '', title)
    title = re.sub(r'\s*日期[：:]?\s*$', '', title)
    title = re.sub(r'\s+\d{3,6}\s*[-~—至]\s*\d{3,6}\s*元(?:/月|·\d+薪)?\s*$', '', title)
    title = re.sub(r'\*+$', '', title).strip()
    return title


def extract_exam_organizer(title: str, raw_company: str = '', body: str = '', source_name: str = '') -> str:
    """Extract the true recruiting authority or institution from announcement title and body."""
    cleaned_title = clean_exam_title(title)
    comp = re.sub(r'\s+', ' ', (raw_company or '')).strip()

    # 1. National / Provincial / Military canonical authorities
    if re.search(r'中央机关及其直属机构.*考试录用公务员', cleaned_title):
        return '国家公务员局'
    if re.search(r'山东省.*选拔录用选调生', cleaned_title):
        return '中共山东省委组织部'
    if re.search(r'山东省.*三支一扶', cleaned_title):
        return '山东省人力资源和社会保障厅'
    if '北部战区陆军' in cleaned_title:
        return '北部战区陆军'
    for theater in ('北部战区', '南部战区', '东部战区', '西部战区', '中部战区'):
        if theater in cleaned_title:
            return theater
    if '火箭军' in cleaned_title:
        return '中国人民解放军火箭军'
    if '武警部队' in cleaned_title:
        return '中国人民武装警察部队'
    if '联勤保障部队' in cleaned_title:
        return '联勤保障部队'
    if '军事科学院' in cleaned_title:
        return '中国人民解放军军事科学院'
    m_nudt = re.search(r'(国防科技大学[\u4e00-\u9fa5]{0,12}?(?:学院)?)', cleaned_title)
    if m_nudt:
        return m_nudt.group(1)
    if re.search(r'(?:^|共\d+人[！!]?)陆军.*文职', cleaned_title):
        return '中国人民解放军陆军'
    if re.search(r'(?:^|共\d+人[！!]?)空军.*(?:文职|人才)', cleaned_title):
        return '中国人民解放军空军'
    if re.search(r'(?:^|共\d+人[！!]?)海军.*文职', cleaned_title):
        return '中国人民解放军海军'
    if re.search(r'军队文职人员公开招考', cleaned_title):
        return '中央军委政治工作部'

    # 2. Extract explicit organization from title
    stripped = re.sub(
        r'^(?:【[^】]+】\s*)?(?:重磅[！!]?\s*|正在报名中[！!]?\s*)?(?:共?\d+人[！!]*\s*|快来报名[！!]?\s*|不要错过[！!]?\s*)?(?:202\d年(?:度|下半年|上半年)?\s*)?',
        '',
        cleaned_title,
    ).strip()

    org_m = re.match(
        r'^([\u4e00-\u9fa5（）()]{2,30}?(?:'
        r'人力资源和社会保障厅|人力资源和社会保障局|人社厅|人社局|委员会组织部|市委组织部|县委组织部|区委组织部|'
        r'教育厅|教育和体育局|教育体育局|教育局|卫生健康委员会|卫生健康局|卫健委|卫健局|'
        r'自然资源和规划局|应急管理局|国资委|文化和旅游厅|文化和旅游局|体育局|司法局|退役军人事务局|税务局|'
        r'出入境边防检查总站|水利委员会[\u4e00-\u9fa5]{2,12}(?:院|所|局)|'
        r'科学研究院[\u4e00-\u9fa5]{2,14}(?:院|所)|研究院[\u4e00-\u9fa5]{0,8}(?:分院|院|所)?|科学院[\u4e00-\u9fa5]{0,14}(?:所|院)?|'
        r'党校（[\u4e00-\u9fa5]+）|党校|大学城管委会|'
        r'大学(?:[\u4e00-\u9fa5]{0,8}?(?:附属)?[\u4e00-\u9fa5]{2,12}?(?:医院|学院|研究院|学校|中学|小学))?|'
        r'学院附属[\u4e00-\u9fa5]{2,10}|学院|技师学院|高等专科学校|专科学校|学校|中学|小学|幼儿园|'
        r'医院(?:[\u4e00-\u9fa5]{2,8}?医院)?|妇幼保健院|医疗中心|临床中心|精神卫生中心|保健院|广播电视台|实验室|交流服务中心|服务中心|管委会'
        r'))',
        stripped,
    )
    if org_m:
        cand = org_m.group(1)
        if not any(w in cand for w in ('这家', '这些', '这个', '这两家', '公开招聘', '招聘', '招考', '选聘', '遴选', '引进')):
            return cand

    # County/Municipal system patterns in title (e.g. 2026年阳谷县事业单位..., 2026年邹平市教育系统..., 2026年寿光市卫健系统...)
    sys_edu = re.search(
        r'(?:202\d年[度]?)?(?:山东省)?([\u4e00-\u9fa5]{2,14}?(?:市|县|区|高新区|起步区|开发区))(?:市属|市直|区属|县属)?(?:教育系统|教育体育系统|教育类|公开招聘教师)',
        cleaned_title,
    )
    if sys_edu:
        return f'{sys_edu.group(1)}教育和体育局'

    sys_med = re.search(
        r'(?:202\d年[度]?)?(?:山东省)?([\u4e00-\u9fa5]{2,14}?(?:市|县|区|高新区|起步区|开发区))(?:市属|市直|区属|县属)?(?:卫生健康系统|卫健系统|医疗卫生|卫生类|卫生事业单位)',
        cleaned_title,
    )
    if sys_med:
        return f'{sys_med.group(1)}卫生健康局'

    sys_sydw = re.search(
        r'(?:202\d年[度]?)?(?:山东省)?([\u4e00-\u9fa5]{2,14}?(?:市|县|区|高新区|起步区|开发区))(?:市属|市直|区属|县属|部分)?事业单位',
        cleaned_title,
    )
    if sys_sydw and not any(w in sys_sydw.group(1) for w in ('这家', '这些', '这个', '省属')):
        place = sys_sydw.group(1)
        if place in ('山东省', '山东'):
            return '山东省人力资源和社会保障厅'
        return f'{place}人力资源和社会保障局'

    # 3. Extract from body intro for clickbait titles ("14人！这家驻济省属事业单位公开招聘了")
    if body:
        head_text = re.sub(r'\s+', ' ', body[:600]).strip()
        intro_patterns = [
            r'(?:招聘单位简介|单位简介|学校简介|学院简介|医院简介|简介)\s*([\u4e00-\u9fa5（）()]{2,28}?(?:(?:大学|学院)(?:[\u4e00-\u9fa5]{0,4}?附属[\u4e00-\u9fa5]{2,12}?(?:医院|小学|中学|学校))?|技师学院|医院|研究院|研究所|科学院|精神卫生中心|公共卫生临床中心|开发局|广播电视台|学校|小学|中学|保健院))',
            r'一、([\u4e00-\u9fa5]{2,20}?(?:大学|学院|医院|研究院|科学院|广播电视台|中心|局))简介',
            r'(?:现将|根据)\s*([\u4e00-\u9fa5（）()]{2,24}?(?:大学|学院|医院|研究院|研究所|科学院|交流服务中心|公共卫生临床中心|保健院|卫生健康委员会|卫生健康局|教育和体育局|教育局|管委会))(?:所属[\u4e00-\u9fa5（）()]{1,10})?\s*(?:公开招聘|人员空缺|202\d)',
            r'^\s*(?:202\d年[度]?)?\s*([\u4e00-\u9fa5（）()]{2,24}?(?:(?:大学|学院)(?:[\u4e00-\u9fa5]{0,4}?附属[\u4e00-\u9fa5]{2,12}?(?:医院|小学|中学|学校))?|技师学院|医院|妇幼保健院|公共卫生临床中心|精神卫生中心|广播电视台|教育和体育局|教育局|卫生健康委员会|卫生健康局|管委会|教育系统|卫健系统|学校|中心))\s*(?:是|为|坐落|位于|创建于|始建于|成立于|202\d年|所属|第二次|教育系统|卫健系统|公开招聘|本次计划|拟公开)',
        ]
        for pat in intro_patterns:
            m = re.search(pat, head_text)
            if m:
                cand = m.group(1).strip()
                cand = re.sub(r'^(?:根据|现将|202\d年[度]?)', '', cand).strip()
                if cand.endswith('教育系统'):
                    cand = cand[:-4] + '教育和体育局'
                elif cand.endswith('卫健系统'):
                    cand = cand[:-4] + '卫生健康局'
                if 4 <= len(cand) <= 30 and not any(w in cand for w in ('这家', '这些', '这个')):
                    return cand

    # 4. Validate raw_company (reject campus forwarding portals when title doesn't match them)
    if (
        comp
        and comp not in CAMPUS_PORTAL_HOSTS
        and comp != cleaned_title
        and not comp.endswith('公')
        and len(comp) <= 32
    ):
        # If raw_company is a university name, only trust it if the title actually refers to that university
        if re.search(r'大学|学院', comp) and comp[:4] not in cleaned_title and '附属' not in cleaned_title:
            pass
        else:
            return comp

    src_prefix = (source_name or '').split(' · ')[0].strip()
    if src_prefix and src_prefix not in CAMPUS_PORTAL_HOSTS:
        return src_prefix
    return '山东省人力资源和社会保障厅' if '山东' in cleaned_title or '省属' in cleaned_title else '官方招考主管部门'


def infer_bianzhi_types(title: str, text: str = '') -> List[str]:
    combined = f'{title}\n{text[:3000]}'
    types: List[str] = []
    if re.search(r'选调生|选调应届|优选选调|常规选调', combined):
        types.append('选调生')
    if re.search(r'考试录用公务员|公务员招录|公务员考试|中央机关及其直属机构|公开遴选公务员|选调公务员|行政编', combined):
        types.append('公务员（行政编）')
    if re.search(r'参照公务员法|参公管理|参公单位', combined):
        types.append('参公管理')
    if re.search(r'军队文职|文职人员|部队文职|战区.*文职', combined):
        types.append('军队文职')
    if re.search(r'三支一扶|西部计划|社区工作者|城乡社区|网格员|特岗教师|基层服务', combined):
        types.append('三支一扶 / 基层项目')
    if re.search(r'控制总量|人员控制总量|备案制|员额制', combined):
        types.append('控制总量 / 备案制')
    if re.search(r'中小学.*教师|幼儿园.*教师|教育系统.*公开招聘|教体局.*招聘|公开招聘.*教师|教师公开招聘|公费师范', combined):
        types.append('教师编')
    if re.search(r'卫生健康|卫健|医院.*公开招聘|医疗卫生|妇幼保健|疾控中心|医共体', combined):
        types.append('医疗卫生编')
    if re.search(r'引进.*人才|青年人才|急需紧缺人才|高层次人才|优才计划|硕博优选|人才直通车', combined):
        types.append('高层次 / 紧缺人才')
    if re.search(r'事业单位|事业编|全额拨款|差额补贴|财政拨款|省属事业|市属事业', combined) or not types:
        if '事业编' not in types:
            types.append('事业编')
    return types


def infer_exam_category(title: str, text: str = '') -> str:
    combined = f'{title}\n{text[:1500]}'
    if re.search(r'中央机关及其直属机构|国家公务员|国考', combined):
        return '公务员国考'
    if re.search(r'选调生|选调应届优秀|鲁选|青年人才选调', title):
        return '选调生招录'
    if re.search(r'考试录用公务员|省级机关及其直属机构|省考|公务员招考|公开遴选公务员|选调公务员', combined):
        return '公务员省考'
    if re.search(r'军队文职|公开招考.*文职人员|战区.*文职|文职方阵|直接引进文职人员', combined):
        return '军队文职招考'
    if re.search(r'三支一扶|西部计划|社区工作者|网格员|特岗教师', combined):
        return '三支一扶 / 基层'
    if re.search(r'初级综合类|统一公开招聘|事业单位统考|省属事业单位公开招聘', title):
        return '事业单位统考'
    if re.search(r'教育系统|教体局|教育和体育局|中小学教师|幼儿教师|公开招聘.*教师|教师招考|公费师范|附属小学|附属学校', title):
        return '教师公开招聘'
    if re.search(r'卫健|卫生健康|医院|医疗卫生|妇幼保健|疾控|中医药|公共卫生|精神卫生|荣军优抚', title):
        return '医疗卫生招聘'
    if re.search(r'大学|学院|研究院|科学院|科研院所|技师学院|党校', title) and not re.search(r'毕业生|直通名校', title):
        return '高校 / 科研院所'
    if re.search(r'引进.*人才|青年人才|急需紧缺|优才|高层次人才|人才引进|硕博', title):
        return '人才引进 / 优才'
    return '事业单位单招'


def infer_notice_role(title: str) -> str:
    if re.search(r'报名人数|报名情况|核减|取消.*计划|改报', title):
        return '报名统计'
    if re.search(r'准考证|笔试通知|笔试安排|笔试时间|笔试考点|笔试温馨', title):
        return '准考证/笔试'
    if re.search(r'成绩查询|笔试成绩|综合成绩|面试成绩|合格分数线|进入面试范围|入围人员名单', title):
        return '成绩/进面'
    if re.search(r'资格审查|资格复审|面试通知|面试安排|面试时间|面试有关事宜|面谈', title):
        return '资格复审/面试'
    if re.search(r'体检|考察|政审|递补|拟聘用|拟录用|拟录取|公示', title):
        return '体检/递补/公示'
    if re.search(r'补充公告|更正公告|延期|延长报名', title):
        return '补充公告'
    return '招考简章'


def _normalize_cn_date(year_str: str, month_str: str, day_str: str) -> Optional[str]:
    try:
        y = int(year_str)
        m = int(month_str)
        d = int(day_str)
        if 2024 <= y <= 2030 and 1 <= m <= 12 and 1 <= d <= 31:
            return f'{y:04d}-{m:02d}-{d:02d}'
    except Exception:
        pass
    return None


def extract_exam_schedule(text: str, published_at: Optional[str] = None) -> Dict[str, Any]:
    """Extract registration start/end, qualification audit, payment confirmation, admit card, and written exam dates."""
    default_year = (published_at or '')[:4]
    if not re.fullmatch(r'202\d', default_year):
        default_year = str(dt.datetime.now().year)

    schedule: Dict[str, Any] = {
        'reg_start': None,
        'reg_end': None,
        'audit_end': None,
        'payment_end': None,
        'admit_card_start': None,
        'written_exam_date': None,
        'interview_date': None,
        'reg_mode': 'window',
        'rolling_until': None,
        'raw_evidence': [],
    }
    explicit_reg_range = False

    # Split on both line breaks and Chinese sentence punctuation so space-collapsed bodies still parse cleanly
    segments = [
        re.sub(r'\s+', ' ', seg).strip()
        for seg in re.split(r'[\r\n。；;！!]+', text or '')
        if seg and seg.strip()
    ]
    for line in segments:
        if any(k in line for k in ('报名时间', '网上报名', '报名起止', '查询时间', '初审时间', '资格初审', '缴费时间', '网上缴费', '准考证', '笔试时间')):
            if 8 <= len(line) <= 160 and len(schedule['raw_evidence']) < 6 and line not in schedule['raw_evidence']:
                schedule['raw_evidence'].append(line)

        # 1. Registration window: e.g. 报名时间：2026年3月18日9:00—3月22日16:00 or 2026年11月10日至2026年11月14日
        if not schedule['reg_end'] and re.search(r'报名时间|网上报名|报名起止|报名期限|报名方式及时间', line):
            range_m = re.search(
                rf'(?:(202\d)\s*年\s*)?(\d{{1,2}})\s*月\s*(\d{{1,2}})\s*日(?:\s*\d{{1,2}}[：:时]\d{{0,2}}分?)?\s*{RANGE_SEP}\s*(?:(202\d)\s*年\s*)?(?:(\d{{1,2}})\s*月\s*)?(\d{{1,2}})\s*日',
                line,
            )
            if range_m:
                y1 = range_m.group(1) or default_year
                m1 = range_m.group(2)
                d1 = range_m.group(3)
                y2 = range_m.group(4) or y1
                m2 = range_m.group(5) or m1
                d2 = range_m.group(6)
                schedule['reg_start'] = _normalize_cn_date(y1, m1, d1)
                schedule['reg_end'] = _normalize_cn_date(y2, m2, d2)
                explicit_reg_range = True
            else:
                iso_m = re.findall(r'(202\d)[-.](\d{1,2})[-.](\d{1,2})', line)
                if len(iso_m) >= 2:
                    schedule['reg_start'] = _normalize_cn_date(*iso_m[0])
                    schedule['reg_end'] = _normalize_cn_date(*iso_m[1])
                    explicit_reg_range = True
                elif len(iso_m) == 1 and re.search(r'截止|截至|前', line):
                    schedule['reg_end'] = _normalize_cn_date(*iso_m[0])
                else:
                    single_cn = re.search(r'(?:截止|截至)[^0-9]{0,8}?(?:(202\d)\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日', line)
                    if single_cn:
                        schedule['reg_end'] = _normalize_cn_date(
                            single_cn.group(1) or default_year,
                            single_cn.group(2),
                            single_cn.group(3),
                        )

        # 2. Audit window
        if not schedule['audit_end'] and re.search(r'查询时间|资格初审|初审时间', line):
            dates = re.findall(r'(?:(202\d)\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日', line)
            if dates:
                last = dates[-1]
                schedule['audit_end'] = _normalize_cn_date(last[0] or default_year, last[1], last[2])

        # 3. Payment window
        if not schedule['payment_end'] and re.search(r'缴费时间|网上缴费|报名确认|缴费截止', line):
            dates = re.findall(r'(?:(202\d)\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日', line)
            if dates:
                last = dates[-1]
                schedule['payment_end'] = _normalize_cn_date(last[0] or default_year, last[1], last[2])

        # 4. Admit card printing
        if not schedule['admit_card_start'] and re.search(r'准考证.*打印|打印准考证|领取准考证', line):
            dates = re.findall(r'(?:(202\d)\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日', line)
            if dates:
                first = dates[0]
                schedule['admit_card_start'] = _normalize_cn_date(first[0] or default_year, first[1], first[2])

        # 5. Written exam date
        if not schedule['written_exam_date'] and re.search(r'笔试时间|笔试定于|统一笔试', line):
            dates = re.findall(r'(?:(202\d)\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日', line)
            if dates:
                first = dates[0]
                schedule['written_exam_date'] = _normalize_cn_date(first[0] or default_year, first[1], first[2])

    if ROLLING_RE.search(text or ''):
        schedule['reg_mode'] = 'rolling'
        until_m = UNTIL_RE.search(text or '')
        if until_m:
            schedule['rolling_until'] = _normalize_cn_date(
                until_m.group(1) or default_year,
                until_m.group(2),
                until_m.group(3),
            )
        if not explicit_reg_range:
            schedule['reg_end'] = None
    else:
        schedule['reg_mode'] = 'window'

    return schedule


def extract_exam_subjects(title: str, text: str) -> List[str]:
    combined = f'{title}\n{text[:5000]}'
    subjects: List[str] = []
    rules = [
        ('行测', r'行政职业能力测验|行测'),
        ('申论', r'申论'),
        ('公基', r'公共基础知识|公基'),
        ('职测', r'职业能力倾向测验|职测'),
        ('综应', r'综合应用能力|综应'),
        ('综合写作', r'综合写作|公文写作|材料写作'),
        ('教基/教学', r'教育基础知识|教育理论|教材教法|试讲|说课'),
        ('医基/临床', r'医药卫生|医学基础知识|卫生专业知识|临床医学|护理学专业知识'),
        ('专业科目', r'专业知识|专业科目考试|专业能力测试'),
        ('直接面试/面谈', r'免笔试|直接面试|直接考核|面谈方式'),
    ]
    for label, pat in rules:
        if re.search(pat, combined):
            subjects.append(label)
    if not subjects:
        if '公务员' in combined or '选调' in combined:
            subjects = ['行测', '申论']
        elif '教师' in title or '教育' in title:
            subjects = ['公基', '教基/教学']
        elif '医院' in title or '卫健' in title or '医疗' in title or '卫生' in title:
            subjects = ['公基', '医基/临床']
        else:
            subjects = ['公基', '综合写作']
    return subjects[:4]


def parse_exam_table_grid(
    grid: List[List[str]],
    exam_id: str,
    default_bianzhi: str = '事业编',
    default_city: str = '',
    default_employer: str = '',
) -> List[Dict[str, Any]]:
    """Parse a 2D table grid from an exam announcement or XLSX/PDF attachment into ExamPositionRow items."""
    if not grid or len(grid) < 2:
        return []

    def is_header_row(cells: List[str]) -> bool:
        non_empty = [clean_cell(c) for c in cells if clean_cell(c)]
        if len(non_empty) < 2:
            return False
        hits = sum(
            1
            for c in non_empty
            if EXAM_HEADER_KEYWORD.fullmatch(c)
            or COL_POS_NAME.search(c)
            or COL_MAJORS.search(c)
            or COL_EMPLOYER.search(c)
            or COL_COUNT.search(c)
            or COL_EDUCATION.search(c)
        )
        return hits >= 2 and hits >= len(non_empty) // 2 and all(len(c) <= 45 for c in non_empty)

    best_header: Optional[Tuple[int, int, int, Dict[str, int]]] = None
    for start_r in range(min(10, len(grid))):
        for depth in (1, 2, 3):
            if start_r + depth > len(grid):
                continue
            if not all(is_header_row(grid[r]) for r in range(start_r, start_r + depth)):
                continue
            max_cols = max(len(grid[r]) for r in range(start_r, start_r + depth))
            composite: List[str] = []
            for c_idx in range(max_cols):
                parts = []
                for r_idx in range(start_r, start_r + depth):
                    if c_idx < len(grid[r_idx]):
                        val = clean_cell(grid[r_idx][c_idx])
                        if val and val not in parts:
                            parts.append(val)
                composite.append(' '.join(parts))

            mapping: Dict[str, int] = {}
            for c_idx, cell in enumerate(composite):
                if not cell:
                    continue
                if 'department' not in mapping and COL_DEPARTMENT.search(cell):
                    mapping['department'] = c_idx
                elif 'employer' not in mapping and COL_EMPLOYER.search(cell):
                    mapping['employer'] = c_idx
                elif 'position_name' not in mapping and COL_POS_NAME.search(cell):
                    mapping['position_name'] = c_idx
                elif 'position_code' not in mapping and COL_POS_CODE.search(cell):
                    mapping['position_code'] = c_idx
                elif 'position_category' not in mapping and COL_POS_CAT.search(cell):
                    mapping['position_category'] = c_idx
                elif 'bianzhi' not in mapping and COL_BIANZHI.search(cell):
                    mapping['bianzhi'] = c_idx
                elif 'recruit_count' not in mapping and COL_COUNT.search(cell):
                    mapping['recruit_count'] = c_idx
                elif 'edu_degree' not in mapping and COL_EDU_DEGREE.search(cell):
                    mapping['edu_degree'] = c_idx
                elif 'education' not in mapping and COL_EDUCATION.search(cell):
                    mapping['education'] = c_idx
                elif 'degree' not in mapping and COL_DEGREE.search(cell):
                    mapping['degree'] = c_idx
                elif 'majors' not in mapping and COL_MAJORS.search(cell):
                    mapping['majors'] = c_idx
                elif 'political' not in mapping and COL_POLITICAL.search(cell):
                    mapping['political'] = c_idx
                elif 'fresh_grad' not in mapping and COL_FRESH_GRAD.search(cell):
                    mapping['fresh_grad'] = c_idx
                elif 'age' not in mapping and COL_AGE.search(cell):
                    mapping['age'] = c_idx
                elif 'hukou' not in mapping and COL_HUKOU.search(cell):
                    mapping['hukou'] = c_idx
                elif 'city' not in mapping and COL_CITY.search(cell):
                    mapping['city'] = c_idx
                elif 'subjects' not in mapping and COL_SUBJECTS.search(cell):
                    mapping['subjects'] = c_idx
                elif 'ratio' not in mapping and COL_RATIO.search(cell):
                    mapping['ratio'] = c_idx
                elif 'phone' not in mapping and COL_PHONE.search(cell):
                    mapping['phone'] = c_idx
                elif 'notes' not in mapping and COL_NOTES.search(cell):
                    mapping['notes'] = c_idx

            if ('position_name' in mapping or 'majors' in mapping or 'employer' in mapping) and len(mapping) >= 2:
                score = len(mapping) * 10 + depth
                if best_header is None or score > best_header[0]:
                    best_header = (score, start_r, depth, mapping)

    if not best_header:
        return []

    _, start_r, depth, col = best_header
    data_start = start_r + depth
    rows_out: List[Dict[str, Any]] = []

    def get_col(row: List[str], key: str) -> str:
        idx = col.get(key)
        if idx is None or idx >= len(row):
            return ''
        return clean_cell(row[idx])

    for r_idx in range(data_start, len(grid)):
        row = grid[r_idx]
        if not row or all(not clean_cell(c) for c in row):
            continue
        pos_name = get_col(row, 'position_name')
        employer = get_col(row, 'employer') or default_employer
        department = get_col(row, 'department') or employer
        major_raw = get_col(row, 'majors')

        # Skip summary/total/note rows
        first_non_empty = next((clean_cell(c) for c in row if clean_cell(c)), '')
        if re.search(r'^(?:合计|总计|小计|汇总|注[：:]|说明[：:]|填表说明)', first_non_empty) or re.search(
            r'^(?:合计|总计|小计|汇总|注[：:])', pos_name or employer or department
        ):
            continue
        if not pos_name and not major_raw and not get_col(row, 'employer'):
            continue

        edu = get_col(row, 'education') or get_col(row, 'edu_degree') or ''
        deg = get_col(row, 'degree')
        if not deg and '学位' in edu:
            deg = edu

        raw_count = get_col(row, 'recruit_count')
        count_m = re.search(r'(\d+)', raw_count)
        recruit_count: Optional[int] = int(count_m.group(1)) if count_m else None
        if recruit_count is not None and (recruit_count <= 0 or recruit_count > 5000):
            recruit_count = None

        city_val = get_col(row, 'city') or default_city
        if not city_val:
            detected_cities = cities_in_text(f'{department} {employer} {pos_name}', infer_counties=True)
            if detected_cities:
                city_val = detected_cities[0]

        raw_bz = get_col(row, 'bianzhi')
        bz = default_bianzhi
        if raw_bz:
            if '控制总量' in raw_bz or '备案' in raw_bz:
                bz = '控制总量 / 备案制'
            elif '参公' in raw_bz:
                bz = '参公管理'
            elif '行政' in raw_bz or '公务员' in raw_bz:
                bz = '公务员（行政编）'

        employer_val = employer or department or '用人单位见简章'
        pos_name_val = pos_name or get_col(row, 'position_category') or '公开招聘岗位'
        pos_code_val = get_col(row, 'position_code')
        row_id = compute_position_row_id(exam_id, pos_code_val, employer_val, pos_name_val)

        rows_out.append({
            'row_id': row_id,
            'exam_id': exam_id,
            'department': department or employer or '招考主管部门',
            'employer': employer_val,
            'position_name': pos_name_val,
            'position_code': pos_code_val,
            'position_category': get_col(row, 'position_category'),
            'bianzhi': bz,
            'recruit_count': recruit_count,
            'city': city_val or '',
            'education': edu,
            'degree': deg or '',
            'majors': split_majors(major_raw) if major_raw else [],
            'major_raw': major_raw or '',
            'political_status': get_col(row, 'political') or '',
            'fresh_grad_rule': get_col(row, 'fresh_grad') or '',
            'age_limit': get_col(row, 'age') or '',
            'hukou_rule': get_col(row, 'hukou') or '',
            'exam_ratio': get_col(row, 'ratio') or '',
            'exam_subjects': get_col(row, 'subjects'),
            'other_conditions': get_col(row, 'notes')[:160],
            'contact_phone': get_col(row, 'phone'),
            'source': 'table',
        })

    assign_stable_row_ids(exam_id, rows_out)
    return rows_out


def compute_position_row_id(
    exam_id: str,
    position_code: str,
    employer: str,
    position_name: str,
) -> str:
    raw = f"{exam_id}|{position_code or ''}|{employer or ''}|{position_name or ''}"
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()[:16]


def assign_stable_row_ids(exam_id: str, rows: List[Dict[str, Any]]) -> None:
    seen: Dict[str, int] = {}
    for row in rows:
        base_id = compute_position_row_id(
            exam_id=exam_id,
            position_code=str(row.get('position_code') or ''),
            employer=str(row.get('employer') or ''),
            position_name=str(row.get('position_name') or ''),
        )
        count = seen.get(base_id, 0) + 1
        seen[base_id] = count
        row['row_id'] = base_id if count == 1 else f'{base_id}-{count}'


def parse_exam_excel_bytes(
    file_bytes: bytes,
    exam_id: str,
    default_bianzhi: str = '事业编',
    default_city: str = '',
    default_employer: str = '',
    filename: str = '',
) -> List[Dict[str, Any]]:
    """Parse an XLSX attachment into ExamPositionRow items."""
    if not file_bytes:
        return []
    rows: List[Dict[str, Any]] = []
    if openpyxl is not None:
        wb = None
        try:
            wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
            for sheet_name in wb.sheetnames:
                sheet = wb[sheet_name]
                grid = [[clean_cell(c) for c in r] for r in sheet.iter_rows(values_only=True)]
                parsed = parse_exam_table_grid(
                    grid,
                    exam_id=exam_id,
                    default_bianzhi=default_bianzhi,
                    default_city=default_city,
                    default_employer=default_employer,
                )
                for p in parsed:
                    p['source_file'] = filename or sheet_name
                    p['source'] = 'attachment'
                rows.extend(parsed)
        except Exception:
            pass
        finally:
            try:
                if wb is not None:
                    wb.close()
            except Exception:
                pass
    if not rows:
        # Fallback to generic parse_excel_bytes
        generic = parse_excel_bytes(file_bytes, filename=filename)
        for p in generic:
            rows.append(p)
    return rows


def parse_exam_pdf_bytes(
    file_bytes: bytes,
    exam_id: str,
    default_bianzhi: str = '事业编',
    default_city: str = '',
    default_employer: str = '',
    filename: str = '',
) -> List[Dict[str, Any]]:
    """Parse a PDF attachment into ExamPositionRow items."""
    if not file_bytes:
        return []
    rows: List[Dict[str, Any]] = []
    if fitz is not None:
        try:
            doc = fitz.open(stream=file_bytes, filetype='pdf')
            for page_idx in range(min(len(doc), 15)):
                page = doc[page_idx]
                try:
                    tables = page.find_tables()
                    if tables and tables.tables:
                        for t in tables.tables:
                            grid = [[clean_cell(c) for c in r] for r in t.extract()]
                            parsed = parse_exam_table_grid(
                                grid,
                                exam_id=exam_id,
                                default_bianzhi=default_bianzhi,
                                default_city=default_city,
                                default_employer=default_employer,
                            )
                            for p in parsed:
                                p['source_file'] = filename or f'第{page_idx + 1}页'
                                p['source'] = 'attachment'
                            rows.extend(parsed)
                except Exception:
                    pass
        except Exception:
            pass
    if not rows:
        generic = parse_pdf_bytes(file_bytes, filename=filename, max_pages=15)
        rows.extend(generic)
    return rows


def compute_exam_stage(
    schedule: Dict[str, Any],
    notice_role: str,
    published_at: Optional[str],
    today_str: str,
) -> str:
    if notice_role != '招考简章':
        if published_at:
            try:
                d_pub = dt.date.fromisoformat(published_at[:10])
                d_today = dt.date.fromisoformat(today_str)
                if (d_today - d_pub).days > 45:
                    return 'ended'
            except Exception:
                pass
        if notice_role == '体检/递补/公示':
            return 'publicity'
        if notice_role in ('成绩/进面', '资格复审/面试'):
            return 'interview_review'
        if notice_role == '准考证/笔试':
            return 'admit_exam'

    reg_mode = schedule.get('reg_mode')
    rolling_until = schedule.get('rolling_until')
    if reg_mode == 'rolling':
        return 'ended' if (rolling_until and today_str > rolling_until) else 'rolling'

    reg_start = schedule.get('reg_start')
    reg_end = schedule.get('reg_end')
    pay_end = schedule.get('payment_end')
    exam_date = schedule.get('written_exam_date')
    interview_date = schedule.get('interview_date')

    if reg_start and reg_start > today_str:
        return 'upcoming'
    if reg_end:
        if reg_end >= today_str:
            try:
                d_today = dt.date.fromisoformat(today_str)
                d_end = dt.date.fromisoformat(reg_end[:10])
                if 0 <= (d_end - d_today).days <= 3:
                    return 'closing_soon'
            except Exception:
                pass
            return 'registering'
        # Registration has ended; check subsequent milestones
        if pay_end and pay_end >= today_str:
            return 'payment_confirm'
        if exam_date and exam_date >= today_str:
            return 'admit_exam'
        if interview_date and interview_date >= today_str:
            return 'interview_review'
        return 'ended'

    # No explicit reg_end extracted: mark ended if published > 60 days ago, else unknown
    if published_at:
        try:
            d_pub = dt.date.fromisoformat(published_at[:10])
            d_today = dt.date.fromisoformat(today_str)
            if (d_today - d_pub).days > 60:
                return 'ended'
        except Exception:
            pass
    return 'unknown'


PROSE_NAME_BLACKLIST = {
    '以上', '以下', '硕士及', '博士及', '本科及', '初级', '中级', '高级',
    '岗位', '职位', '人员', '人才', '工作人员', '专业技术人员',
}


def valid_prose_position_name(name: str) -> bool:
    n = name.strip()
    return (
        2 <= len(n) <= 20
        and n not in PROSE_NAME_BLACKLIST
        and re.search(r'[\u4e00-\u9fa5]{2,}', n) is not None
        and not re.fullmatch(r'[\d\W_]+', n)
        and not re.match(r'^(?:以上|及|或|和|等|其中|包括|包含|此次|本次)', n)
    )


def enrich_exam_record(
    raw_item: Dict[str, Any],
    today_str: Optional[str] = None,
) -> Dict[str, Any]:
    """Convert a raw announcement or job record into a comprehensive ExamAnnouncement object."""
    today = today_str or dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).strftime('%Y-%m-%d')
    title = clean_exam_title(raw_item.get('title') or '')
    body = (raw_item.get('body') or raw_item.get('excerpt') or '').strip()
    published_at = raw_item.get('published_at')
    exam_id = raw_item.get('id') or hashlib.sha256((raw_item.get('source_url') or title).encode('utf-8')).hexdigest()[:20]

    # Organizer extraction before title enrichment
    organizer = extract_exam_organizer(
        title=title,
        raw_company=raw_item.get('company') or raw_item.get('organizer') or '',
        body=body,
        source_name=raw_item.get('source_name') or '',
    )

    # Disambiguate clickbait titles like "14人！这家驻济省属事业单位公开招聘了" using the extracted organizer
    if (
        any(w in title for w in ('这家', '这些', '这个', '这两家'))
        and organizer
        and organizer not in CAMPUS_PORTAL_HOSTS
        and organizer[:4] not in title
        and not organizer.endswith(('人社局', '人力资源和社会保障局', '人社厅', '人力资源和社会保障厅'))
    ):
        title = f'{organizer} · {title}'

    combined = f'{title}\n{body}'
    bianzhi_types = infer_bianzhi_types(title, body)
    exam_category = infer_exam_category(title, body)
    notice_role = infer_notice_role(title)
    schedule = extract_exam_schedule(combined, published_at)
    if schedule.get('reg_mode') != 'rolling' and not schedule.get('reg_end') and raw_item.get('deadline'):
        dl = str(raw_item['deadline'])[:10]
        if re.fullmatch(r'202\d-\d{2}-\d{2}', dl):
            m_int = int(dl[5:7])
            d_int = int(dl[8:10])
            date_tokens = (dl, f'{m_int}月{d_int}日', f'{m_int:02d}月{d_int:02d}日')
            for sent in re.split(r'[\r\n。；;]+', combined):
                if re.search(r'报名|截止|投递|报送|提交', sent) and any(tok in sent for tok in date_tokens):
                    schedule['reg_end'] = dl
                    break

    exam_subjects = extract_exam_subjects(title, body)
    stage = compute_exam_stage(schedule, notice_role, published_at, today)

    # Cities & Region Level
    title_org = f'{title} {organizer}'
    title_org_cities = list(cities_in_text(title_org, infer_counties=True))
    inst_city_rules = [
        (r'驻济|莱芜|山东大学|山东师范大学|山东财经大学|山东建筑大学|齐鲁工业大学|山东第一医科大学|山东中医药大学|山东交通学院|山东女子学院|山东管理学院|山东青年政治学院|山东艺术学院|山东工艺美术学院|山东体育学院|山东警察学院|山东政法学院|山东农业工程学院|山东协和学院|山东英才学院|山东现代学院|山东圣翰财贸职业学院|山东职业学院|山东商业职业技术学院|山东劳动职业技术学院|山东特殊教育职业学院|山东旅游职业学院|山东医学高等专科学校|山东城市建设职业学院|山东司法警官职业学院|山东技师学院|中共山东省委党校|山东行政学院|中国工业互联网研究院山东分院|山东省食品药品检验研究院|山东省药学科学院|山东省地质矿产勘查开发局|山东省公共卫生临床中心|山东省妇幼保健院|山东广播电视台|山东省教育厅|山东省体育局|山东省文化和旅游厅', '济南'),
        (r'康复大学|中国海洋大学|中国石油大学|山东科技大学|青岛大学|青岛理工大学|青岛科技大学|青岛农业大学|黄海水产研究所', '青岛'),
        (r'山东第二医科大学', '潍坊'),
        (r'山东理工大学', '淄博'),
        (r'山东农业大学|泰山学院', '泰安'),
        (r'鲁东大学|滨州医学院|山东工商学院|山东城市服务职业学院', '烟台'),
        (r'曲阜师范大学|济宁医学院', '济宁'),
        (r'山东外国语职业技术大学', '日照'),
        (r'山东航空学院', '滨州'),
        (r'鲁南', '临沂'),
    ]
    for pat, inst_city in inst_city_rules:
        if re.search(pat, title_org) and inst_city not in title_org_cities:
            title_org_cities.append(inst_city)

    sd_title_cities = [c for c in title_org_cities if c in SHANDONG_CITIES]
    source_city = (raw_item.get('source_city') or '').strip()

    if sd_title_cities:
        cities = sd_title_cities
    elif source_city and source_city in SHANDONG_CITIES:
        cities = [source_city]
    else:
        raw_cities = list(raw_item.get('cities') or []) or list(cities_in_text(body[:1200], infer_counties=True))
        sd_raw_cities = [c for c in raw_cities if c in SHANDONG_CITIES]
        if sd_raw_cities and ('山东' in combined or '省属' in combined or '驻济' in combined):
            cities = sd_raw_cities[:6]
        else:
            cities = []

    region_level = '市级'
    if re.search(r'中央机关|国家公务员|全军|北部战区|南部战区|西部战区|东部战区|中部战区|陆军|海军|空军|火箭军|武警|联勤保障|军事科学院|国防科技大学|出入境边防检查|水利部|中国科学院|中国水产科学研究院', f'{title} {organizer}'):
        region_level = '国家级'
    elif re.search(r'山东省属|山东省省属|省级机关|山东省202\d|省直|驻济省属|省属驻济|山东省高校毕业生', title):
        region_level = '省级'
    elif re.search(r'大学|学院|医院|研究院|中心|学校|保健院', f'{title} {organizer}') and not re.search(r'市属|区属|县属', title):
        region_level = '高校/医院单招'
    elif re.search(r'区|县|街道|镇', title) and not re.search(r'市直|市属', title):
        region_level = '区县级'

    # Convert or extract positions
    default_city = cities[0] if cities else ''
    default_bz = bianzhi_types[0] if bianzhi_types else '事业编'
    exam_positions: List[Dict[str, Any]] = []

    raw_positions = list(raw_item.get('exam_positions') or raw_item.get('positions') or [])
    if not raw_positions and body:
        # Attempt text-table extraction from body
        raw_positions = extract_positions_from_text(body, max_rows=50)

    for idx, p in enumerate(raw_positions):
        if not isinstance(p, dict):
            continue
        if 'position_name' in p and 'employer' in p:
            p_copy = dict(p)
            if p_copy.get('department') in CAMPUS_PORTAL_HOSTS or not p_copy.get('department'):
                p_copy['department'] = organizer
            if p_copy.get('employer') in CAMPUS_PORTAL_HOSTS or not p_copy.get('employer'):
                p_copy['employer'] = organizer
            if not p_copy.get('source'):
                p_copy['source'] = 'attachment' if (p_copy.get('source_file') or p_copy.get('source_url')) else 'table'
            exam_positions.append(p_copy)
            continue
        # Convert from generic PositionRequirement
        pos_name = (p.get('name') or '').strip()
        if not pos_name or pos_name in ('其它相关职位', '其他相关职位'):
            continue
        cnt_m = re.search(r'(\d+)', str(p.get('count') or ''))
        cnt = int(cnt_m.group(1)) if cnt_m else None
        if cnt is not None and (cnt <= 0 or cnt > 5000):
            cnt = None
        majors_list = p.get('majors') or []
        notes_text = str(p.get('notes') or '')
        pol = '中共党员' if '党员' in notes_text else ''
        fresh = p.get('cohort') or ('应届毕业生' if '应届' in notes_text else '')
        pos_code = str(p.get('position_code') or '')
        exam_positions.append({
            'row_id': compute_position_row_id(exam_id, pos_code, organizer, pos_name),
            'exam_id': exam_id,
            'department': organizer,
            'employer': organizer,
            'position_name': pos_name,
            'position_code': pos_code,
            'position_category': p.get('category') or exam_category,
            'bianzhi': default_bz,
            'recruit_count': cnt,
            'city': p.get('city') or default_city,
            'education': p.get('education') or raw_item.get('education') or '',
            'degree': '',
            'majors': majors_list if majors_list else [],
            'major_raw': '、'.join(majors_list) if majors_list else '',
            'political_status': pol,
            'fresh_grad_rule': fresh,
            'age_limit': '',
            'hukou_rule': '',
            'exam_ratio': '',
            'other_conditions': notes_text[:120],
            'source_file': p.get('source_file'),
            'source_url': p.get('source_url'),
            'source': 'attachment' if (p.get('source_file') or p.get('source_url')) else 'table',
        })

    # Extract key condition summaries from body without fabricating defaults
    ratio_m = re.search(r'开考比例[^。\n]{0,15}?(1\s*[：:]\s*\d+)', combined)
    exam_ratio = ratio_m.group(1).replace('：', ':').replace(' ', '') if ratio_m else None

    age_m = re.search(r'年龄(?:在|一般为|不超过)?\s*(\d{2})\s*周岁(?:及)?以下', combined)
    age_limit = f"{age_m.group(1)}周岁及以下" if age_m else None

    srv_m = re.search(r'最低服务年限(?:为)?\s*(\d+|一|二|三|五)\s*年', combined)
    service_years = f"最低服务年限{srv_m.group(1)}年" if srv_m else None

    hukou_summary = ''
    if re.search(r'限.*户籍|具有.*常住户口|生源地.*限', combined):
        hukou_summary = '部分岗位限本地户籍/生源'
    elif re.search(r'不限户籍|户籍不限', combined):
        hukou_summary = '不限户籍'

    fresh_grad_summary = ''
    if re.search(r'专项招聘.*高校毕业生|仅限.*应届|面向202\d届|202\d届.*公费师范', combined):
        fresh_grad_summary = '主要面向应届高校毕业生（含择业期）'
    elif re.search(r'选调', title):
        fresh_grad_summary = '限应届优秀高校毕业生'

    political_summary = ''
    if re.search(r'选调', title) or re.search(r'均须为中共党员|必须为中共党员', combined):
        political_summary = '要求中共党员（含预备党员）或主要学生干部'

    edu_min = ''
    if re.search(r'博士|高层次|高级人才', title):
        edu_min = '博士研究生'
    elif re.search(r'博士研究生|博士学位|招聘博士', combined) and not re.search(r'本科|硕士', combined):
        edu_min = '博士研究生'
    elif re.search(r'硕士研究生及以上|硕士及以上|硕士学位', combined) and not re.search(r'本科及以上|大学本科', combined):
        edu_min = '硕士研究生及以上'
    elif re.search(r'本科及以上|大学本科及以上|全日制本科|本科以上学历', combined):
        edu_min = '本科及以上'
    elif re.search(r'专科及以上|大专及以上|高中|中专', combined):
        edu_min = '专科及以上'

    degree_summary = ''

    all_majors = list(dict.fromkeys(
        list(raw_item.get('majors') or []) +
        [m for p in exam_positions for m in (p.get('majors') or []) if m]
    ))[:20]

    has_unlimited_major = bool(
        re.search(r'专业不限|不限专业', combined) or
        any('不限' in str(p.get('major_raw') or '') for p in exam_positions)
    )

    # If no tabular positions were extracted yet for a 招考简章, extract prose positions from body
    if not exam_positions and notice_role == '招考简章':
        prose_matches = re.findall(
            r'([\u4e00-\u9fa5A-Za-z]{2,16}?(?:专业技术岗位|专业技术人员|管理岗位|教师岗位|骨干教师|专任教师|教师|医师|护士|护理|医生|干事|科员|专员|工作人员|岗位|职位|人才|管理岗|技术岗|财务岗|会计|审计|文秘|法务|辅导员))'
            r'[：:\s（(]*?(?:招聘|招录|计划|拟聘|共)?\s*(\d{1,3})\s*[名人人]',
            combined,
        )
        seen_prose = set()
        for idx, (p_name, p_cnt) in enumerate(prose_matches[:12]):
            p_name = re.sub(
                r'^(?:其中|共计|合计|本次|此次|学校|单位|医院|包含|包括|拟|现|计划|公开招聘|招聘|招录|招考|引进|面向社会|公开)+',
                '',
                p_name,
            ).strip()
            if not valid_prose_position_name(p_name) or p_name in seen_prose:
                continue
            seen_prose.add(p_name)
            exam_positions.append({
                'row_id': compute_position_row_id(exam_id, '', organizer, p_name),
                'exam_id': exam_id,
                'department': organizer,
                'employer': organizer,
                'position_name': p_name,
                'position_code': '',
                'position_category': exam_category,
                'bianzhi': default_bz,
                'recruit_count': int(p_cnt),
                'city': default_city,
                'education': '',
                'degree': '',
                'majors': [],
                'major_raw': '',
                'political_status': '',
                'fresh_grad_rule': '',
                'age_limit': '',
                'hukou_rule': '',
                'exam_ratio': '',
                'exam_subjects': '',
                'other_conditions': '',
                'source': 'prose',
            })

    assign_stable_row_ids(exam_id, exam_positions)

    # Headcount & position count extraction from title + body without fabricating defaults
    pos_count_val = len(exam_positions)
    hc_count_val = sum(int(p['recruit_count']) for p in exam_positions if p.get('recruit_count') is not None)

    title_hc_m = re.search(r'(?:^|[·\s（(【]|共)\s*(\d{1,4})\s*[名人人](?:[！!）)】\s]|$)', title)
    if title_hc_m:
        thc = int(title_hc_m.group(1))
        if thc > hc_count_val and thc <= 50000:
            hc_count_val = thc

    title_pos_m = re.search(r'(\d{1,4})\s*个(?:招聘)?(?:岗位|职位)', title)
    if title_pos_m:
        tpos = int(title_pos_m.group(1))
        if tpos > pos_count_val and tpos <= 20000:
            pos_count_val = tpos

    hc_matches = re.findall(
        r'(?:公开招聘|计划招聘|拟招聘|拟公开招聘|共招聘|招录|招考|招募|引进)[^。\n；;]{0,28}?(\d{1,4})\s*[名人人]',
        combined,
    )
    for m_str in hc_matches:
        text_hc = int(m_str)
        if text_hc > hc_count_val and text_hc <= 50000:
            hc_count_val = text_hc

    pos_matches = re.findall(r'(\d{1,4})\s*个(?:招聘)?(?:岗位|职位)', combined)
    for p_str in pos_matches:
        text_pos = int(p_str)
        if text_pos > pos_count_val and text_pos <= 20000:
            pos_count_val = text_pos

    total_positions: Optional[int] = pos_count_val if pos_count_val > 0 else None
    total_headcount: Optional[int] = hc_count_val if hc_count_val > 0 else None

    attachments = raw_item.get('attachments') or []
    if any(p.get('source') in ('table', 'attachment') for p in exam_positions):
        positions_status = 'parsed'
    elif exam_positions:
        positions_status = 'prose'
    elif any(re.search(r'岗位|职位|计划|汇总表|一览表', str(a.get('title') or '')) for a in attachments):
        positions_status = 'attachment_only'
    else:
        positions_status = 'none'

    phones = list(dict.fromkeys(re.findall(r'0\d{2,3}-\d{7,8}', combined)))[:5]
    reg_url = raw_item.get('application_url')
    reg_method = '网上报名系统'
    if raw_item.get('emails') and not reg_url:
        reg_method = '电子邮箱投递报名表'
    elif re.search(r'现场报名|现场资格', combined) and not reg_url:
        reg_method = '现场报名 / 见原公告'

    is_sd = (
        any(c in SHANDONG_CITIES for c in cities)
        or '山东' in combined
        or '省属' in combined
        or '驻济' in combined
    )

    return {
        'id': exam_id,
        'title': title,
        'organizer': organizer,
        'region_level': region_level,
        'province': '山东' if is_sd else '全国',
        'cities': cities,
        'bianzhi_types': bianzhi_types,
        'exam_category': exam_category,
        'stage': stage,
        'notice_role': notice_role,
        'total_positions': total_positions,
        'total_headcount': total_headcount,
        'positions_status': positions_status,
        'schedule': schedule,
        'exam_subjects': exam_subjects,
        'exam_ratio': exam_ratio,
        'age_limit': age_limit,
        'service_years': service_years,
        'hukou_summary': hukou_summary,
        'fresh_grad_summary': fresh_grad_summary,
        'political_summary': political_summary,
        'education_min': edu_min,
        'degree_summary': degree_summary,
        'has_unlimited_major': has_unlimited_major,
        'majors': all_majors,
        'registration_url': reg_url,
        'registration_method': reg_method,
        'contact_phones': phones,
        'emails': raw_item.get('emails') or [],
        'source_id': raw_item.get('source_id', ''),
        'source_name': raw_item.get('source_name', ''),
        'source_url': raw_item.get('source_url', ''),
        'published_at': published_at,
        'last_verified_at': raw_item.get('last_verified_at') or today,
        'excerpt': (raw_item.get('excerpt') or body[:260]).strip(),
        'body': body[:18000],
        'positions': exam_positions,
        'attachments': raw_item.get('attachments') or [],
        'links': raw_item.get('links') or [],
        'related_notices': raw_item.get('related_notices') or [],
    }
