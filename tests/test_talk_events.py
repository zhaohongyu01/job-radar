import importlib.util
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('collect', ROOT / 'scripts/collect.py')
collect = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collect)


class TalkEventTests(unittest.TestCase):
    def test_structured_event_and_legacy_body_do_not_change_work_city(self):
        talk = {'id': 'talk-1', 'source_id': 'jobsdufe-talks',
                'source_url': 'https://example.org/talk/1',
                'title': '中国重型汽车集团有限公司宣讲会',
                'company': '中国重型汽车集团有限公司',
                'body': '中国重型汽车集团有限公司（以下简称“中国重汽”）2027届校园招聘。\n'
                        '工作地点：青岛\n宣讲活动信息：\n宣讲时间：2026-09-23 14:30 - 16:00\n'
                        '宣讲学校：山东财经大学\n举办地点：舜耕校区1号教学楼303教室',
                'structured': {'fairDate': '2026-09-23', 'fairStartTime': '14:30',
                               'fairEndTime': '16:00', 'schoolName': '山东财经大学',
                               'fairAddress': '舜耕校区1号教学楼303教室'},
                'graduation_years': ['2027'], 'types': ['校招'], 'kind': '招聘公告'}
        event = collect.extract_talk_event(talk)
        self.assertEqual((event['date'], event['start_time'], event['end_time'], event['city']),
                         ('2026-09-23', '14:30', '16:00', '济南'))
        legacy = dict(talk, structured={})
        self.assertEqual(collect.extract_talk_event(legacy), event)
        public = collect.public_record(talk)
        self.assertIn('青岛', public['cities'])
        self.assertNotIn('济南', public['cities'])
        online = dict(talk, structured=dict(talk['structured'], fairAddress='线上宣讲'))
        self.assertIsNone(collect.extract_talk_event(online)['city'])
        other_campus = dict(talk, structured=dict(talk['structured'], schoolName='青岛科技大学',
                                                  fairAddress='四方校区一号楼'))
        self.assertEqual(collect.extract_talk_event(other_campus)['city'], '青岛')

    def test_unique_declared_alias_and_cohort_attach_without_losing_talk(self):
        base = {'title': '中国重汽 · 秋招招聘', 'company': '中国重汽',
                'source_id': 'offerjack', 'source_url': 'https://example.org/jobs',
                'graduation_years': ['2026', '2027'], 'types': ['校招'], 'kind': '招聘公告'}
        talk = {'id': 'talk-1', 'title': '中国重型汽车集团有限公司宣讲会',
                'company': '中国重型汽车集团有限公司', 'source_id': 'jobsdufe-talks',
                'source_url': 'https://example.org/talk/1',
                'body': '中国重型汽车集团有限公司（以下简称“中国重汽”）招收2027届。',
                'graduation_years': ['2027'], 'types': ['校招'], 'kind': '招聘公告',
                'talk_event': {'id': 'talk-1', 'date': '2026-09-23', 'school': '山东财经大学',
                               'venue': '舜耕校区', 'city': '济南', 'url': 'https://example.org/talk/1'}}
        jobs = collect.deduplicate([dict(base, id='job-1'), talk])
        self.assertEqual(len(jobs), 2)
        collect.attach_talk_events(jobs)
        campaign = next(j for j in jobs if j['id'] == 'job-1')
        event = next(j for j in jobs if j['id'] == 'talk-1')
        self.assertEqual(campaign['talk_events'], [talk['talk_event']])
        self.assertEqual(event['talk_attached_to'], 'job-1')

        # A different graduation cohort, missing alias or equally strong
        # competing campaigns must leave the original talk independently visible.
        for other in [dict(base, id='job-1', graduation_years=['2028']),
                      dict(base, id='job-1', company='另一家企业')]:
            rows = [other, dict(talk)]
            collect.attach_talk_events(rows)
            self.assertNotIn('talk_attached_to', rows[1])
        rows = [dict(base, id='job-1'), dict(base, id='job-2'), dict(talk)]
        collect.attach_talk_events(rows)
        self.assertNotIn('talk_attached_to', rows[2])


if __name__ == '__main__':
    unittest.main()
