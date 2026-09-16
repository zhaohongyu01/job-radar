import datetime as dt
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import collect as c
import ci_collect as ci
import diagnose_sdei as diagnostic


class RequestDiagnosticsTests(unittest.TestCase):
    def test_api_failure_identifies_stage_without_query_credentials(self):
        error = urllib.error.HTTPError('https://example.test/api', 403, 'Forbidden', {}, None)
        with patch.object(c, 'pace'), patch.object(c.OPENER, 'open', side_effect=error), patch.object(c, 'retry_request', return_value=False):
            with self.assertRaises(urllib.error.HTTPError) as caught:
                c.fetch('https://user:secret@example.test/api?token=secret', request_stage='announcements_list')
        report = caught.exception.request_diagnostic
        self.assertEqual(report['url'], 'https://example.test/api')
        self.assertEqual(report['stage'], 'announcements_list')
        self.assertEqual(report['http_status'], 403)
        self.assertNotIn('secret', json.dumps(report))

    def test_diagnostic_respects_shared_cooldown_without_network(self):
        source = next(s for s in c.SOURCES if s['id'] == 'ujn-announcements')
        future = (dt.datetime.now(c.TZ) + dt.timedelta(hours=2)).isoformat()
        with patch.object(c, 'sdei_list') as listing:
            report, code = diagnostic.diagnose(source, {'sources': {'jobsdufe-announcements': {'blocked_until': future}}})
        listing.assert_not_called()
        self.assertEqual(code, 2)
        self.assertEqual(report['result'], 'cooldown')

    def test_diagnostic_checks_one_page_and_does_not_claim_detail_success(self):
        source = next(s for s in c.SOURCES if s['id'] == 'ujn-announcements')
        with patch.object(c, 'sdei_list', return_value=([{'title': 'Job'}], 4)) as listing:
            report, code = diagnostic.diagnose(source, {'sources': {}})
        listing.assert_called_once_with(source, 1)
        self.assertEqual(code, 0)
        self.assertEqual(report['result'], 'list_verified')

    def test_report_distinguishes_rejection_and_shared_skip(self):
        with TemporaryDirectory() as tmp:
            summary = Path(tmp) / 'summary.md'
            state = {'jobs': {}, 'sources': {
                'a': {'name': 'A', 'status': 'blocked', 'errors': [{'reason': 'HTTP Error 403', 'request': {'stage': 'portal', 'http_status': 403}}]},
                'b': {'name': 'B', 'status': 'blocked', 'errors': []}}}
            with patch.dict(c.os.environ, {'GITHUB_STEP_SUMMARY': str(summary)}):
                ci.write_report(Path(tmp), 0, state, pack_name='universities-b')
            text = summary.read_text(encoding='utf-8')
            self.assertIn('请求被拒绝', text)
            self.assertIn('共享冷却跳过', text)
            self.assertIn('没有成功核验', text)
            self.assertIn('portal', text)
