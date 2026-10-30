import datetime as dt
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import collect
from audit_freshness import audit


class CoverageRegressions(unittest.TestCase):
    def test_reposted_talk_preserves_source_school_and_resolves_explicit_hosting_city(self):
        event = collect.extract_talk_event(dict(id='repost', title='校园宣讲', structured={
            'fairDate': '2026-11-01', 'fairStartTime': '14:00', 'schoolName': '山东第二医科大学',
            'fairAddress': '山东大学趵突泉校区梦迪音乐厅'}))
        self.assertEqual(event['school'], '山东大学')
        self.assertEqual(event['source_school'], '山东第二医科大学')
        self.assertEqual(event['city'], '济南')

    def test_calendar_audit_excludes_cancellations_and_separates_online_from_unknown_venues(self):
        rows = [dict(id=str(i), published_at='2026-10-30', talk_event=dict(id=str(i), date='2026-11-01', school='北京大学',
                city=None, status='cancelled' if i == 0 else 'scheduled', mode='online' if i == 1 else 'unknown')) for i in range(3)]
        report = audit(dict(jobs=rows, sources=[]), dt.datetime(2026, 10, 30, 12, tzinfo=dt.timezone(dt.timedelta(hours=8))))
        self.assertEqual(report['upcoming_talks'], 2)
        self.assertEqual(report['online_talks'], 1)
        self.assertEqual(report['talk_cities'], {'线上不限城市': 1, '地点待核实': 1})


if __name__ == '__main__':
    unittest.main()
