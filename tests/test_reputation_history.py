import base64
import hashlib
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import publish_reputation as p


class HistoryRecoveryTests(unittest.TestCase):
    def test_missing_or_corrupt_published_history_protects_that_entity(self):
        raw = b'{"id":"nowcoder:1","records":[]}'
        file = 'entity-1-' + hashlib.sha256(raw).hexdigest()[:20] + '.json'
        rows = [{'id': 'nowcoder:1', 'file': file}, {'id': 'nowcoder:2', 'file': 'entity-2-' + 'a' * 20 + '.json'}]
        calls = []
        class API:
            def request(self, path, **kwargs):
                calls.append((path, kwargs))
                if path.startswith('/git/ref/'):
                    return {'object': {'sha': 'pinned-commit'}}
                if '/index.json?' in path:
                    return {'content': base64.b64encode(json.dumps({'entities': rows}).encode()).decode()}
                return {'content': base64.b64encode(b'corrupt').decode()}
        with TemporaryDirectory() as temp:
            directory = Path(temp) / 'incoming'; directory.mkdir()
            seed = Path(temp) / 'seed'; seed.mkdir()
            (seed / file).write_bytes(raw)
            (directory / 'index.json').write_text('{"entities":[]}', encoding='utf-8')
            def merge(args, **kwargs):
                prior = Path(args[-3])
                self.assertEqual(json.loads(Path(args[-1]).read_text()), ['nowcoder:2'])
                self.assertEqual(json.loads((prior / 'index.json').read_text())['entities'], [rows[0]])
                self.assertEqual((prior / file).read_bytes(), raw)
                return SimpleNamespace(returncode=0, stdout='{"protected_unread_history":1}')
            with patch.object(p.subprocess, 'run', side_effect=merge):
                result = p.prepare_history(directory, seed, {'directory': 'public/reputation', 'branch': 'reputation-data'}, API())
            self.assertEqual(result['protected_unread_history'], 1)
            self.assertTrue(all(0 < kwargs['timeout'] <= 8 for _, kwargs in calls))
            self.assertTrue(all('pinned-commit' in path for path, _ in calls if path.startswith('/contents/')))

    def test_history_deadline_or_merge_validation_failure_stops_publication(self):
        class API:
            def request(self, *args, **kwargs):
                self.fail('An exhausted history budget cannot issue a request')
        with TemporaryDirectory() as temp:
            with self.assertRaises(TimeoutError):
                p.prepare_history(Path(temp), Path(temp), {'directory': 'public/reputation', 'branch': 'reputation-data'}, API(), budget=0)


if __name__ == '__main__':
    unittest.main()
