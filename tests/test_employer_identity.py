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
from employer_identity import CONFIG, employer_identity, refine_company_facts
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
        self.assertEqual(employer_identity({'source_id': 'weichai-campus', 'company': '未来技术研究院'}),
                         {'employer_brand': '潍柴动力', 'company_department': '未来技术研究院'})
        self.assertEqual(employer_identity({'source_id': 'qilu-pharma-campus', 'company': '创新药物研发中心(济南）'}),
                         {'employer_brand': '齐鲁制药', 'company_department': '创新药物研发中心(济南）'})
        self.assertEqual(employer_identity({'source_id': 'tsingtao-campus', 'company': '山东省区'}),
                         {'employer_brand': '青岛啤酒', 'company_department': '山东省区'})
        self.assertEqual(employer_identity({'source_id': 'linglong-social', 'company': '集团职能'}),
                         {'employer_brand': '玲珑轮胎', 'company_department': '集团职能'})
        self.assertEqual(employer_identity({'source_id': 'chinastock-campus', 'company': '投资银行业务线'}),
                         {'employer_brand': '中国银河证券', 'company_department': '投资银行业务线'})
        self.assertEqual(employer_identity({'source_id': 'picc-campus', 'company': '所属区县及以下机构'}),
                         {'employer_brand': '中国人民保险集团', 'company_department': '所属区县及以下机构'})
        self.assertEqual(employer_identity({'source_id': 'chinalife-campus', 'company': '寿险山东省分公司'}),
                         {'employer_brand': '中国人寿集团', 'company_department': '寿险山东省分公司'})

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

    def test_refine_company_facts_extracts_group_title_and_replaces_talks_host_school(self):
        talk_row = refine_company_facts({
            'source_id': 'sdu-talks',
            'source_name': '山东大学 · 校园宣讲',
            'company': '山东大学',
            'title': '齐鲁银行2027届校园宣讲会',
            'body': '宣讲单位：齐鲁银行股份有限公司。欢迎同学们参加。',
        })
        self.assertEqual(talk_row['company'], '齐鲁银行')
        self.assertEqual(talk_row.get('company_original'), '山东大学')

        group_row = refine_company_facts({
            'source_id': 'ouc-announcements',
            'source_name': '中国海洋大学 · 招聘公告',
            'company': '',
            'title': '浪潮集团2027届全球校园招聘简章',
            'body': '欢迎投递浪潮集团校园招聘岗位。',
        })
        self.assertEqual(group_row['company'], '浪潮集团')

        # Host school genuinely recruiting for itself keeps host school as company
        own_talk = refine_company_facts({
            'source_id': 'sdu-talks',
            'source_name': '山东大学 · 校园宣讲',
            'company': '山东大学',
            'title': '山东大学2027年诚聘海内外优秀青年学者宣讲会',
            'body': '山东大学人事部宣讲。',
        })
        self.assertEqual(own_talk['company'], '山东大学')


if __name__ == '__main__':
    unittest.main()
