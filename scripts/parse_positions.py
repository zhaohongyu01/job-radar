"""Extract structured positions, majors, degrees and locations from recruitment tables and attachments."""
from __future__ import annotations

import io
import re
import json
from pathlib import Path
import subprocess
import sys
import time
from typing import Any, Callable, Dict, List, Optional

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

    def is_likely_header_row(cells: List[str]) -> bool:
        non_empty = [c for c in cells if c]
        if len(non_empty) < 2:
            return False
        # Do not treat a data value such as ``财务岗位`` or ``审计专业`` as a
        # header merely because it contains a header keyword.  A header row is
        # made up of the short, conventional field labels below.  Requiring
        # almost every non-empty cell to be an exact label also keeps the
        # multi-row header detector from swallowing the first data rows.
        header_label = re.compile(
            r'^(?:序号|编号|代码|岗位|职位|工种|岗位名称|职位名称|招聘岗位|招聘职位|需求岗位|岗位代号|职位代码|岗位代码|岗位类别|职位类别|类别|方向|岗位方向|专业类别|部门|用人单位|招聘单位|单位|单位名称|企业|企业名称|公司名称|用人单位名称|专业|需求|需求专业|招聘专业|专业要求|所学专业|学历|学历要求|最低学历|学位|学历学位|学历学位要求|人数|招聘人数|需求人数|地点|城市|工作地点|工作城市|工作地|工作区域|招聘地点|招聘城市|届别|毕业届别|毕业生|应届要求|资格要求|招聘条件|任职条件|其他条件|要求|条件|备注|说明|职责|工作内容|职责备注|生源|层次|范围|学科|岗位性质|招聘类型|报名条件)(?:[（(【\[][^】\)】\]]{0,30}[）)】\]]|[/:：、及&+].*)?$',
            re.I,
        )
        exact_count = sum(1 for cell in non_empty if header_label.fullmatch(cell.strip()))
        return exact_count >= 2 and exact_count >= len(non_empty) - 1 and all(len(c) <= 50 for c in non_empty)

    best_candidate = None
    for start_r in range(min(5, len(grid))):
        for depth in (1, 2, 3):
            if start_r + depth > len(grid):
                continue
            if not all(is_likely_header_row([clean_cell(c) for c in grid[r]]) for r in range(start_r, start_r + depth)):
                continue
            # Build composite header row across rows in this header block
            max_cols = max(len(grid[r]) for r in range(start_r, start_r + depth))
            composite = []
            for c in range(max_cols):
                parts = [clean_cell(grid[r][c]) for r in range(start_r, start_r + depth) if c < len(grid[r]) and clean_cell(grid[r][c])]
                composite.append(' '.join(parts))

            mapping: Dict[str, int] = {}
            for c_idx, cell in enumerate(composite):
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

            if 'specific_name' in mapping:
                mapping['name'] = mapping['specific_name']
            elif 'fallback_name' in mapping:
                mapping['name'] = mapping['fallback_name']
            elif 'category' in mapping:
                mapping['name'] = mapping['category']

            col_assigned = {k: mapping[k] for k in ('name', 'majors', 'education', 'count', 'city', 'cohort') if k in mapping}
            distinct_cols = set(col_assigned.values())
            has_id_col = 'name' in mapping or 'majors' in mapping
            if has_id_col and len(distinct_cols) >= 2:
                score = len(distinct_cols) * 10 + depth
                if best_candidate is None or score > best_candidate[0]:
                    best_candidate = (score, start_r, depth, mapping)

    header_idx = -1
    col_mapping: Dict[str, int] = {}
    if best_candidate:
        header_idx = best_candidate[1] + best_candidate[2] - 1
        col_mapping = best_candidate[3]

    positions: List[Dict[str, Any]] = []
    if header_idx >= 0 and col_mapping:
        for r_idx in range(header_idx + 1, len(grid)):
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


def _parse_html_tables_regex(html_str: str) -> List[Dict[str, Any]]:
    """Fallback standard-library HTML <table> parser when BeautifulSoup is unavailable."""
    if not html_str or '<table' not in html_str.lower():
        return []
    results: List[Dict[str, Any]] = []
    table_pattern = re.compile(r'<table[^>]*>(.*?)</table>', re.I | re.S)
    row_pattern = re.compile(r'<tr[^>]*>(.*?)</tr>', re.I | re.S)
    cell_pattern = re.compile(r'<t[hd][^>]*>(.*?)</t[hd]>', re.I | re.S)
    tag_cleaner = re.compile(r'<[^>]+>')

    for table_match in table_pattern.finditer(html_str):
        table_html = table_match.group(1)
        grid: List[List[str]] = []
        for row_match in row_pattern.finditer(table_html):
            row_html = row_match.group(1)
            raw_cells = cell_pattern.findall(row_html)
            cells = [clean_cell(tag_cleaner.sub('', c)) for c in raw_cells]
            if cells:
                grid.append(cells)
        if grid:
            parsed = parse_table_grid(grid, source_type='html_table')
            results.extend(parsed)
    return deduplicate_positions(results)


def _table_to_grid(table: Any) -> List[List[str]]:
    """Extract a 2D cell string grid from an HTML table element, expanding rowspan and colspan."""
    rows = table.find_all('tr') if hasattr(table, 'find_all') else []
    grid_cells: Dict[tuple, str] = {}
    for r_idx, r in enumerate(rows):
        col_idx = 0
        cells = r.find_all(['td', 'th']) if hasattr(r, 'find_all') else []
        for cell in cells:
            while (r_idx, col_idx) in grid_cells:
                col_idx += 1
            rowspan = 1
            colspan = 1
            attrs = getattr(cell, 'attrs', {}) or {}
            raw_rs = attrs.get('rowspan') if hasattr(attrs, 'get') else (cell.get('rowspan') if hasattr(cell, 'get') else 1)
            raw_cs = attrs.get('colspan') if hasattr(attrs, 'get') else (cell.get('colspan') if hasattr(cell, 'get') else 1)
            try:
                if raw_rs:
                    rowspan = max(1, min(int(raw_rs), 50))
            except (ValueError, TypeError):
                rowspan = 1
            try:
                if raw_cs:
                    colspan = max(1, min(int(raw_cs), 20))
            except (ValueError, TypeError):
                colspan = 1
            text = clean_cell(cell.get_text() if hasattr(cell, 'get_text') else cell.text if hasattr(cell, 'text') else str(cell))
            for dr in range(rowspan):
                for dc in range(colspan):
                    grid_cells[(r_idx + dr, col_idx + dc)] = text
            col_idx += colspan
    if not grid_cells:
        return []
    max_r = max(r for r, c in grid_cells.keys())
    max_c = max(c for r, c in grid_cells.keys())
    return [[grid_cells.get((r, c), '') for c in range(max_c + 1)] for r in range(max_r + 1)]


def parse_html_tables(html_or_soup: Any) -> List[Dict[str, Any]]:
    """Parse HTML <table> elements into structured positions."""
    if not html_or_soup:
        return []
    if isinstance(html_or_soup, str):
        if BeautifulSoup is not None:
            try:
                soup = BeautifulSoup(html_or_soup, 'html.parser')
                tables = soup.find_all('table')
                results: List[Dict[str, Any]] = []
                for table in tables:
                    grid = _table_to_grid(table)
                    if grid:
                        parsed = parse_table_grid(grid, source_type='html_table')
                        results.extend(parsed)
                return deduplicate_positions(results)
            except Exception:
                return _parse_html_tables_regex(html_or_soup)
        return _parse_html_tables_regex(html_or_soup)

    if hasattr(html_or_soup, 'find_all'):
        try:
            tables = html_or_soup.find_all('table')
            results = []
            for table in tables:
                grid = _table_to_grid(table)
                if grid:
                    parsed = parse_table_grid(grid, source_type='html_table')
                    results.extend(parsed)
            return deduplicate_positions(results)
        except Exception:
            return []

    return []


def parse_excel_bytes(file_bytes: bytes, filename: str = '') -> List[Dict[str, Any]]:
    """Parse XLSX bytes into structured positions."""
    if not openpyxl or not file_bytes:
        return []
    wb = None
    try:
        buf = io.BytesIO(file_bytes)
        wb = openpyxl.load_workbook(buf, read_only=True, data_only=True)
        results: List[Dict[str, Any]] = []

        # Look across sheets
        sheet_names = wb.sheetnames
        # Prioritize sheets with recruitment keywords in title
        # A workbook can keep different departments or cities on separate
        # sheets without putting a recruitment keyword in every sheet name.
        # Inspect every sheet; the header detector filters ordinary notes
        # sheets while avoiding silent loss from a name-based subset.
        target_sheets = sheet_names

        for name in target_sheets:
            sheet = wb[name]
            grid: List[List[str]] = []
            for row in sheet.iter_rows(values_only=True):
                grid.append([clean_cell(c) for c in row])
            parsed = parse_table_grid(grid, source_type='xlsx')
            for p in parsed:
                p['source_file'] = filename or name
            results.extend(parsed)

        return deduplicate_positions(results)
    except Exception:
        return []
    finally:
        try:
            wb.close()
        except Exception:
            pass


def parse_pdf_bytes(file_bytes: bytes, filename: str = '', max_pages: Optional[int] = None) -> List[Dict[str, Any]]:
    """Parse PDF bytes (using PyMuPDF find_tables) into structured positions."""
    if not fitz or not file_bytes:
        return []
    try:
        doc = fitz.open(stream=file_bytes, filetype='pdf')
        results: List[Dict[str, Any]] = []

        page_limit = len(doc) if max_pages is None else min(len(doc), max_pages)
        for page_idx in range(page_limit):
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
            for page_idx in range(page_limit):
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
            text = '\n'.join(doc[i].get_text() for i in range(page_limit))
            text_parsed = extract_positions_from_text(text)
            for p in text_parsed:
                p['source_file'] = filename or 'PDF文本'
            results.extend(text_parsed)

        return deduplicate_positions(results)
    except Exception:
        return []


def extract_positions_from_text(text: str, max_rows: Optional[int] = None) -> List[Dict[str, Any]]:
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
            return parsed if max_rows is None else parsed[:max_rows]

    return []


def deduplicate_positions(positions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Deduplicate positions by name, city, education, majors, cohort, and notes."""
    seen = set()
    unique = []
    for p in positions:
        name = p.get('name', '').strip()
        if not name or len(name) > 100:
            continue
        majors_key = ','.join(sorted(p.get('majors') or []))
        cohort = (p.get('cohort') or '').strip()
        notes = (p.get('notes') or '').strip()
        key = (
            name,
            p.get('category', '').strip(),
            p.get('city', '').strip(),
            p.get('education', '').strip(),
            p.get('count', '').strip(),
            majors_key,
            cohort,
            notes,
            p.get('source_url', '').strip(),
        )
        if key not in seen:
            seen.add(key)
            unique.append(p)
    return unique


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

    # CPU-heavy documents run outside the detail thread, so a damaged workbook
    # or PDF can be killed without losing the announcement or other sources.
    attachment_deadline = time.monotonic() + 20
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

            att['parse_status'] = 'deferred'
            if time.monotonic() >= attachment_deadline:
                continue

            try:
                data = fetch_attachment_fn(url)
                if not data:
                    continue
                kind = ('xlsx' if re.search(r'\.xlsx?(?:\?|$)', url, re.I) or 'excel' in title.lower() or '表格' in title
                        else 'pdf' if re.search(r'\.pdf(?:\?|$)', url, re.I) else '')
                if not kind:
                    att.pop('parse_status', None)
                    continue
                budget = min(8, attachment_deadline - time.monotonic())
                if budget <= 0:
                    continue
                result = subprocess.run([sys.executable, str(Path(__file__).with_name('attachment_worker.py')), kind, title],
                                        input=data, capture_output=True, timeout=budget, check=True)
                if len(result.stdout) > 8_000_000:
                    continue
                att_positions = json.loads(result.stdout)
                for p in att_positions:
                    p['source_url'] = url
                all_positions.extend(att_positions)
                att['parse_status'] = 'parsed' if att_positions else 'no_table'
            except Exception:
                continue

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
