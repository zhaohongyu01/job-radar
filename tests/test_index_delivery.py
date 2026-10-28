import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from snapshot_assets import chunks, FIRST_INDEX_BYTES, CHUNK_BYTES
from collect import public_summary


class IndexDeliveryTests(unittest.TestCase):
    def test_small_first_batch_preserves_order_rows_and_larger_followups(self):
        rows = [{'id': str(i), 'excerpt': '职位详情' * 1000} for i in range(700)]
        batches = list(chunks(rows, first_budget=FIRST_INDEX_BYTES))
        size = lambda batch: len(json.dumps({'jobs': batch}, ensure_ascii=False, separators=(',', ':')).encode())
        self.assertLessEqual(size(batches[0]), FIRST_INDEX_BYTES)
        self.assertGreater(size(batches[1]), CHUNK_BYTES * 0.9)
        self.assertEqual([row for batch in batches for row in batch], rows)
        self.assertTrue(all(size(batch) <= CHUNK_BYTES for batch in batches))

    def test_oversized_single_record_is_preserved_and_no_empty_batches(self):
        row = {'id': 'huge', 'excerpt': 'x' * (FIRST_INDEX_BYTES + 10)}
        batches = list(chunks([row, {'id': 'next'}], first_budget=FIRST_INDEX_BYTES))
        self.assertEqual(batches, [[row], [{'id': 'next'}]])
        self.assertEqual(list(chunks([], first_budget=FIRST_INDEX_BYTES)), [])

    def test_internal_verification_fields_remain_in_detail_not_listing(self):
        original = {'id': 'one', 'detail_verification': 'verified', 'detail_verified_at': '2026-10-26',
            'event_verification': 'official_list', 'publication_note': 'internal', 'source_published_at': '2026-10-25',
            'last_verified_at': '2026-10-26', 'published_at': '2026-10-25', 'cities': ['北京'],
            'location_evidence': ['工作地点：北京'], 'classification_note': '仅核实官方日程',
            'talk_event': {'city': '天津'}, 'timeline': [{'type': 'deadline_changed', 'at': '2026-10-26'}]}
        summary = public_summary(original)
        for field in ('last_verified_at', 'published_at', 'cities', 'location_evidence', 'classification_note', 'talk_event', 'timeline'):
            self.assertEqual(summary[field], original[field])
        self.assertNotIn('detail_verification', summary)
        self.assertEqual(original['detail_verification'], 'verified')


if __name__ == '__main__':
    unittest.main()
