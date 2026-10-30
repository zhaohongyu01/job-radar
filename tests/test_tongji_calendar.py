"""Verified anonymous Tongji list; no recruitment detail requests required."""
import contextlib
import io
import json
import sys
import unittest
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import collect as c
from external_calendars import tongji_calendar
from city_registry import resolve_event_city
from city_coverage import build_city_coverage

FIXTURE = json.loads((Path(__file__).parent / 'fixtures/tongji-calendar.json').read_text(encoding='utf-8'))
SOURCE = next(s for s in c.SOURCES if s['id'] == 'tongji-talks')


class TongjiCalendarTests(unittest.TestCase):
    def test_explicit_online_mode_does_not_become_shanghai_work_city(self):
        items, pages = tongji_calendar(FIXTURE, SOURCE['url'])
        self.assertEqual(pages, 18)
        physical, online = [c.calendar_record(item, SOURCE) for item in items]
        self.assertEqual(physical['talk_event']['city'], '上海')
        self.assertEqual(physical['talk_event']['school'], '同济大学')
        self.assertEqual(physical['talk_event']['start_time'], '10:30')
        self.assertEqual(physical['talk_event']['end_time'], '11:00')
        self.assertEqual(online['talk_event']['mode'], 'online')
        self.assertIsNone(online['talk_event']['city'])
        self.assertEqual(physical['cities'], [])
        self.assertIsNone(physical['published_at'])
        self.assertIn('tongji-talks', c.SOURCE_PACKS['universities-a'])
        self.assertNotIn('tongji-talks', c.SOURCE_PACKS['universities-b'])
        self.assertIsNone(resolve_event_city('同济大学', '四平市 四平校区')[0])
        self.assertNotEqual(resolve_event_city('未知学校', '四平校区')[0], '上海')
        definitions = json.loads((Path(__file__).resolve().parents[1] / 'config/source-coverage.json').read_text(encoding='utf-8'))
        report = build_city_coverage({'generated_at': '2026-10-30T04:00:00Z', 'sources': [], 'jobs': []}, definitions)
        self.assertIn('tongji-talks', [row['id'] for row in report['cities']['上海']['calendar_sources']])

    def test_changed_dates_login_pages_and_external_links_are_not_empty_successes(self):
        for value in [{'state': 0, 'msg': '请登录'}, {'state': 1, 'object': {'list': []}}]:
            with self.assertRaises(ValueError): tongji_calendar(value, SOURCE['url'])
        for key, value in [('startTime', '2026-02-30 10:30:00'), ('endTime', '2026-10-29 11:00:00'), ('url', 'https://evil.example/talk')]:
            payload = deepcopy(FIXTURE); payload['object']['list'][0][key] = value
            with self.assertRaises(ValueError): tongji_calendar(payload, SOURCE['url'])
        self.assertEqual(tongji_calendar({'state': 1, 'object': {'list': [], 'totalPage': 0, 'count': 0}}, SOURCE['url']), ([], 1))

    def test_real_orchestration_keeps_two_page_budget_resume_and_zero_details(self):
        calls = []
        def fetch(url, **kwargs):
            self.assertEqual(url, 'https://tj91.tongji.edu.cn/f/recruitmentFair/ajax_frontRecruitfair')
            form = kwargs['form']; calls.append(form['pageNo'])
            payload = deepcopy(FIXTURE)
            for row in payload['object']['list']:
                row['id'] += '-' + str(form['pageNo'])
            return json.dumps(payload)
        with TemporaryDirectory() as temp, contextlib.redirect_stdout(io.StringIO()):
            args = SimpleNamespace(data_dir=temp, public_dir=temp, sources='tongji-talks', pages=8, days=30,
                refresh_hours=72, nankai_area=0, target_city='', offerjack_pages=1, probe_budget=0, state_only=True)
            with patch.object(c, 'fetch', side_effect=fetch):
                self.assertEqual(c.run(args), 0)
                first = json.loads((Path(temp) / 'state.json').read_text(encoding='utf-8'))
                self.assertEqual(len(first['jobs']), 4)
                self.assertFalse(first['sources']['tongji-talks']['list_complete'])
                self.assertEqual(first['pending']['tongji-talks'], [])
                self.assertEqual(c.run(args), 0)
            self.assertEqual(calls, [1, 2, 1, 3])


if __name__ == '__main__':
    unittest.main()

