import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from city_registry import CITIES, cities_in_text, collection_cities, resolve_event_city, CODE_CITY
from generate_city_registry import generated


class CityRegistryTests(unittest.TestCase):
    def test_shared_generated_contract_and_collection_budget(self):
        root = Path(__file__).resolve().parents[1]
        self.assertEqual((root / 'lib/cities.generated.ts').read_text(encoding='utf-8'), generated())
        self.assertGreater(len(CITIES), 300)
        self.assertEqual(len(collection_cities()), 54)
        self.assertNotIn('无锡', collection_cities())

    def test_context_disambiguation_and_county_codes(self):
        self.assertEqual(cities_in_text('吉林省'), ())
        self.assertEqual(cities_in_text('朝阳区', True), ())
        self.assertEqual(cities_in_text('吉林市'), ('吉林',))
        self.assertEqual(cities_in_text('北京市大兴区', True), ('北京',))
        self.assertEqual(CODE_CITY['110115'], '北京')
        self.assertEqual(CODE_CITY['320200'], '无锡')

    def test_campus_online_and_conflict_boundaries(self):
        self.assertEqual(resolve_event_city('山东大学', '千佛山校区')[0], '济南')
        self.assertEqual(resolve_event_city('山东大学', '青岛校区')[0], '青岛')
        self.assertIsNone(resolve_event_city('未知学校', '西校区')[0])
        self.assertIsNone(resolve_event_city('山东理工大学', '线上宣讲 西校区')[0])
        self.assertIsNone(resolve_event_city('山东理工大学', '北京 西校区')[0])


if __name__ == '__main__':
    unittest.main()
