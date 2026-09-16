import contextlib
import io
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import nas_dispatch as nas


class Clock:
    def __init__(self):
        self.value = 0

    def now(self):
        return self.value

    def sleep(self, seconds):
        self.value += seconds


class FakeGitHub:
    def __init__(self, clock, mode='success'):
        self.clock = clock
        self.mode = mode
        self.calls = []

    def request(self, path, method='GET', payload=None):
        self.calls.append((path, method, payload))
        if path.endswith('/dispatches') or path.endswith('/cancel'):
            return {}
        if '/runs?' in path:
            if self.mode == 'invisible':
                return {'workflow_runs': []}
            return {'workflow_runs': [{'id': 42, 'display_title': 'NAS universities-b 123-1', 'head_branch': 'main'}]}
        if path.endswith('/jobs'):
            return {'jobs': [{'status': 'queued' if self.mode == 'offline' else 'in_progress',
                              'runner_name': '' if self.mode == 'offline' else 'NAS'}]}
        if path.endswith('/artifacts'):
            return {'artifacts': [] if self.mode == 'missing' else [{'id': 99, 'name': nas.ARTIFACT, 'expired': False}]}
        done = self.mode in {'success', 'missing'} and self.clock.value >= 20
        return {'status': 'completed' if done else 'in_progress'}

    def download(self, artifact_id):
        assert artifact_id == 99
        return b'archive'


class NasDispatchTests(unittest.TestCase):
    def test_nas_delta_uses_existing_merge_guards(self):
        import ci_collect as ci
        import collect as collector
        from test_ci_collect import fixture
        for generation in ('2026-09-01T12:00:00+08:00', 'wrong-generation'):
            with self.subTest(generation=generation), TemporaryDirectory() as tmp, contextlib.redirect_stdout(io.StringIO()), patch.dict(collector.os.environ, {'GITHUB_STEP_SUMMARY': ''}):
                root = Path(tmp)
                baseline = fixture()
                collector.atomic_json(root/'data/state.json', baseline)
                collector.export_snapshot(baseline, root/'public')
                identifier = collector.source_pack_ids('universities-b')[0]
                stamp = '2026-09-15T12:00:00+08:00'
                state = {'delta_version': 1, 'source_pack': 'universities-b',
                         'base_generation': generation, 'last_run_at': stamp,
                         'jobs': {}, 'pending': {}, 'sources': {identifier: {
                             'id': identifier, 'name': identifier, 'status': 'ok',
                             'last_attempt_at': stamp, 'last_success_at': stamp, 'errors': []}}}
                nas.unpack_state(self.archive([('state.json', json.dumps(state))]),
                                 root/'shards/collector-shard-universities-b')
                old = (root/'public/jobs.json').read_bytes()
                if generation == 'wrong-generation':
                    with self.assertRaisesRegex(ValueError, 'different baseline'):
                        ci.merge_shards(root/'public', root/'data', root/'shards', expected_shards=['universities-b'])
                    self.assertEqual((root/'public/jobs.json').read_bytes(), old)
                else:
                    ci.merge_shards(root/'public', root/'data', root/'shards', expected_shards=['universities-b'])
                    merged = ci.read_json(root/'data/state.json')
                    self.assertEqual(set(merged['jobs']), set(baseline['jobs']))
                    self.assertEqual(merged['sources'][identifier]['status'], 'ok')

    def invoke(self, mode):
        clock = Clock()
        api = FakeGitHub(clock, mode)
        result = nas.handoff(api, 'main', 'a'*40, '123', '1',
            queue_seconds=30, run_seconds=60, now=clock.now, sleep=clock.sleep)
        return result, clock.value, api.calls

    def test_success_uses_exact_parent_context(self):
        result, _, calls = self.invoke('success')
        self.assertEqual(result, b'archive')
        inputs = calls[0][2]['inputs']
        self.assertEqual(inputs['source_sha'], 'a'*40)
        self.assertEqual(inputs['parent_run_id'], '123')
        self.assertFalse(any(p.endswith('/cancel') for p, _, _ in calls))

    def test_offline_runner_is_bounded_even_when_workflow_in_progress(self):
        result, elapsed, calls = self.invoke('offline')
        self.assertIsNone(result)
        self.assertEqual(elapsed, 30)
        self.assertTrue(any(p.endswith('/cancel') for p, _, _ in calls))

    def test_running_collector_timeout_cancels_child_only(self):
        result, elapsed, calls = self.invoke('stuck')
        self.assertIsNone(result)
        self.assertEqual(elapsed, 60)
        self.assertIn(('/actions/runs/42/cancel', 'POST', None), calls)

    def test_missing_run_or_artifact_does_not_hang(self):
        for mode in ('invisible', 'missing'):
            result, elapsed, _ = self.invoke(mode)
            self.assertIsNone(result)
            self.assertLessEqual(elapsed, 30)

    def archive(self, files):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            for name, content in files:
                archive.writestr(name, content)
        return buffer.getvalue()

    def test_nested_state_is_supported_without_rebasing(self):
        state = {'delta_version': 1, 'source_pack': 'universities-b',
                 'base_generation': 'original', 'jobs': {}, 'sources': {}}
        with TemporaryDirectory() as tmp:
            nas.unpack_state(self.archive([('data/state.json', json.dumps(state))]), Path(tmp))
            self.assertEqual(json.loads((Path(tmp)/'state.json').read_text()), state)

    def test_unsafe_or_wrong_artifact_never_writes_state(self):
        cases = [[('../state.json', '{}')], [('state.json', '{}')],
                 [('state.json', '{}'), ('data/state.json', '{}')], [('unexpected', '{}')]]
        for files in cases:
            with self.subTest(files=files), TemporaryDirectory() as tmp:
                with self.assertRaises(ValueError):
                    nas.unpack_state(self.archive(files), Path(tmp))
                self.assertFalse((Path(tmp)/'state.json').exists())

    def test_api_failure_cancels_started_child(self):
        clock = Clock()
        api = FakeGitHub(clock, 'stuck')
        original = api.request
        def request(path, method='GET', payload=None):
            if path.endswith('/jobs'):
                raise OSError('network failed')
            return original(path, method, payload)
        api.request = request
        with self.assertRaises(OSError):
            nas.handoff(api, 'main', 'a'*40, '123', '1', now=clock.now, sleep=clock.sleep)
        self.assertIn(('/actions/runs/42/cancel', 'POST', None), api.calls)
