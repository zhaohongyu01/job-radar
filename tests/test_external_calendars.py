import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from external_calendars import nankai_calendar, nankai_event, pku_calendar, public_calendar_source
from collect import calendar_record, extract_talk_event


class ExternalCalendarTests(unittest.TestCase):
    def test_nankai_last_page_link_not_next_page_determines_page_count(self):
        html = '''<li><a href="/recruitment/content/type/2/id/6301.html">官方宣讲会</a><span>2026-10-27</span></li>
        <a href="/recruitment/index2/p/2.html">下一页</a><a href="/recruitment/index2/p/5.html">5</a>
        <a href="/recruitment/index2/p/10.html">末页</a><a href="/recruitment/index3/p/99.html">其他栏目</a>'''
        items, pages = nankai_calendar(html, 'https://career.nankai.edu.cn/')
        self.assertEqual(len(items), 1)
        self.assertEqual(pages, 10)

    def test_old_pagination_metadata_is_not_presented_as_complete_or_mutated(self):
        source = {'id': 'nankai-talks', 'pages_read': 2, 'list_complete': True,
                  'coverage': '已到末页', 'last_success_at': '2026-10-26T14:40:57+08:00'}
        public = public_calendar_source(source)
        self.assertFalse(public['list_complete'])
        self.assertIn('旧分页信息不足', public['coverage'])
        self.assertTrue(source['list_complete'])
        self.assertEqual(public['last_success_at'], source['last_success_at'])
        verified = dict(source, calendar_pagination_version=1)
        self.assertEqual(public_calendar_source(verified), verified)

    def test_pku_public_fact_samples_use_event_dates_and_campus_city(self):
        payload = json.loads((ROOT / 'tests/fixtures/pku-calendar.json').read_text(encoding='utf-8'))
        items, total = pku_calendar(payload, 'https://scc.pku.edu.cn/')
        self.assertEqual(len(items), 3)
        self.assertEqual(total, 32)
        self.assertIsNone(items[0]['published_at'])
        self.assertEqual(extract_talk_event(dict(items[0], id='stable'))['city'], '北京')
        with self.assertRaises(ValueError):
            pku_calendar({'state': 0, 'object': None}, 'https://scc.pku.edu.cn/')

    def test_nankai_date_only_list_later_gains_time_without_a_list_refresh_erasing_it(self):
        html = '<li><a href="/recruitment/content/type/2/id/6301.html">官方宣讲会</a><span>2026-10-27</span></li>'
        items, _ = nankai_calendar(html, 'https://career.nankai.edu.cn/')
        source = {'id': 'nankai-talks', 'name': '南开大学宣讲'}
        before = calendar_record(items[0], source)
        self.assertIsNone(before['talk_event']['city'])
        detail = '<div>时间：2026-10-27 14:00 地点：[津南校区]大通学生中心A104 浏览量：12</div>'
        updated = calendar_record(nankai_event(detail, items[0]), source)
        refreshed = calendar_record(items[0], source, updated)
        self.assertEqual(refreshed['talk_event']['city'], '天津')
        self.assertEqual(refreshed['talk_event']['start_time'], '14:00')
        self.assertEqual(before['id'], refreshed['id'])


if __name__ == '__main__':
    unittest.main()
