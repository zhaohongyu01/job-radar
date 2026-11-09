"""Structured parser for Civil Service & Public Institution (考公考编) announcements and position tables."""
from __future__ import annotations

import datetime as dt
import hashlib
import io
import json
import re
from typing import Any, Callable, Dict, List, Optional, Tuple

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
    from parse_positions import clean_cell, split_majors, _table_to_grid
except ImportError:
    from scripts.parse_positions import clean_cell, split_majors, _table_to_grid

SHANDONG_CITIES = list(PROVINCE_CITIES.get('山东', []))

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


def infer_bianzhi_types(title: str, text: str = '') -> List[str]:
    combined = f'{title}\n{text[:3000]}'
    types: List[str] = []
    if re.search(r'选调生|选调应届|优选选调|常规选调', combined):
        types.append('选调生')
    if re.search(r'考试录用公务员|公务员招录|公务员考试|中央机关及其直属机构|行政编', combined):
        types.append('公务员（行政编）')
    if re.search(r'参照公务员法|参公管理|参公单位', combined):
        types.append('参公管理')
    if re.search(r'军队文职|文职人员|部队文职|战区.*文职', combined):
        types.append('军队文职')
    if re.search(r'三支一扶|西部计划|社区工作者|城乡社区|网格员|特岗教师|基层服务', combined):
        types.append('三支一扶 / 基层项目')
    if re.search(r'控制总量|人员控制总量|备案制|员额制', combined):
        types.append('控制总量 / 备案制')
    if re.search(r'中小学.*教师|幼儿园.*教师|教育系统.*公开招聘|教体局.*招聘|公开招聘.*教师|教师公开招聘', combined):
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
    if re.search(r'考试录用公务员|省级机关及其直属机构|省考|公务员招考', combined):
        return '公务员省考'
    if re.search(r'军队文职|公开招考.*文职人员|战区.*文职', combined):
        return '军队文职招考'
    if re.search(r'三支一扶|西部计划|社区工作者|网格员|特岗教师', combined):
        return '三支一扶 / 基层'
    if re.search(r'初级综合类|统一公开招聘|事业单位统考|省属事业单位公开招聘', title):
        return '事业单位统考'
    if re.search(r'教育系统|教体局|中小学教师|幼儿教师|公开招聘.*教师|教师招考|师范', title):
        return '教师公开招聘'
    if re.search(r'卫健|卫生健康|医院|医疗卫生|妇幼保健|疾控|中医药', title):
        return '医疗卫生招聘'
    if re.search(r'大学|学院|研究院|科学院|科研院所|技师学院', title) and not re.search(r'毕业生|直通名校', title):
        return '高校 / 科研院所'
    if re.search(r'引进.*人才|青年人才|急需紧缺|优才|高层次人才|人才引进|硕博', title):
        return '人才引进 / 优才'
    return '事业单位单招'


def infer_notice_role(title: str) -> str:
    if re.search(r'报名人数|报名情况|核减|取消.*计划|改报', title):
        return '报名统计'
    if re.search(r'准考证|笔试通知|笔试安排|笔试时间|笔试考点|笔试温馨', title):
        return '准考证/笔试'
    if re.search(r'成绩查询|笔试成绩|合格分数线|进入面试范围', title):
        return '成绩/进面'
    if re.search(r'资格审查|资格复审|面试通知|面试安排|面试时间|面谈', title):
        return '资格复审/面试'
    if re.search(r'体检|考察|政审|递补|拟聘用|拟录用|公示', title):
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
        'raw_evidence': [],
    }

    lines = [re.sub(r'\s+', ' ', ln).strip() for ln in text.splitlines() if ln.strip()]
    for line in lines:
        if any(k in line for k in ('报名时间', '网上报名', '查询时间', '初审时间', '缴费时间', '网上缴费', '准考证', '笔试时间')):
            if 8 <= len(line) <= 140 and len(schedule['raw_evidence']) < 6:
                schedule['raw_evidence'].append(line)

        # 1. Registration window: e.g. 报名时间：2026年3月18日9:00—3月22日16:00 or 2026年11月10日至2026年11月14日
        if not schedule['reg_end'] and re.search(r'报名时间|网上报名|报名起止', line):
            range_m = re.search(
                r'(?:(202\d)\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:\s*\d{1,2}[：:]\d{2})?\s*(?:至|到|—|-|–|~|～)\s*(?:(202\d)\s*年\s*)?(?:(\d{1,2})\s*月\s*)?(\d{1,2})\s*日',
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
            else:
                iso_m = re.findall(r'(202\d)-(\d{1,2})-(\d{1,2})', line)
                if len(iso_m) >= 2:
                    schedule['reg_start'] = _normalize_cn_date(*iso_m[0])
                    schedule['reg_end'] = _normalize_cn_date(*iso_m[1])
                elif len(iso_m) == 1 and re.search(r'截止|截至|前', line):
                    schedule['reg_end'] = _normalize_cn_date(*iso_m[0])

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
        if not schedule['admit_card_start'] and re.search(r'准考证.*打印|打印准考证', line):
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
        elif '医院' in title or '卫健' in title or '医疗' in title:
            subjects = ['公基', '医基/临床']
        else:
            subjects = ['公基', '综合写作']
    return subjects[:4]


def parse_exam_table_grid(grid: List[List[str]], exam_id: str, default_bianzhi: str = '事业编', default_city: str = '') -> List[Dict[str, Any]]:
    """Parse a 2D table grid from an exam announcement or XLSX/PDF attachment into ExamPositionRow items."""
    if not grid or len(grid) < 2:
        return []

    def is_header_row(cells: List[str]) -> bool:
        non_empty = [clean_cell(c) for c in cells if clean_cell(c)]
        if len(non_empty) < 3:
            return False
        hits = sum(1 for c in non_empty if EXAM_HEADER_KEYWORD.fullmatch(c) or COL_POS_NAME.search(c) or COL_MAJORS.search(c) or COL_EMPLOYER.search(c))
        return hits >= 2 and hits >= len(non_empty) // 2 and all(len(c) <= 45 for c in non_empty)

    best_header: Optional[Tuple[int, int, int, Dict[str, int]]] = None
    for start_r in range(min(8, len(grid))):
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

            if 'position_name' in mapping or 'majors' in mapping or 'employer' in mapping:
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
        employer = get_col(row, 'employer')
        department = get_col(row, 'department')
        major_raw = get_col(row, 'majors')

        # Skip summary/total rows
        if re.search(r'^(?:合计|总计|小计|汇总|注[：:])', pos_name or employer or department):
            continue
        if not pos_name and not major_raw and not employer:
            continue

        edu = get_col(row, 'education') or get_col(row, 'edu_degree') or '本科及以上'
        deg = get_col(row, 'degree')
        if not deg and '学位' in edu:
            deg = edu

        raw_count = get_col(row, 'recruit_count')
        count_m = re.search(r'(\d+)', raw_count)
        recruit_count = int(count_m.group(1)) if count_m else 1

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

        row_id = hashlib.sha256(
            f"{exam_id}:{r_idx}:{department}:{employer}:{pos_name}:{get_col(row, 'position_code')}".encode('utf-8')
        ).hexdigest()[:16]

        rows_out.append({
            'row_id': row_id,
            'exam_id': exam_id,
            'department': department or employer or '招考主管部门',
            'employer': employer or department or '用人单位见简章',
            'position_name': pos_name or get_col(row, 'position_category') or '公开招聘岗位',
            'position_code': get_col(row, 'position_code'),
            'position_category': get_col(row, 'position_category'),
            'bianzhi': bz,
            'recruit_count': recruit_count,
            'city': city_val or '山东',
            'education': edu,
            'degree': deg or '学士及以上',
            'majors': split_majors(major_raw) if major_raw else ['不限专业'],
            'major_raw': major_raw or '不限专业 / 详见岗位表',
            'political_status': get_col(row, 'political') or '不限',
            'fresh_grad_rule': get_col(row, 'fresh_grad') or '不限',
            'age_limit': get_col(row, 'age') or '35周岁及以下',
            'hukou_rule': get_col(row, 'hukou') or '不限',
            'exam_ratio': get_col(row, 'ratio') or '1:3',
            'exam_subjects': get_col(row, 'subjects'),
            'other_conditions': get_col(row, 'notes')[:160],
            'contact_phone': get_col(row, 'phone'),
        })

    return rows_out


def compute_exam_stage(
    schedule: Dict[str, Any],
    notice_role: str,
    published_at: Optional[str],
    today_str: str,
) -> str:
    if notice_role == '体检/递补/公示':
        return 'publicity'
    if notice_role in ('成绩/进面', '资格复审/面试'):
        return 'interview_review'
    if notice_role == '准考证/笔试':
        return 'admit_exam'

    reg_start = schedule.get('reg_start')
    reg_end = schedule.get('reg_end')
    pay_end = schedule.get('payment_end')
    exam_date = schedule.get('written_exam_date')

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
        return 'ended'

    # No explicit reg_end extracted: infer from published_at age
    if published_at:
        try:
            d_pub = dt.date.fromisoformat(published_at[:10])
            d_today = dt.date.fromisoformat(today_str)
            age_days = (d_today - d_pub).days
            if age_days <= 14:
                return 'registering'
            if age_days <= 30:
                return 'admit_exam'
        except Exception:
            pass
    return 'ended'


def enrich_exam_record(
    raw_item: Dict[str, Any],
    today_str: Optional[str] = None,
) -> Dict[str, Any]:
    """Convert a raw announcement or job record into a comprehensive ExamAnnouncement object."""
    today = today_str or dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).strftime('%Y-%m-%d')
    title = (raw_item.get('title') or '').strip()
    body = (raw_item.get('body') or raw_item.get('excerpt') or '').strip()
    combined = f'{title}\n{body}'
    published_at = raw_item.get('published_at')
    exam_id = raw_item.get('id') or hashlib.sha256((raw_item.get('source_url') or title).encode('utf-8')).hexdigest()[:20]

    bianzhi_types = infer_bianzhi_types(title, body)
    exam_category = infer_exam_category(title, body)
    notice_role = infer_notice_role(title)
    schedule = extract_exam_schedule(combined, published_at)
    if not schedule.get('reg_end') and raw_item.get('deadline'):
        schedule['reg_end'] = str(raw_item['deadline'])[:10]

    exam_subjects = extract_exam_subjects(title, body)
    stage = compute_exam_stage(schedule, notice_role, published_at, today)

    # Cities & Region Level
    cities = list(raw_item.get('cities') or [])
    if not cities:
        cities = cities_in_text(title, infer_counties=True) or cities_in_text(body[:1500], infer_counties=True)
    if not cities and raw_item.get('source_city'):
        cities = [raw_item['source_city']]

    region_level = '市级'
    if re.search(r'中央机关|国家公务员|全军|北部战区|陆军|海军|空军|武警', title):
        region_level = '国家级'
    elif re.search(r'山东省属|山东省省属|省级机关|山东省202\d|省直', title):
        region_level = '省级'
    elif re.search(r'大学|学院|医院|研究院|中心', title) and not re.search(r'市属|区属|县属', title):
        region_level = '高校/医院单招'
    elif re.search(r'区|县|街道|镇', title) and not re.search(r'市直|市属', title):
        region_level = '区县级'

    # Organizer
    organizer = (raw_item.get('company') or '').strip()
    if not organizer or organizer in ('招聘单位待核实', '未知'):
        org_m = re.match(r'^(?:202\d年[度]?)?([\u4e00-\u9fa5]{3,18}?(?:人社局|人力资源和社会保障局|组织部|教育局|教育和体育局|卫健委|卫生健康局|大学|学院|医院|委员会|厅|局))', title)
        organizer = org_m.group(1) if org_m else (raw_item.get('source_name', '').split(' · ')[0] or '官方招考主管部门')

    # Convert or extract positions
    default_city = cities[0] if cities else '山东'
    default_bz = bianzhi_types[0] if bianzhi_types else '事业编'
    exam_positions: List[Dict[str, Any]] = []

    raw_positions = raw_item.get('exam_positions') or raw_item.get('positions') or []
    for idx, p in enumerate(raw_positions):
        if not isinstance(p, dict):
            continue
        if 'position_name' in p and 'employer' in p:
            exam_positions.append(p)
            continue
        # Convert from generic PositionRequirement
        pos_name = (p.get('name') or '').strip()
        if not pos_name:
            continue
        cnt_m = re.search(r'(\d+)', str(p.get('count') or ''))
        cnt = int(cnt_m.group(1)) if cnt_m else 1
        majors_list = p.get('majors') or []
        notes_text = str(p.get('notes') or '')
        pol = '中共党员' if '党员' in notes_text else '不限'
        fresh = p.get('cohort') or ('应届毕业生' if '应届' in notes_text else '不限')
        exam_positions.append({
            'row_id': f'{exam_id}-pos-{idx}',
            'exam_id': exam_id,
            'department': organizer,
            'employer': organizer,
            'position_name': pos_name,
            'position_code': f'{idx + 1:03d}',
            'position_category': p.get('category') or exam_category,
            'bianzhi': default_bz,
            'recruit_count': cnt,
            'city': p.get('city') or default_city,
            'education': p.get('education') or raw_item.get('education') or '本科及以上',
            'degree': '学士及以上',
            'majors': majors_list if majors_list else ['详见岗位表'],
            'major_raw': '、'.join(majors_list) if majors_list else '详见岗位表',
            'political_status': pol,
            'fresh_grad_rule': fresh,
            'age_limit': '35周岁及以下',
            'hukou_rule': '不限',
            'exam_ratio': '1:3',
            'other_conditions': notes_text[:120],
            'source_file': p.get('source_file'),
            'source_url': p.get('source_url'),
        })

    # Headcount & position count extraction from text if not in table
    total_positions = len(exam_positions)
    total_headcount = sum(int(p.get('recruit_count') or 1) for p in exam_positions)

    hc_match = re.search(r'(?:公开招聘|计划招聘|拟招聘|共招聘|招录|招考|招募|引进)[^。\n]{0,20}?(\d{1,4})\s*[名人人]', combined)
    if hc_match:
        text_hc = int(hc_match.group(1))
        if text_hc > total_headcount and text_hc <= 50000:
            total_headcount = text_hc

    pos_match = re.search(r'(\d{1,4})\s*个(?:招聘)?(?:岗位|职位)', combined)
    if pos_match:
        text_pos = int(pos_match.group(1))
        if text_pos > total_positions and text_pos <= 20000:
            total_positions = text_pos

    if total_positions == 0 and notice_role == '招考简章':
        total_positions = 1
    if total_headcount == 0 and notice_role == '招考简章':
        total_headcount = max(1, total_positions)

    # Extract key condition summaries from body
    ratio_m = re.search(r'开考比例[^。\n]{0,15}?(1\s*[：:]\s*\d+)', combined)
    exam_ratio = ratio_m.group(1).replace('：', ':').replace(' ', '') if ratio_m else '1:3'

    age_m = re.search(r'年龄(?:在|一般为|不超过)?\s*(\d{2})\s*周岁(?:及)?以下', combined)
    age_limit = f"{age_m.group(1)}周岁及以下" if age_m else '35周岁及以下（硕博可放宽至40周岁）'

    srv_m = re.search(r'最低服务年限(?:为)?\s*(\d+|一|二|三|五)\s*年', combined)
    service_years = f"最低服务年限{srv_m.group(1)}年" if srv_m else None

    hukou_summary = '不限户籍'
    if re.search(r'限.*户籍|具有.*常住户口|生源地.*限', combined):
        hukou_summary = '部分岗位限本地户籍/生源'

    fresh_grad_summary = '应往届均可（按岗位区分）'
    if re.search(r'专项招聘.*高校毕业生|仅限.*应届|面向202\d届', combined):
        fresh_grad_summary = '主要面向应届高校毕业生（含择业期）'
    elif re.search(r'选调', title):
        fresh_grad_summary = '限应届优秀高校毕业生'

    political_summary = '多数不限（部分党务岗要求党员）'
    if re.search(r'选调', title) or re.search(r'均须为中共党员|必须为中共党员', combined):
        political_summary = '要求中共党员（含预备党员）或主要学生干部'

    edu_min = '本科及以上'
    if re.search(r'博士研究生|博士学位', combined) and not re.search(r'本科|硕士', combined):
        edu_min = '博士研究生'
    elif re.search(r'硕士研究生及以上|硕士及以上', combined) and not re.search(r'本科及以上|大学本科', combined):
        edu_min = '硕士研究生及以上'
    elif re.search(r'专科及以上|大专及以上|高中|中专', combined):
        edu_min = '专科及以上'

    degree_summary = '学士及以上学位（依岗位表）'

    all_majors = list(dict.fromkeys(
        list(raw_item.get('majors') or []) +
        [m for p in exam_positions for m in (p.get('majors') or [])]
    ))[:20]

    has_unlimited_major = bool(
        re.search(r'专业不限|不限专业', combined) or
        any('不限' in str(p.get('major_raw') or '') for p in exam_positions)
    )

    # If no tabular positions were extracted yet for a 招考简章, synthesize prose/summary position rows
    if not exam_positions and notice_role == '招考简章':
        # Try extracting prose items like "XX教师2名" or "XX岗位3人"
        prose_matches = re.findall(
            r'([\u4e00-\u9fa5]{2,14}?(?:教师|医师|护士|护理|医生|干事|科员|专员|工作人员|岗位|职位|人才|人员|管理岗|技术岗|财务岗|会计|审计|文秘|法务|辅导员))'
            r'[：:\s（(]*?(?:招聘|招录|计划|拟聘)?\s*(\d{1,3})\s*[名人人]',
            combined,
        )
        seen_prose = set()
        for idx, (p_name, p_cnt) in enumerate(prose_matches[:12]):
            p_name = re.sub(r'^(?:其中|共计|合计|招聘|计划|拟聘|招考|引进)', '', p_name).strip()
            if len(p_name) < 2 or p_name in seen_prose or p_name in ('工作人员', '人员', '人才'):
                continue
            seen_prose.add(p_name)
            exam_positions.append({
                'row_id': f'{exam_id}-prose-{idx}',
                'exam_id': exam_id,
                'department': organizer,
                'employer': organizer,
                'position_name': p_name,
                'position_code': f'{idx + 1:03d}',
                'position_category': exam_category,
                'bianzhi': default_bz,
                'recruit_count': int(p_cnt),
                'city': default_city,
                'education': edu_min,
                'degree': degree_summary,
                'majors': all_majors[:5] if all_majors else ['详见附件岗位表'],
                'major_raw': '、'.join(all_majors[:6]) if all_majors else ('不限专业 / 详见岗位表' if has_unlimited_major else '详见附件岗位汇总表'),
                'political_status': '中共党员' if '党员' in political_summary and '多数' not in political_summary else '不限',
                'fresh_grad_rule': '限应届毕业生' if '限' in fresh_grad_summary else '应往届均可',
                'age_limit': age_limit,
                'hukou_rule': hukou_summary,
                'exam_ratio': exam_ratio,
                'exam_subjects': ' + '.join(exam_subjects),
                'other_conditions': f'共 {total_positions} 岗 / 招 {total_headcount} 人，具体专业目录见原公告附件',
            })

        if not exam_positions:
            exam_positions.append({
                'row_id': f'{exam_id}-summary-0',
                'exam_id': exam_id,
                'department': organizer,
                'employer': organizer,
                'position_name': f'{exam_category}综合岗位（详见岗位表）',
                'position_code': '001',
                'position_category': exam_category,
                'bianzhi': default_bz,
                'recruit_count': total_headcount,
                'city': default_city,
                'education': edu_min,
                'degree': degree_summary,
                'majors': all_majors[:6] if all_majors else ['详见附件岗位表'],
                'major_raw': '、'.join(all_majors[:6]) if all_majors else ('含不限专业岗位' if has_unlimited_major else '详见原公告岗位汇总表'),
                'political_status': '中共党员' if '党员' in political_summary and '多数' not in political_summary else '不限',
                'fresh_grad_rule': '限应届毕业生' if '限' in fresh_grad_summary else '应往届均可',
                'age_limit': age_limit,
                'hukou_rule': hukou_summary,
                'exam_ratio': exam_ratio,
                'exam_subjects': ' + '.join(exam_subjects),
                'other_conditions': f'本次共发布 {total_positions} 个岗位、计划招录 {total_headcount} 人',
            })

    phones = list(dict.fromkeys(re.findall(r'0\d{2,3}-\d{7,8}', combined)))[:5]
    reg_url = raw_item.get('application_url')
    reg_method = '网上报名系统'
    if raw_item.get('emails') and not reg_url:
        reg_method = '电子邮箱投递报名表'
    elif re.search(r'现场报名|现场资格', combined) and not reg_url:
        reg_method = '现场报名 / 见原公告'

    return {
        'id': exam_id,
        'title': title,
        'organizer': organizer,
        'region_level': region_level,
        'province': '山东' if any(c in SHANDONG_CITIES for c in cities) or '山东' in combined else '全国',
        'cities': cities,
        'bianzhi_types': bianzhi_types,
        'exam_category': exam_category,
        'stage': stage,
        'notice_role': notice_role,
        'total_positions': total_positions,
        'total_headcount': total_headcount,
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
