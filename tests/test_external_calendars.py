import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from external_calendars import nankai_calendar, nankai_event, pku_calendar
from collect import calendar_record, extract_talk_event


class ExternalCalendarTests(unittest.TestCase):
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
