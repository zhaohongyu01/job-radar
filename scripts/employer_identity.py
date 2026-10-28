"""Keep official employer brand and department separate from retained company facts."""
import json
from pathlib import Path
import re

CONFIG = json.loads((Path(__file__).resolve().parents[1] / 'config/employer-brands.json').read_text(encoding='utf-8'))
DEPARTMENT = re.compile(CONFIG['department_pattern'])


def employer_identity(job):
    brand = CONFIG['sources'].get(job.get('source_id'))
    if not brand:
        return {}
    result = {'employer_brand': brand}
    company = (job.get('company') or '').strip()
    if company and DEPARTMENT.search(company):
        result['company_department'] = company
    return result
