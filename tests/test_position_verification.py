import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import contextlib
import io

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import collect as c
import ci_collect as ci


class PositionVerificationTests(unittest.TestCase):
    def setUp(self):
        self.source = next(s for s in c.SOURCES if s['id'] == 'lcu-positions')
        self.item = {'url': 'https://school.gxjy.sdei.edu.cn/lcu/school/companyissueinfo/edit1/21597',
                     'title': '单位名称待核实 · 生产管培生', 'published_at': '2026-09-17',
                     'structured': {'specialty': '错误旧专业', 'endtime': '2026-12-31'}}
        self.html = '<h1>职位详情</h1>' + ''.join(
            f'<div class="info-item"><strong>{key}：</strong><span>{value}</span></div>'
            for key, value in [('单位名称', '测试乳业有限公司'), ('学历要求', '硕士生毕业'),
                               ('工作地点', '山东省济南市'), ('专业要求', '食品科学；化学工程'),
                               ('职位描述', '2027届毕业生，请将简历发送到 hr@example.com')]) + '<footer>school@example.org</footer>'

    def test_real_detail_enriches_employer_majors_and_public_application_email(self):
        job = c.parse_sdei_position_detail(self.html, self.item, self.source)
        self.assertEqual(job['company'], '测试乳业有限公司')
        self.assertEqual(set(job['majors']), {'食品科学', '化学工程'})
        self.assertEqual(job['emails'], ['hr@example.com'])
        self.assertEqual(job['detail_verification'], 'verified')
        self.assertIn('2026-12-31', job['deadline'])

    def test_accessible_detail_without_degree_or_location_is_verified(self):
        # A legitimate accessible position page missing degree or location still verifies and publishes
        html_without_degree_or_loc = '<h1>职位详情</h1>' + ''.join(
            f'<div class="info-item"><strong>{key}：</strong><span>{value}</span></div>'
            for key, value in [('单位名称', '青岛智能软件有限公司'),
                               ('专业要求', '计算机科学'),
                               ('职位描述', '2027届开发岗位')])
        job = c.parse_sdei_position_detail(html_without_degree_or_loc, self.item, self.source)
        self.assertEqual(job['company'], '青岛智能软件有限公司')
        self.assertEqual(job['detail_verification'], 'verified')
        self.assertTrue(c.publishable_job(job))

    def test_error_and_login_and_list_pages_are_not_verified(self):
        for body in ['{"msg":null,"code":500}', '<h1>请登录</h1>', '<div id="zoom">列表职责</div>']:
            with self.assertRaises(ValueError):
                c.parse_sdei_position_detail(body, self.item, self.source)

    def test_inline_list_never_bypasses_verification_and_failure_hides_old_job(self):
        with TemporaryDirectory() as tmp, contextlib.redirect_stdout(io.StringIO()):
            args = SimpleNamespace(data_dir=tmp, public_dir=tmp, sources=self.source['id'],
                pages=1, days=180, refresh_hours=0, nankai_area=0, target_city='', offerjack_pages=1,
                detail_timeout=1, detail_retries=0, detail_failure_limit=3, deep_scan=False,
                force_positions=False, sdei_group=None)
            item = dict(self.item, inline_html='<div id="zoom">列表不是详情</div>')
            for response, visible in [(self.html, 1), ('{"code":500}', 0), (self.html, 1)]:
                with patch.object(c, 'sdei_list', return_value=([item],1)), patch.object(c, 'fetch', return_value=response) as fetch:
                    c.run(args)
                self.assertTrue(fetch.called)
                state=json.loads((Path(tmp)/'state.json').read_text(encoding='utf-8'))
                snapshot=json.loads((Path(tmp)/'jobs.json').read_text(encoding='utf-8'))
                self.assertEqual(len(state['jobs']),1)
                self.assertEqual(len(snapshot['jobs']),visible)
                if not visible:
                    self.assertTrue(state['pending'][self.source['id']])

    def test_application_anchor_is_extracted(self):
        html=self.html.replace('hr@example.com','<a href="https://jobs.example.com/apply">投递简历</a>')
        job=c.parse_sdei_position_detail(html,self.item,self.source)
        self.assertEqual(job['application_url'],'https://jobs.example.com/apply')

    def test_export_hides_failed_and_legacy_and_restores_verified_records(self):
        job = c.parse_sdei_position_detail(self.html, self.item, self.source)
        jobs, _ = c.merge({}, [job], '2026-09-18T09:00:00+08:00')
        with TemporaryDirectory() as tmp:
            for flag, count in [('verified', 1), ('failed', 0), (None, 0), ('verified', 1)]:
                jobs[job['id']]['detail_verification'] = flag
                state = {'jobs': jobs, 'sources': {}, 'last_run_at': '2026-09-18T09:00:00+08:00'}
                snapshot = c.export_snapshot(state, Path(tmp))
                self.assertEqual(len(snapshot['jobs']), count)
                self.assertEqual(snapshot['raw_records'], count)
                self.assertEqual(len(state['jobs']), 1)
                search = json.loads((Path(tmp)/snapshot['search_url'].lstrip('/')).read_text(encoding='utf-8'))
                self.assertEqual(len(search['jobs']), count)
                if count:
                    restored = ci.snapshot_state(snapshot, lambda url: json.loads((Path(tmp)/url.lstrip('/')).read_text(encoding='utf-8')))
                    self.assertTrue(c.publishable_job(restored['jobs'][job['id']]))
