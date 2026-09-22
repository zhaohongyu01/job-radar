import json
import io
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import collect as c
import ci_collect as ci
import snapshot_assets as assets
import stage_public
import download_public
from test_ci_collect import fixture


class SnapshotShardsTests(unittest.TestCase):
    def test_split_roundtrip_preserves_all_records_and_search(self):
        state = fixture()
        original = next(iter(state['jobs'].values()))
        for i in range(4):
            identifier = f'{i:02x}' + '123456789012345678'
            state['jobs'][identifier] = dict(original, id=identifier, title=f'独立岗位{i}',
                                           company=f'企业{i}', body='全文保留' * 200,
                                           source_url=f'https://example.org/{i}')
        chunker = assets.chunks
        with TemporaryDirectory() as tmp, patch('socket.socket.connect', side_effect=AssertionError('Network forbidden')):
            root = Path(tmp)
            with patch.object(assets, 'chunks', side_effect=lambda rows: chunker(rows, 1200)):
                full = c.export_snapshot(state, root / 'public')
            disk = ci.read_json(root / 'public/jobs.json')
            self.assertEqual(disk['jobs'], [])
            self.assertEqual(disk['schema_version'], 3)
            load = lambda path: ci.read_json(root / 'public' / path.lstrip('/'))
            hydrated = assets.hydrate_index(disk, load)
            self.assertEqual(hydrated['jobs'], full['jobs'])
            ci._snapshot_checks(disk, root / 'public')
            restored = ci.snapshot_state(disk, load)
            self.assertEqual(set(restored['jobs']), set(state['jobs']))
            ci.prepare(root / 'public', root / 'data', '')
            self.assertEqual(set(ci.read_json(root/'data/state.json')['jobs']), set(state['jobs']))
            search = {}
            for url in [disk['search_url'], *disk.get('search_shards', [])]:
                search.update(load(url)['jobs'])
            self.assertEqual(set(search), {j['id'] for j in full['jobs']})
            c.atomic_json(root / 'dist/server/wrangler.json', {'assets': {'directory': '../client'}})
            stage_public.stage(root / 'public', root / 'dist')
            for path in assets.asset_paths(disk):
                self.assertEqual((root/'public'/path.lstrip('/')).read_bytes(),
                                 (root/'dist/client'/path.lstrip('/')).read_bytes())
            def response(request, **kwargs):
                path = request.full_url.removeprefix('https://example.org/')
                return io.BytesIO((root/'public'/path).read_bytes())
            with patch.object(download_public, 'urlopen', side_effect=response):
                download_public.download('https://example.org', root/'copied')
            for path in assets.asset_paths(disk) | {'jobs.json', 'snapshot-manifest.json'}:
                self.assertEqual((root/'public'/path.lstrip('/')).read_bytes(),
                                 (root/'copied'/path.lstrip('/')).read_bytes())
            broken = dict(disk, index_count=disk['index_count'] + 1)
            with self.assertRaisesRegex(ValueError, 'incomplete'):
                assets.hydrate_index(broken, load)
            with patch.object(stage_public, 'MAX_ASSET_BYTES', 10):
                with self.assertRaisesRegex(ValueError, '25 MiB'):
                    stage_public.stage(root / 'public', root / 'dist')


if __name__ == '__main__':
    unittest.main()
