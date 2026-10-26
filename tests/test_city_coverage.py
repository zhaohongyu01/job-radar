from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from city_coverage import build_city_coverage
from city_registry import work_cities


class CityCoverageTests(unittest.TestCase):
    def test_no_source_failure_and_unknown_venue_are_not_reported_as_no_events(self):
        snapshot = {'generated_at': '2026-10-25T12:00:00+08:00', 'sources': [{'id': 'calendar', 'status': 'failed'}],
                    'jobs': [{'talk_event': {'id': 'event', 'date': '2026-10-27', 'school': '样本高校', 'city': None, 'venue': ''}}]}
        definitions = {'sources': [{'source_id': 'calendar', 'channel': 'calendar', 'school': '样本高校', 'cities': ['淄博']}], 'planned': []}
        report = build_city_coverage(snapshot, definitions)
        self.assertEqual(report['cities']['淄博']['calendar_sources'][0]['status'], 'failed')
        self.assertEqual(report['cities']['淄博']['unknown_events'], 1)
        self.assertEqual(report['cities']['上海']['calendar_sources'], [])

    def test_district_road_directions_do_not_override_structured_workplace(self):
        evidence = ['岗位工作地行政区划代码 371681，归属滨州（来源结构化字段）',
                    '工作地点：山东省邹平市', '工作地点：山东省邹平市青阳镇开泰（章丘区刁镇高速路口东7公里）工业园研究院']
        self.assertEqual(work_cities(evidence), ['滨州'])


if __name__ == '__main__':
    unittest.main()
