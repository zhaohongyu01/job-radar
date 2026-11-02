import contextlib
import io
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import collect as c
import ci_collect as ci

NOTICE = '<html><title>跳转提示</title><body>操作失败！ 该信息已过期！</body></html>'
SOURCE = next(s for s in c.SOURCES if s['id'] == 'nankai')
ITEM = {'url': 'https://career.nankai.edu.cn/correcruit/content/id/119975.html', 'title': '历史招聘', 'published_at': '2026-10-01'}


class SourceExpiryTests(unittest.TestCase):
    def test_only_official_expiry_notice_is_terminal_not_blank_or_login(self):
        with self.assertRaises(c.SourceDetailExpired):
            c.parse_detail(NOTICE, ITEM, SOURCE)
        for html in ['<title>跳转提示</title>请登录', '<title>招聘公告</title>操作失败！该信息已过期！', '<html></html>']:
            with self.assertRaises(ValueError) as error:
                c.parse_detail(html, ITEM, SOURCE)
            self.assertNotIsInstance(error.exception, c.SourceDetailExpired)

    def test_official_expiry_keeps_history_and_removes_pending_without_false_parse_success(self):
        with TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            args = SimpleNamespace(data_dir=directory, public_dir=directory, sources='nankai', pages=1, days=180,
                refresh_hours=72, nankai_area=0, target_city='', offerjack_pages=1, probe_budget=0, state_only=True)
            with patch.object(c, 'fetch', return_value=NOTICE), patch.object(c, 'nankai_list', return_value=([ITEM], 1)):
                c.run(args)
            state = json.loads((Path(directory) / 'state.json').read_text(encoding='utf-8'))
            self.assertEqual(state['pending']['nankai'], [])
            self.assertEqual(state['sources']['nankai']['parsed'], 0)
            self.assertEqual(state['sources']['nankai']['detail_expired'], 2)  # includes the fixed discovery seed
            self.assertTrue(all(j['listing_status'] == 'withdrawn' for j in state['jobs'].values()))
            with patch.object(c, 'fetch', return_value=NOTICE), patch.object(c, 'nankai_list', return_value=([ITEM], 1)):
                c.run(args)
            refreshed = json.loads((Path(directory) / 'state.json').read_text(encoding='utf-8'))
            self.assertEqual(refreshed['sources']['nankai']['cached'], 2)
            self.assertEqual(refreshed['sources']['nankai']['detail_attempted'], 0)
            self.assertEqual(refreshed['pending']['nankai'], [])

    def test_timeout_recovery_does_not_requeue_or_count_terminal_notice_as_parsed_detail(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            prior = {'jobs': {}, 'sources': {}, 'pending': {'nankai': [ITEM]}}
            (root / 'state.json').write_text(json.dumps(prior), encoding='utf-8')
            (root / 'checkpoint.json').write_text(json.dumps({'source': SOURCE, 'pending': [ITEM], 'run_at': '2026-11-02T12:00:00+08:00'}), encoding='utf-8')
            job = c.parse_detail('<div id="zoom">来源明确提示信息过期。</div>', ITEM, {'id': 'fallback', 'name': SOURCE['name']})
            job.update(source_id='nankai', listing_status='withdrawn')
            (root / 'progress.jsonl').write_text(json.dumps({'job': job, 'url': ITEM['url'], 'verified': False, 'terminal': True}) + '\n', encoding='utf-8')
            recovered = ci.recover_source(root, SOURCE, prior, '2026-11-02T12:00:00+08:00', -1, True)
            self.assertEqual(recovered['pending']['nankai'], [])
            self.assertEqual(recovered['sources']['nankai']['parsed'], 0)
            self.assertEqual(recovered['sources']['nankai']['detail_expired'], 1)
            self.assertEqual(recovered['jobs'][job['id']]['listing_status'], 'withdrawn')


if __name__ == '__main__':
    unittest.main()
