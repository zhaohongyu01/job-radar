import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import collect
import datetime as dt
from opportunity_facts import assess_opportunity_validity

FIXTURE = json.loads((ROOT / 'tests/fixtures/multicity-regressions.json').read_text(encoding='utf-8'))


class MulticityLocationsTests(unittest.TestCase):
    def test_shared_validity_cases(self):
        cases = json.loads((ROOT / 'tests/fixtures/opportunity-validity.json').read_text(encoding='utf-8'))
        for case in cases:
            with self.subTest(case=case['name']):
                self.assertEqual(assess_opportunity_validity(case['job'], dt.datetime.fromisoformat(case['now'])), case['status'])

    def test_nine_verified_calendar_events_keep_their_id_and_gain_city(self):
        for case in FIXTURE['talks']:
            with self.subTest(identifier=case['input']['id']):
                event = collect.extract_talk_event(case['input'])
                self.assertEqual(event['id'], case['input']['id'])
                self.assertEqual(event['city'], case['expected_city'])
                old = dict(case['input'], talk_event=dict(event, city=None), kind='宣讲会')
                self.assertEqual(collect.public_record(old)['talk_event']['city'], case['expected_city'])

    def test_employer_city_is_not_a_workplace_even_in_retained_evidence(self):
        case = FIXTURE['work_location_conflict']
        row = dict(case['input'], body='工作地点：北京市大兴区', kind='具体岗位')
        row.update(first_seen_at='2026-10-22T00:00:00+08:00',
                   last_verified_at='2026-10-22T00:00:00+08:00',
                   updated_at='2026-10-22T00:00:00+08:00', revision=1)
        after = collect.public_record(row)
        self.assertEqual(after['cities'], ['北京'])
        self.assertEqual(after['last_verified_at'], row['last_verified_at'])
        self.assertEqual(after['company'], row['company'])
        self.assertEqual(collect.public_record(after)['cities'], ['北京'])

    def test_all_six_cities_are_recognized_as_workplaces(self):
        for case in FIXTURE['missing_city_cases']:
            city = case['expected_exact_cities'][0]
            with self.subTest(city=city):
                self.assertIn(city, collect.CITIES)
                after = collect.public_record({'title': '招聘', 'body': case['evidence'], 'company': '', 'kind': '招聘公告'})
                self.assertEqual(after['cities'], [city])

    def test_company_parentheses_do_not_add_second_work_city(self):
        evidence = collect.extract_locations_from_text([], '工作地点：北京、上海', '示例（苏州）有限公司招聘', '示例（苏州）有限公司')
        row = collect.public_record(dict(title='招聘', company='', body='', location_evidence=evidence))
        self.assertEqual(set(row['cities']), {'北京', '上海'})


if __name__ == '__main__':
    unittest.main()
