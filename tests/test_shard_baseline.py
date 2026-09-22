import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import socket
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import collect
import shard_baseline as baseline


class ShardBaselineTests(unittest.TestCase):
    def setUp(self):
        stack = self.enterContext(contextlib.ExitStack())
        self.root = Path(stack.enter_context(TemporaryDirectory()))
        self.summary = self.root / 'summary.txt'
        self.output = self.root / 'output.txt'
        stack.enter_context(patch.dict(os.environ, {
            'GITHUB_STEP_SUMMARY': str(self.summary),
            'GITHUB_OUTPUT': str(self.output),
            'BASELINE_DOWNLOAD_STARTED': '100',
        }))
        stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
        stack.enter_context(contextlib.redirect_stderr(io.StringIO()))
        stack.enter_context(patch.object(socket.socket, 'connect', side_effect=AssertionError('Network forbidden')))
        stack.enter_context(patch.object(baseline.time, 'sleep', side_effect=AssertionError('Sleep forbidden')))
        stack.enter_context(patch.object(baseline.time, 'time', return_value=112))
        self.school = collect.source_pack_ids('universities-b')[0]
        self.state = {
            'last_run_at': '2026-09-22T11:00:00+08:00',
            'jobs': {
                'school': {'source_id': self.school, 'title': '高校招聘', 'last_verified_at': '2026-09-21'},
                'bank': {'source_id': 'other-bank', 'body': 'large unrelated body' * 500},
            },
            'sources': {
                self.school: {'resume_page': 7, 'list_complete': False},
                'other-bank': {'blocked_until': '2026-09-23T00:00:00+08:00'},
            },
            'pending': {self.school: [{'url': 'https://example.invalid/detail'}], 'other-bank': [1]},
        }
        self.source = self.root / 'original.json'
        self.source.write_text(json.dumps(self.state), encoding='utf-8')
        self.destination = self.root / 'compact'

    def prepare(self):
        baseline.prepare(self.source, self.destination)
        return self.output.read_text().strip().split('=', 1)[1]

    def test_crop_preserves_history_cursor_pending_and_shared_cooldowns(self):
        original = self.source.read_bytes()
        digest = self.prepare()
        state = json.loads((self.destination / 'state.json').read_bytes())
        self.assertEqual(state['jobs'], {'school': self.state['jobs']['school']})
        self.assertEqual(state['pending'], {self.school: self.state['pending'][self.school]})
        self.assertEqual(state['sources'], self.state['sources'])
        self.assertEqual(state['last_run_at'], self.state['last_run_at'])
        self.assertEqual(self.source.read_bytes(), original)
        self.assertLess((self.destination / 'state.json').stat().st_size, len(original))
        baseline.verify(self.destination, digest)
        self.assertIn('12.0', self.summary.read_text(encoding='utf-8'))

    def test_corrupt_download_is_rejected_without_success_summary(self):
        digest = self.prepare()
        with (self.destination / 'state.json').open('ab') as target:
            target.write(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'integrity'):
            baseline.verify(self.destination, digest)
        self.assertFalse(self.summary.exists())

    def test_old_artifact_cannot_pass_current_run_digest(self):
        self.prepare()
        old_state = (self.destination / 'state.json').read_bytes()
        current = dict(self.state, last_run_at='2026-09-23T11:00:00+08:00')
        current['jobs'] = {'school': self.state['jobs']['school']}
        different_digest = hashlib.sha256(json.dumps(current).encode()).hexdigest()
        with self.assertRaisesRegex(ValueError, 'integrity'):
            baseline.verify(self.destination, different_digest)
        self.assertEqual((self.destination / 'state.json').read_bytes(), old_state)

    def test_mismatched_generation_is_rejected(self):
        digest = self.prepare()
        path = self.destination / 'baseline-manifest.json'
        metadata = json.loads(path.read_bytes())
        metadata['generation'] = 'older-generation'
        path.write_text(json.dumps(metadata))
        with self.assertRaisesRegex(ValueError, 'generation'):
            baseline.verify(self.destination, digest)

    def test_missing_download_does_not_fall_back(self):
        digest = self.prepare()
        (self.destination / 'state.json').unlink()
        with self.assertRaises(FileNotFoundError):
            baseline.verify(self.destination, digest)
        self.assertFalse(self.summary.exists())

    def test_empty_school_pack_retains_cooldown_and_generation(self):
        self.state['jobs'].pop('school')
        self.source.write_text(json.dumps(self.state))
        digest = self.prepare()
        baseline.verify(self.destination, digest)
        state = json.loads((self.destination / 'state.json').read_bytes())
        self.assertEqual(state['jobs'], {})
        self.assertEqual(state['sources'], self.state['sources'])


if __name__ == '__main__':
    unittest.main()
