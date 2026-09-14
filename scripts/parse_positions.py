"""Extract structured positions, majors, degrees and locations from recruitment tables and attachments."""
from __future__ import annotations

import io
import re
from typing import Any, Callable, Dict, List, Optional

try:
    import openpyxl
except ImportError:
    openpyxl = None

try:
    import fitz
except ImportError:
    fitz = None

from bs4 import BeautifulSoup

HEADER_SPECIFIC_NAME = re.compile(
    r'(?:职位名称|岗位名称|招聘职位|需求岗位|具体岗位|拟聘岗位|招考职位|拟招聘岗位|选聘岗位|招聘工种)',
    re.I,
)
HEADER_CATEGORY = re.compile(
    r'(?:岗位类别|职位类别|招聘类别|类别|岗位方向|专业类别|岗位组别)',
    re.I,
)
HEADER_NAME_FALLBACK = re.compile(
    r'(?:^岗位$|^职位$|^工种$|招聘岗位|岗位代号|职位代号|岗位代码|职位代码)',
    re.I,
)
HEADER_MAJORS = re.compile(
    r'(?:专业|需求专业|所学专业|拟聘专业|专业要求|专业范围|专业目录|学科专业|学科|专业门类|专业大类)',
    re.I,
)
HEADER_EDUCATION = re.compile(
    r'(?:学历|文化程度|最低学历|学历要求|学历学位|学位|学历门槛|招录学历)',
    re.I,
)
HEADER_COUNT = re.compile(
    r'(?:人数|招聘人数|拟聘人数|计划人数|需求人数|招聘计划|计划招聘人数|拟招人数|^需求$|需求量|名额)',
    re.I,
)
HEADER_CITY = re.compile(
    r'(?:工作地点|工作城市|工作地|地点|城市|用工地点|拟聘地点|就职地|工作区域|实施地点)',
    re.I,
)
HEADER_COHORT = re.compile(
    r'(?:届别|毕业时间|招聘对象|生源|应届要求)',
    re.I,
)
HEADER_NOTES = re.compile(
    r'(?:备注|其他条件|资格条件|任职要求|岗位职责|工作职责|其他资格要求)',
    re.I,
)

SHANDONG_CITIES = [
    '济南', '青岛', '淄博', '枣庄', '东营', '烟台', '潍坊', '济宁',
    '泰安', '威海', '日照', '临沂', '德州', '聊城', '滨州', '菏泽',
]


def clean_cell(text: Any) -> str:
    if text is None:
        return ''
    return re.sub(r'\s+', ' ', str(text)).strip()


def split_majors(text: str) -> List[str]:
    if not text:
        return []
    parts = re.split(r'[,，、;/；\s\n]+', text)
    cleaned = []
    for p in parts:
        p = re.sub(r'(?:及相关专业|相关专业|等专业|等|类)$', '', p.strip())
        if p and p not in {'不限', '无', '其他', '专业'}:
            cleaned.append(p)
    return cleaned[:15]


def parse_table_grid(grid: List[List[str]], source_type: str = 'table') -> List[Dict[str, Any]]:
    """Parse a 2D grid of cell strings into structured position objects."""
    if not grid or len(grid) < 2:
        return []

    # 1. Identify Horizontal Table Header
    header_idx = -1
    col_mapping: Dict[str, int] = {}

    for r_idx, row in enumerate(grid[:8]):
        cleaned_row = [clean_cell(c) for c in row]
        mapping: Dict[str, int] = {}
        for c_idx, cell in enumerate(cleaned_row):
            if not cell:
                continue
            if 'specific_name' not in mapping and HEADER_SPECIFIC_NAME.search(cell):
                mapping['specific_name'] = c_idx
            elif 'category' not in mapping and HEADER_CATEGORY.search(cell):
                mapping['category'] = c_idx
            elif 'fallback_name' not in mapping and HEADER_NAME_FALLBACK.search(cell):
                mapping['fallback_name'] = c_idx

            if 'majors' not in mapping and HEADER_MAJORS.search(cell):
                mapping['majors'] = c_idx
            elif 'education' not in mapping and HEADER_EDUCATION.search(cell):
                mapping['education'] = c_idx
            elif 'count' not in mapping and HEADER_COUNT.search(cell):
                mapping['count'] = c_idx
            elif 'city' not in mapping and HEADER_CITY.search(cell):
                mapping['city'] = c_idx
            elif 'cohort' not in mapping and HEADER_COHORT.search(cell):
                mapping['cohort'] = c_idx
            elif 'notes' not in mapping and HEADER_NOTES.search(cell):
                mapping['notes'] = c_idx

        # Choose the best column for position title
        if 'specific_name' in mapping:
            mapping['name'] = mapping['specific_name']
        elif 'fallback_name' in mapping:
            mapping['name'] = mapping['fallback_name']
        elif 'category' in mapping:
            mapping['name'] = mapping['category']

        # Valid table header requires name or majors + at least 1 other recruitment field
        has_id_col = 'name' in mapping or 'majors' in mapping
        field_count = len([k for k in mapping if k in {'name', 'majors', 'education', 'count', 'city', 'cohort'}])
        if has_id_col and field_count >= 2:
            header_idx = r_idx
            col_mapping = mapping
            break

    positions: List[Dict[str, Any]] = []
    if header_idx >= 0 and col_mapping:
        for r_idx in range(header_idx + 1, min(len(grid), header_idx + 120)):
            row = grid[r_idx]
            cleaned_row = [clean_cell(c) for c in row]
            if not cleaned_row or all(not c for c in cleaned_row):
                continue

            name = cleaned_row[col_mapping['name']] if 'name' in col_mapping and col_mapping['name'] < len(cleaned_row) else ''
            category = cleaned_row[col_mapping['category']] if 'category' in col_mapping and col_mapping['category'] < len(cleaned_row) else ''
            majors_text = cleaned_row[col_mapping['majors']] if 'majors' in col_mapping and col_mapping['majors'] < len(cleaned_row) else ''
            education = cleaned_row[col_mapping['education']] if 'education' in col_mapping and col_mapping['education'] < len(cleaned_row) else ''
            count = cleaned_row[col_mapping['count']] if 'count' in col_mapping and col_mapping['count'] < len(cleaned_row) else ''
            city = cleaned_row[col_mapping['city']] if 'city' in col_mapping and col_mapping['city'] < len(cleaned_row) else ''
            cohort = cleaned_row[col_mapping['cohort']] if 'cohort' in col_mapping and col_mapping['cohort'] < len(cleaned_row) else ''
            notes = cleaned_row[col_mapping['notes']] if 'notes' in col_mapping and col_mapping['notes'] < len(cleaned_row) else ''

            if not name and not majors_text:
                continue
            # If name is generic (like "研发类"), but category exists, combine or clarify
            final_name = name or majors_text
            # If multiple job titles separated by 、/， in a single cell
            positions.append({
                'name': final_name,
                'category': category if category != final_name else '',
                'majors': split_majors(majors_text),
                'education': education,
                'count': count,
                'city': city,
                'cohort': cohort,
                'notes': notes[:100] if notes else '',
                'source_type': source_type,
            })
        return positions

    # 2. Check Vertical Key-Value Table (e.g. SDU job specification card)
    kv: Dict[str, str] = {}
    for row in grid:
        cleaned_row = [clean_cell(c) for c in row]
        for i in range(0, len(cleaned_row) - 1, 2):
            label, val = cleaned_row[i], cleaned_row[i + 1]
            if not label or not val:
                continue
            if 'name' not in kv and (HEADER_SPECIFIC_NAME.fullmatch(label) or HEADER_NAME_FALLBACK.fullmatch(label)):
                kv['name'] = val
            elif 'majors' not in kv and HEADER_MAJORS.fullmatch(label):
                kv['majors'] = val
            elif 'education' not in kv and HEADER_EDUCATION.fullmatch(label):
                kv['education'] = val
            elif 'count' not in kv and HEADER_COUNT.fullmatch(label):
                kv['count'] = val
            elif 'city' not in kv and HEADER_CITY.fullmatch(label):
                kv['city'] = val

    if 'name' in kv and kv['name']:
        return [{
            'name': kv['name'],
            'majors': split_majors(kv.get('majors', '')),
            'education': kv.get('education', ''),
            'count': kv.get('count', ''),
            'city': kv.get('city', ''),
            'source_type': f'{source_type}_kv',
        }]

    return []


def parse_html_tables(html_or_soup: Any) -> List[Dict[str, Any]]:
    """Parse HTML <table> elements into structured positions."""
    if not html_or_soup:
        return []
    if isinstance(html_or_soup, str):
        soup = BeautifulSoup(html_or_soup, 'html.parser')
        tables = soup.find_all('table')
        results: List[Dict[str, Any]] = []
        for table in tables:
            rows = table.find_all('tr')
            grid: List[List[str]] = []
            for r in rows:
                cells = [clean_cell(c.get_text()) for c in r.find_all(['td', 'th'])]
                if cells:
                    grid.append(cells)
            parsed = parse_table_grid(grid, source_type='html_table')
            results.extend(parsed)
        return deduplicate_positions(results)

    if hasattr(html_or_soup, 'find_all'):
        tables = html_or_soup.find_all('table')
        results = []
        for table in tables:
            rows = table.find_all('tr')
            grid = []
            for r in rows:
                cells = [clean_cell(c.get_text()) for c in r.find_all(['td', 'th'])]
                if cells:
                    grid.append(cells)
            parsed = parse_table_grid(grid, source_type='html_table')
            results.extend(parsed)
        return deduplicate_positions(results)

    if hasattr(html_or_soup, 'find'):
        # Node object from collect.py
        tables = html_or_soup.find('table')
        results = []
        for table in tables:
            rows = table.find('tr')
            grid = []
            for r in rows:
                cells = [clean_cell(c.text()) for c in (r.find('th') or r.find('td'))]
                if cells:
                    grid.append(cells)
            parsed = parse_table_grid(grid, source_type='html_table')
            results.extend(parsed)
        return deduplicate_positions(results)

    return []


def parse_excel_bytes(file_bytes: bytes, filename: str = '') -> List[Dict[str, Any]]:
    """Parse XLSX bytes into structured positions."""
    if not openpyxl or not file_bytes:
        return []
    try:
        buf = io.BytesIO(file_bytes)
        wb = openpyxl.load_workbook(buf, read_only=True, data_only=True)
        results: List[Dict[str, Any]] = []

        # Look across sheets
        sheet_names = wb.sheetnames
        # Prioritize sheets with recruitment keywords in title
        target_sheets = [s for s in sheet_names if re.search(r'岗位|职位|专业|需求|招聘|一览|汇总', s)] or sheet_names[:2]

        for name in target_sheets:
            sheet = wb[name]
            grid: List[List[str]] = []
            for row in sheet.iter_rows(values_only=True):
                grid.append([clean_cell(c) for c in row])
                if len(grid) >= 150:
                    break
            parsed = parse_table_grid(grid, source_type='xlsx')
            for p in parsed:
                p['source_file'] = filename or name
            results.extend(parsed)

        return deduplicate_positions(results)
    except Exception:
        return []


def parse_pdf_bytes(file_bytes: bytes, filename: str = '', max_pages: int = 8) -> List[Dict[str, Any]]:
    """Parse PDF bytes (using PyMuPDF find_tables) into structured positions."""
    if not fitz or not file_bytes:
        return []
    try:
        doc = fitz.open(stream=file_bytes, filetype='pdf')
        results: List[Dict[str, Any]] = []

        for page_idx in range(min(len(doc), max_pages)):
            page = doc[page_idx]
            # Try PyMuPDF find_tables
            try:
                tables = page.find_tables()
                if tables and tables.tables:
                    for t in tables.tables:
                        grid = t.extract()
                        parsed = parse_table_grid(grid, source_type='pdf')
                        for p in parsed:
                            p['source_file'] = filename or f'第{page_idx+1}页'
                        results.extend(parsed)
            except Exception:
                pass

        # If no vector tables found, fallback to word coordinate layout reconstruction
        if not results:
            for page_idx in range(min(len(doc), max_pages)):
                page = doc[page_idx]
                words = page.get_text('words')
                if len(words) >= 4:
                    lines_dict: Dict[float, List[Any]] = {}
                    for w in words:
                        y = round(w[1] / 6.0) * 6
                        lines_dict.setdefault(y, []).append(w)
                    grid = []
                    for y in sorted(lines_dict.keys()):
                        row_words = sorted(lines_dict[y], key=lambda x: x[0])
                        grid.append([clean_cell(w[4]) for w in row_words])
                    parsed = parse_table_grid(grid, source_type='pdf_layout')
                    for p in parsed:
                        p['source_file'] = filename or f'第{page_idx+1}页'
                    results.extend(parsed)

        # Fallback 2: line-by-line tabular parsing
        if not results:
            text = '\n'.join(doc[i].get_text() for i in range(min(len(doc), max_pages)))
            text_parsed = extract_positions_from_text(text)
            for p in text_parsed:
                p['source_file'] = filename or 'PDF文本'
            results.extend(text_parsed)

        return deduplicate_positions(results)
    except Exception:
        return []


def extract_positions_from_text(text: str, max_rows: int = 50) -> List[Dict[str, Any]]:
    """Extract tabular positions from text lines (tab/pipe/multi-space separated lines)."""
    if not text:
        return []
    raw_lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not raw_lines:
        return []

    grid: List[List[str]] = []
    for line in raw_lines:
        if '\t' in line:
            cells = [clean_cell(c) for c in line.split('\t')]
        elif '|' in line:
            cells = [clean_cell(c) for c in line.split('|') if clean_cell(c)]
        else:
            cells = [clean_cell(c) for c in re.split(r'\s{2,}', line) if clean_cell(c)]

        if len(cells) >= 2:
            grid.append(cells)

    if len(grid) >= 2:
        parsed = parse_table_grid(grid, source_type='text_table')
        if parsed:
            return parsed[:max_rows]

    return []


def deduplicate_positions(positions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Deduplicate positions by name, city, and education."""
    seen = set()
    unique = []
    for p in positions:
        name = p.get('name', '').strip()
        if not name or len(name) > 100:
            continue
        key = (name, p.get('city', '').strip(), p.get('education', '').strip())
        if key not in seen:
            seen.add(key)
            unique.append(p)
    return unique[:60]


def extract_all_positions(
    body_html_or_soup: Any,
    text: str,
    attachments: Optional[List[Dict[str, str]]] = None,
    fetch_attachment_fn: Optional[Callable[[str], Optional[bytes]]] = None,
) -> List[Dict[str, Any]]:
    """Universal pipeline extracting positions from HTML tables, text tables, and attachments."""
    all_positions: List[Dict[str, Any]] = []

    # 1. HTML tables in announcement
    html_positions = parse_html_tables(body_html_or_soup)
    all_positions.extend(html_positions)

    # 2. Text-based table fallback if HTML table yielded nothing
    if not all_positions and text:
        text_positions = extract_positions_from_text(text)
        all_positions.extend(text_positions)

    # 3. Attachments (XLSX / PDF) if fetcher is available
    if attachments and fetch_attachment_fn:
        for att in attachments:
            url = att.get('url', '')
            title = att.get('title', '')
            is_pos_doc = bool(
                re.search(r'岗位|职位|专业|需求|招聘计划|人员一览|汇总表|需求表', title)
                or re.search(r'\.(xlsx?|pdf)(?:\?|$)', url, re.I)
            )
            if not is_pos_doc or not url:
                continue

            try:
                data = fetch_attachment_fn(url)
                if not data:
                    continue
                if re.search(r'\.xlsx?(?:\?|$)', url, re.I) or 'excel' in title.lower() or '表格' in title:
                    att_positions = parse_excel_bytes(data, filename=title)
                    all_positions.extend(att_positions)
                elif re.search(r'\.pdf(?:\?|$)', url, re.I):
                    att_positions = parse_pdf_bytes(data, filename=title)
                    all_positions.extend(att_positions)
            except Exception:
                continue

            if len(all_positions) >= 50:
                break

    return deduplicate_positions(all_positions)


def enrich_job_with_positions(job: Dict[str, Any], positions: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Enrich job object with parsed positions, majors, location evidence, and search keywords."""
    if not positions:
        return job

    job['positions'] = positions
    job['position_count'] = len(positions)
    job['sample_positions'] = [p['name'] for p in positions[:4] if p.get('name')]

    # Distinct majors
    all_majors: List[str] = []
    for p in positions:
        all_majors.extend(p.get('majors', []))
    distinct_majors = list(dict.fromkeys(all_majors))
    if distinct_majors:
        job['majors'] = distinct_majors[:12]

    # Location enrichment from positions
    cities = list(job.get('cities') or [])
    location_evidence = list(job.get('location_evidence') or [])
    for p in positions:
        pos_city = p.get('city', '')
        for c in SHANDONG_CITIES:
            if c in pos_city and c not in cities:
                cities.append(c)
                location_evidence.append(f'岗位表标注工作地点：{c}（{p.get("name", "")}）')

    job['cities'] = cities
    job['location_evidence'] = location_evidence[:15]

    # Directions enrichment
    directions = list(job.get('directions') or [])
    dir_rules = [
        ('财务 / 经济', r'财务|会计|审计|经济|金融|财会|风控'),
        ('管理 / 职能', r'管理|行政|人力|人事|运营|采购|职能|管培|党建|文秘'),
        ('技术 / 研发', r'研发|工程师|技术|算法|软件|硬件|测试|机械|电气|工艺|化工|材料'),
        ('市场 / 销售', r'市场|销售|营销|客户经理|外贸|电商|商务'),
    ]
    all_names = ' '.join(p.get('name', '') + ' ' + ' '.join(p.get('majors', [])) for p in positions)
    for label, pat in dir_rules:
        if label not in directions and re.search(pat, all_names):
            directions.append(label)
    job['directions'] = directions

    return job
