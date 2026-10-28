"""Optional browser projection must survive the existing Python release path."""
import io
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'tests'))
from test_ci_collect import fixture
from collect import export_snapshot, atomic_json
from snapshot_assets import asset_paths
from offline_snapshot import read_public
from ci_collect import snapshot_state
from stage_public import stage
from download_public import download


class BrowseDeliveryTests(unittest.TestCase):
    def test_projection_preserves_restore_staging_and_page_only_download(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            state = fixture()
            export_snapshot(state, root / 'public')
            before, _ = read_public(root / 'public')
            original_paths = asset_paths(before)
            original_bytes = {path: (root / 'public' / path.lstrip('/')).read_bytes() for path in original_paths}
            subprocess.run(['node', '--experimental-strip-types', 'scripts/build_browse_index.mjs',
                            '--public-dir', str(root / 'public')], cwd=ROOT, check=True, capture_output=True, timeout=30)
            snapshot, load = read_public(root / 'public')
            self.assertEqual(snapshot['generated_at'], before['generated_at'])
            self.assertTrue(snapshot['browse_index']['shards'])
            self.assertEqual(set(snapshot_state(snapshot, load)['jobs']), set(state['jobs']))
            self.assertTrue(original_paths.issubset(asset_paths(snapshot)))
            for path, content in original_bytes.items():
                self.assertEqual(content, (root / 'public' / path.lstrip('/')).read_bytes())
            atomic_json(root / 'dist/server/wrangler.json', {'assets': {'directory': '../client'}})
            stage(root / 'public', root / 'dist')
            def response(request, **kwargs):
                path = request.full_url.removeprefix('https://example.org/')
                return io.BytesIO((root / 'public' / path).read_bytes())
            with patch('download_public.urlopen', side_effect=response):
                download('https://example.org', root / 'copied')
            for path in asset_paths(snapshot) | {'jobs.json', 'snapshot-manifest.json'}:
                for location in ('copied', 'dist/client'):
                    self.assertEqual((root / 'public' / path.lstrip('/')).read_bytes(),
                                     (root / location / path.lstrip('/')).read_bytes())
            broken = root / 'public' / snapshot['browse_index']['shards'][0].lstrip('/')
            broken.write_text(json.dumps({'jobs': []}), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'corrupt'):
                stage(root / 'public', root / 'dist')


if __name__ == '__main__':
    unittest.main()
