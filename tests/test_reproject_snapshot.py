import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_ci_collect import fixture
from collect import atomic_json
from reproject_snapshot import reproject


class ReprojectTests(unittest.TestCase):
    def test_full_state_and_published_roundtrip_do_not_use_network_or_renew_history(self):
        with TemporaryDirectory() as tmp, patch('socket.socket.connect', side_effect=AssertionError('No network')):
            root = Path(tmp)
            atomic_json(root / 'state.json', fixture())
            first = reproject(root / 'one', root / 'one-report.json', state_path=root / 'state.json')
            second = reproject(root / 'two', root / 'two-report.json', public_dir=root / 'one')
            self.assertEqual(first['published_raw_records'], second['published_raw_records'])
            self.assertTrue(second['history_preserved'])
            self.assertEqual(first['network_requests'], 0)
            self.assertEqual((root / 'one/jobs.json').read_bytes(), (root / 'two/jobs.json').read_bytes())
            with self.assertRaisesRegex(ValueError, 'empty'):
                reproject(root / 'one', root / 'x.json', state_path=root / 'state.json')
            with self.assertRaisesRegex(ValueError, 'separate'):
                reproject(root / 'one/nested', root / 'x.json', public_dir=root / 'one')

    def test_repost_timeline_merge_does_not_mutate_source_history(self):
        state = fixture()
        jobs = list(state['jobs'].values())
        jobs[0]['timeline'] = [{'date': '2026-09-01', 'type': 'published', 'title': '首次发布', 'detail': '甲来源'}]
        jobs[1]['timeline'] = [{'date': '2026-09-02', 'type': 'published', 'title': '首次发布', 'detail': '乙来源'}]
        jobs[0]['attachments'] = []
        jobs[1]['attachments'] = [{'url': 'https://example.com/jobs.pdf', 'title': '岗位附件'}]
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            atomic_json(root / 'state.json', state)
            report = reproject(root / 'output', root / 'report.json', state_path=root / 'state.json')
            self.assertTrue(report['history_preserved'])


if __name__ == '__main__':
    unittest.main()
