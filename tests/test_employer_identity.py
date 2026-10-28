import copy
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests'))
import collect
from employer_identity import CONFIG, employer_identity
from test_ci_collect import fixture


class EmployerIdentityTests(unittest.TestCase):
    def test_brand_mapping_matches_registered_official_sources(self):
        sources = {source['id']: source for source in collect.SOURCES}
        for identifier, brand in CONFIG['sources'].items():
            with self.subTest(identifier=identifier):
                self.assertEqual(sources[identifier]['institution'], brand)
                self.assertEqual(employer_identity({'source_id': identifier, 'company': '研发中心'}),
                                 {'employer_brand': brand, 'company_department': '研发中心'})

    def test_department_and_legal_company_are_retained_without_title_guessing(self):
        job = dict(source_id='hisense-campus', company='全球营销中心-中国区', title='销售经理（全国）(J45816)')
        self.assertEqual(employer_identity(job),
                         {'employer_brand': '海信集团', 'company_department': job['company']})
        self.assertEqual(employer_identity(dict(job, source_id='unknown', company='研发中心', title='嵌入式软件工程师')), {})
        self.assertEqual(employer_identity(dict(job, company='海信视像科技股份有限公司')), {'employer_brand': '海信集团'})
        self.assertEqual(job['company'], '全球营销中心-中国区')

    def test_public_projection_does_not_mutate_raw_identity_or_history(self):
        job = next(iter(fixture()['jobs'].values()))
        job.update(source_id='hisense-campus', source_name='海信集团 · 校园招聘', company='全球营销中心-中国区',
                   title='销售经理（全国）(J45816)', body='工作地点：北京。岗位要求：市场营销专业。')
        before = copy.deepcopy(job)
        row = collect.public_record(job)
        self.assertEqual(job, before)
        enriched = dict(before, **employer_identity(before))
        self.assertEqual(collect.compute_job_fingerprint(enriched), collect.compute_job_fingerprint(before))
        for field in ('id', 'source_id', 'company', 'first_seen_at', 'updated_at', 'last_verified_at', 'revision'):
            self.assertEqual(row[field], before[field], field)
        self.assertEqual(row['employer_brand'], '海信集团')
        self.assertEqual(row['company_department'], before['company'])
        self.assertIn('海信集团', collect.build_search_text(row))
        self.assertEqual(collect.public_record(row)['employer_brand'], '海信集团')
        self.assertEqual(collect.build_search_text({'body': '原有正文'}), '原有正文')

    def test_export_includes_brand_in_index_details_and_search_without_network(self):
        state = fixture()
        row = next(iter(state['jobs'].values()))
        row.update(source_id='hisense-campus', source_name='海信集团 · 校园招聘', company='研发中心', title='软件工程师')
        before = copy.deepcopy(state)
        with TemporaryDirectory() as tmp, patch('socket.socket.connect', side_effect=AssertionError('No network')):
            root = Path(tmp)
            exported = collect.export_snapshot(state, root)
            job = next(job for job in exported['jobs'] if job['id'] == row['id'])
            self.assertEqual(job['company'], '研发中心')
            self.assertEqual(job['employer_brand'], '海信集团')
            detail_url = exported['detail_shards'][job['id'][:2]]
            details = json.loads((root / detail_url.lstrip('/')).read_text(encoding='utf-8'))
            self.assertEqual(details['jobs'][job['id']]['employer_brand'], '海信集团')
            search = json.loads((root / exported['search_url'].lstrip('/')).read_text(encoding='utf-8'))
            self.assertIn('海信集团', search['jobs'][job['id']])
        self.assertEqual(state, before)


if __name__ == '__main__':
    unittest.main()
