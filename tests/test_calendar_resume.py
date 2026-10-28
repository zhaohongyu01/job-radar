"""Exercise real collector orchestration with bounded, synthetic calendar pages."""
import contextlib
import io
import json
import re
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import collect as c


class CalendarResumeTests(unittest.TestCase):
    def run_round(self, directory, source_id, total=4, fail=None, head_only=False):
        calls = []
        args = SimpleNamespace(data_dir=directory, public_dir=directory, sources=source_id,
            pages=8, days=30, refresh_hours=72, nankai_area=0, target_city='',
            offerjack_pages=1, probe_budget=0, state_only=True, head_only=head_only)

        def fetch(url, **kwargs):
            if kwargs.get('form'):
                return json.dumps({'page': kwargs['form']['pageNo']})
            if 'getcareers?' in url:
                return json.dumps({'page': int(parse_qs(urlsplit(url).query)['start'][0]) // 20 + 1})
            return str(int(m[1]) if (m := re.search(r'/p/(\d+)\.html', url)) else 1)

        def listing(page):
            calls.append(page)
            if page == fail:
                raise OSError('calendar connection interrupted')
            count = 21 if source_id.startswith('sdjt') and page < total else 1
            return [{'url': f'https://example.test/event/{page}/{n}', 'title': f'校园宣讲 {page}-{n}',
                'published_at': None, 'kind': '宣讲会', 'calendar_only': True,
                'structured': {'fairDate': '2099-11-01', 'fairStartTime': '14:00',
                               'schoolName': '北京大学', 'fairAddress': '英杰交流中心'}} for n in range(count)]

        with patch.object(c, 'fetch', side_effect=fetch), \
             patch.object(c, 'nankai_calendar', side_effect=lambda html, base: (listing(int(html)), total)), \
             patch.object(c, 'pku_calendar', side_effect=lambda data, base: (listing(data['page']), total)), \
             patch.object(c, 'bysjy_calendar', side_effect=lambda data, source: listing(data['page'])), \
             contextlib.redirect_stdout(io.StringIO()):
            c.run(args)
        return calls, json.loads((Path(directory) / 'state.json').read_text(encoding='utf-8'))

    def test_numbered_calendars_refresh_head_and_resume_with_two_page_budget(self):
        for source in ('nankai-talks', 'pku-talks', 'sdjt-talks'):
            with self.subTest(source=source), TemporaryDirectory() as tmp:
                rounds = [self.run_round(tmp, source) for _ in range(3)]
                self.assertEqual([r[0] for r in rounds], [[1, 2], [1, 3], [1, 4]])
                self.assertFalse(rounds[0][1]['sources'][source]['list_complete'])
                self.assertIn('第 3 页', rounds[0][1]['sources'][source]['coverage'])
                self.assertTrue(rounds[-1][1]['sources'][source]['list_complete'])
                self.assertTrue(any('/4/' in j['source_url'] for j in rounds[-1][1]['jobs'].values()))
                self.assertEqual(self.run_round(tmp, source)[0], [1, 2])
                self.assertEqual(self.run_round(tmp, source)[0], [1, 3])

    def test_failed_page_retries_and_does_not_mark_calendar_complete(self):
        with TemporaryDirectory() as tmp:
            source = 'pku-talks'
            self.run_round(tmp, source)
            calls, state = self.run_round(tmp, source, fail=3)
            self.assertEqual(calls, [1, 3])
            self.assertFalse(state['sources'][source]['list_complete'])
            self.assertEqual(state['sources'][source]['resume_page'], 3)
            self.assertEqual(self.run_round(tmp, source)[0], [1, 3])

    def test_head_only_pass_preserves_deep_cursor(self):
        with TemporaryDirectory() as tmp:
            source = 'nankai-talks'
            self.run_round(tmp, source)
            self.assertEqual(self.run_round(tmp, source, head_only=True)[0], [1, 2])
            self.assertEqual(self.run_round(tmp, source)[0], [1, 3])

    def test_exact_total_shrink_clamps_cursor(self):
        with TemporaryDirectory() as tmp:
            source = 'pku-talks'
            self.run_round(tmp, source)
            calls, state = self.run_round(tmp, source, total=2)
            self.assertEqual(calls, [1, 2])
            self.assertTrue(state['sources'][source]['list_complete'])


if __name__ == '__main__':
    unittest.main()
