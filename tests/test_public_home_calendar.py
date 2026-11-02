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
from external_calendars import public_home_calendar, check_home_calendar_robots

SOURCES = {row['id']: row for row in c.SOURCES if row.get('adapter') == 'public_home_calendar'}
UPC = '''<div class="jyxx-center-right-title-left"><h1>宣讲会</h1><h1>空中宣讲</h1></div>
<section class="jyxx-center-right-content"><li onclick='windowOpen("/career/xjhxx/view/1")'>
<div class="jyxx-center-right-content-ul-li"><span class="jyxx-center-right-content-ul-li-left-day">03</span>
<span class="jyxx-center-right-content-ul-li-left-month">2026/11</span><h2>示例单位宣讲</h2>
<aside class="jyxx-center-right-content-ul-li-right"><p>【古镇口校区】卓越A102</p><p>时间：16:00</p></aside></div></li></section>
<section class="jyxx-center-right-content"><li onclick='windowOpen("/career/xjhxx/view/2")'>
<div class="jyxx-center-right-content-ul-li"><span class="jyxx-center-right-content-ul-li-left-day">04</span>
<span class="jyxx-center-right-content-ul-li-left-month">2026/11</span><h2>线上示例单位</h2>
<aside class="jyxx-center-right-content-ul-li-right"><p>https://meeting.tencent.com/example</p><p>时间：14:00</p></aside></div></li></section>'''
SJTU = '''<div class="inviteSxhList" onclick='windowOpen("/career/zphxx/view/3")'><div class="sxhzbf">示例双选会</div>
<div class="sxhAddress"><div>举办日期：2026-11-18 13:30</div><div class="sxhAddressPos"></div><div>闵行校区绿色环境楼</div></div></div>'''


class HomeCalendarTests(unittest.TestCase):
    def test_public_windows_keep_school_city_online_and_job_fair_distinct(self):
        items, total = public_home_calendar(UPC, SOURCES['upc-talks-public'])
        self.assertEqual(total, 1)
        physical, online = [c.calendar_record(item, SOURCES['upc-talks-public']) for item in items]
        self.assertEqual(physical['talk_event']['city'], '青岛')
        self.assertEqual(physical['talk_event']['event_type'], 'talk')
        self.assertEqual(physical['cities'], [])
        self.assertIsNone(physical['published_at'])
        self.assertEqual(online['talk_event']['mode'], 'online')
        self.assertIsNone(online['talk_event']['city'])
        items, _ = public_home_calendar(SJTU, SOURCES['sjtu-campus-events'])
        event = c.calendar_record(items[0], SOURCES['sjtu-campus-events'])['talk_event']
        self.assertEqual(event['city'], '上海')
        self.assertEqual(event['event_type'], 'job_fair')
        self.assertEqual(event['start_time'], '13:30')

    def test_changed_layout_dates_and_executable_navigation_fail_closed(self):
        for value in ['', '请登录', UPC.replace('时间：16:00', '时间：待定'), UPC.replace('2026/11', '2026/99'),
                      UPC.replace('/career/xjhxx/view/1', 'https://evil.example/1'),
                      UPC.replace('windowOpen("/career/xjhxx/view/1")', 'stealCredentials()')]:
            with self.assertRaises(ValueError): public_home_calendar(value, SOURCES['upc-talks-public'])
        with self.assertRaises(PermissionError):
            check_home_calendar_robots(lambda *a, **k: 'User-agent: *\nDisallow: /', SOURCES['sjtu-campus-events'], c.DEFAULT_USER_AGENT)

    def test_actual_orchestration_never_claims_complete_or_reads_event_details(self):
        for identifier, html in [('upc-talks-public', UPC), ('sjtu-campus-events', SJTU)]:
            source = SOURCES[identifier]
            calls = []
            def fetch(url, **kwargs):
                calls.append(url)
                return 'User-agent: *\nAllow: /' if url.endswith('/robots.txt') else html
            with TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
                args = SimpleNamespace(data_dir=directory, public_dir=directory, sources=identifier, pages=8,
                    days=30, refresh_hours=72, nankai_area=0, target_city='', offerjack_pages=1, probe_budget=0, state_only=True)
                with patch.object(c, 'fetch', side_effect=fetch):
                    self.assertEqual(c.run(args), 0)
                state = json.loads((Path(directory) / 'state.json').read_text(encoding='utf-8'))
                self.assertFalse(state['sources'][identifier]['list_complete'])
                self.assertIn('不是完整日历', state['sources'][identifier]['coverage'])
                self.assertEqual(state['sources'][identifier]['pages'], 1)
                self.assertEqual(state['pending'][identifier], [])
                self.assertEqual(len(calls), 2)
                self.assertTrue(all('/view/' not in url for url in calls))
            self.assertIn(identifier, c.SOURCE_PACKS['universities-a'])
            self.assertNotIn(identifier, c.SOURCE_PACKS['universities-b'])


if __name__ == '__main__':
    unittest.main()
