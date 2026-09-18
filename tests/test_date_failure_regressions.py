import contextlib
import io
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import collect as c


class DateFailureRegressions(unittest.TestCase):
    def test_old_record_deadline_is_repaired_without_deleting_it(self):
        row = c.public_record({'id': 'old', 'title': '招聘公告', 'company': '',
            'body': '长期报名，招满即止，未招满的岗位报名有效期至2025年11月30日。',
            'source_id': 'bzmc-announcements', 'published_at': '2026-10-12',
            'cities': [], 'location_evidence': [], 'deadline': None})
        self.assertEqual(row['id'], 'old')
        self.assertEqual(row['deadline'], '2025-11-30T23:59:59+08:00')
        self.assertEqual(row['published_at'], '2026-10-12')
        self.assertIsNone(c.deadline('学历证书须在2025年12月31日前取得')[0])

    def test_transport_failures_preserve_verified_job_but_invalid_detail_hides_it(self):
        url = 'https://school.gxjy.sdei.edu.cn/lcu/school/companyissueinfo/edit1/21597'
        item = {'url': url, 'title': '测试公司 · 财务', 'kind': '具体岗位',
                'published_at': '2026-09-18', 'structured': {}}
        html = '<h1>职位详情</h1>' + ''.join(
            f'<div class="info-item"><strong>{k}：</strong><span>{v}</span></div>'
            for k, v in [('单位名称', '测试公司'), ('工作地点', '济南市'),
                         ('职位描述', '招聘财务人员，请投递至hr@example.com')])
        cases = [TimeoutError('simulated'), HTTPError(url, 403, 'simulated', {}, None),
                 HTTPError(url, 500, 'simulated', {}, None),
                 HTTPError(url, 404, 'simulated', {}, None),
                 HTTPError(url, 410, 'simulated', {}, None), '{"msg":null,"code":500}']
        for index, response in enumerate(cases):
            with self.subTest(index=index), TemporaryDirectory() as tmp, \
                    contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()), \
                    patch.dict(c.os.environ, {'GITHUB_STEP_SUMMARY': ''}), \
                    patch.object(c, 'sdei_list', return_value=([item], 1)), \
                    patch.object(c, 'fetch_bytes', side_effect=AssertionError('unexpected network')):
                args = SimpleNamespace(data_dir=tmp, public_dir=tmp, sources='lcu-positions',
                    pages=1, days=180, refresh_hours=0, nankai_area=0, target_city='',
                    offerjack_pages=1, detail_timeout=1, detail_retries=0,
                    detail_failure_limit=3, deep_scan=False, force_positions=True, sdei_group=None)
                with patch.object(c, 'fetch', return_value=html):
                    c.run(args)
                before = json.loads((Path(tmp)/'state.json').read_text(encoding='utf-8'))
                with patch.object(c, 'fetch', **({'side_effect': response} if isinstance(response, Exception)
                                                else {'return_value': response})):
                    c.run(args)
                state = json.loads((Path(tmp)/'state.json').read_text(encoding='utf-8'))
                snapshot = json.loads((Path(tmp)/'jobs.json').read_text(encoding='utf-8'))
                self.assertEqual(len(state['jobs']), 1)
                self.assertEqual(len(snapshot['jobs']), 1 if index < 3 else 0)
                if index < 3:
                    identifier = next(iter(state['jobs']))
                    self.assertEqual(state['jobs'][identifier]['last_verified_at'],
                                     before['jobs'][identifier]['last_verified_at'])
