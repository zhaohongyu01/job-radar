import contextlib
from copy import deepcopy
import datetime as dt
import io
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import collect as c
from campus_talks import bysjy_calendar
from external_calendars import js91_calendar
from city_registry import resolve_event_city

FIXTURES = json.loads((ROOT / 'tests/fixtures/additional-calendars.json').read_text(encoding='utf-8'))


class AdditionalCalendarTests(unittest.TestCase):
    def test_verified_public_calendars_keep_host_city_separate_from_employer_and_work_city(self):
        for key, city in [('scau', '广州'), ('sztu', '深圳')]:
            source = next(s for s in c.SOURCES if s['id'] == key + '-talks')
            item, = bysjy_calendar(FIXTURES[key], source)
            job = c.calendar_record(item, source)
            self.assertEqual(job['talk_event']['city'], city)
            self.assertEqual(job['cities'], [])
            self.assertIsNone(job['published_at'])
            self.assertIn(source['id'], c.SOURCE_PACKS['universities-a'])
            online = deepcopy(FIXTURES[key])
            online['data'][0]['is_yun'] = '1'
            self.assertIsNone(c.calendar_record(bysjy_calendar(online, source)[0], source)['talk_event']['city'])

    def test_js91_uses_public_identity_exact_school_and_event_dates_without_contacts(self):
        source = next(s for s in c.SOURCES if s['id'] == 'nuist-talks')
        items, pages = js91_calendar(FIXTURES['nuist'], source)
        self.assertEqual(pages, 5)
        online, physical = [c.calendar_record(item, source) for item in items]
        self.assertEqual(online['talk_event']['mode'], 'online')
        self.assertIsNone(online['talk_event']['city'])
        self.assertEqual(physical['talk_event']['city'], '南京')
        self.assertEqual(physical['talk_event']['end_time'], '16:30')
        self.assertEqual(physical['cities'], [])
        self.assertIn('xjhid=1000000000342208', physical['source_url'])
        self.assertEqual(physical['id'], c.calendar_record(items[1], source)['id'])
        self.assertIsNone(resolve_event_city('未知学校', '创业园1号楼108宣讲室')[0])
        self.assertIsNone(resolve_event_city(source['school_name'], '北京 创业园1号楼108宣讲室')[0])

    def test_js91_login_errors_changed_identity_and_conflicting_dates_are_not_empty_successes(self):
        source = next(s for s in c.SOURCES if s['id'] == 'nuist-talks')
        for payload in [{'code': 403, 'message': '需要登录'}, {'success': False, 'code': 500}]:
            with self.assertRaises(ValueError): js91_calendar(payload, source)
        for key, value in [('jbxx', '其他大学'), ('jbrq', '2026-02-30'), ('kssjd', '2026-11-03 14:30—16:30')]:
            payload = deepcopy(FIXTURES['nuist']); payload['result']['records'][1][key] = value
            with self.assertRaises(ValueError): js91_calendar(payload, source)
        empty = {'success': True, 'code': 200, 'result': {'total': 0, 'records': []}}
        self.assertEqual(js91_calendar(empty, source), ([], 1))

    def test_js91_collection_posts_json_and_publishes_events_without_detail_requests(self):
        payload = deepcopy(FIXTURES['nuist'])
        payload['result']['total'] = len(payload['result']['records'])
        tomorrow = (dt.datetime.now(c.TZ) + dt.timedelta(days=1)).date().isoformat()
        for row in payload['result']['records']:
            row['jbrq'] = tomorrow
            row['kssjd'] = tomorrow + ' 14:30—16:30'
        with TemporaryDirectory() as temp, contextlib.redirect_stdout(io.StringIO()):
            args = SimpleNamespace(data_dir=temp, public_dir=temp, sources='nuist-talks', pages=1, days=30,
                refresh_hours=72, nankai_area=0, target_city='', offerjack_pages=1, probe_budget=10, state_only=True, head_only=True)
            with patch.object(c, 'fetch_json_post', return_value=payload) as post, patch.object(c, 'fetch', side_effect=AssertionError('Unexpected HTML/detail request')):
                self.assertEqual(c.run(args), 0)
            self.assertEqual(post.call_count, 1)
            self.assertEqual(post.call_args.args[1]['xxdm'], '10300')
            state = json.loads((Path(temp) / 'state.json').read_text(encoding='utf-8'))
            self.assertEqual(len(state['jobs']), 2)
            self.assertEqual(state['pending']['nuist-talks'], [])
            self.assertTrue(all(row['detail_verification'] == 'pending' for row in state['jobs'].values()))


if __name__ == '__main__':
    unittest.main()
