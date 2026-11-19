"""Regression tests for resilient gzip + retry downloading in download_public.py."""
import gzip
import hashlib
import http.client
import io
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import download_public


class _FakeResponse:
    def __init__(self, body: bytes, headers: dict[str, str] | None = None, read_error: Exception | None = None):
        self._body = body
        self.headers = headers or {}
        self._read_error = read_error

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self) -> bytes:
        if self._read_error is not None:
            raise self._read_error
        return self._body


class DownloadPublicResilienceTests(unittest.TestCase):
    def test_retries_incomplete_read_and_decompresses_gzip_assets(self):
        detail_raw = json.dumps({'jobs': {'ab01': {'id': 'ab01', 'title': '测试岗'}}}, ensure_ascii=False).encode('utf-8')
        detail_hash = hashlib.sha256(detail_raw).hexdigest()[:20]
        detail_path = f'/job-assets/detail-ab-{detail_hash}.json'
        search_raw = json.dumps({'jobs': {'ab01': '测试岗'}}, ensure_ascii=False).encode('utf-8')
        search_hash = hashlib.sha256(search_raw).hexdigest()[:20]
        search_path = f'/job-assets/search-{search_hash}.json'
        index_raw = json.dumps({
            'schema_version': 3,
            'generated_at': '2026-11-19T08:00:00+08:00',
            'index_count': 0,
            'jobs': [],
            'detail_shards': {'ab': detail_path},
            'search_url': search_path,
        }, ensure_ascii=False).encode('utf-8')
        manifest_raw = json.dumps({
            'schema_version': 1,
            'index_sha256': hashlib.sha256(index_raw).hexdigest(),
        }).encode('utf-8')

        attempts: dict[str, int] = {}
        seen_accept_encodings: list[str] = []

        def fake_urlopen(request, **kwargs):
            seen_accept_encodings.append(str(request.get_header('Accept-encoding') or ''))
            path = request.full_url.removeprefix('https://example.org')
            attempts[path] = attempts.get(path, 0) + 1
            if path == '/snapshot-manifest.json':
                return _FakeResponse(gzip.compress(manifest_raw), {'Content-Encoding': 'gzip'})
            if path == '/jobs.json':
                return _FakeResponse(gzip.compress(index_raw), {'Content-Encoding': 'gzip'})
            if path == search_path:
                return _FakeResponse(gzip.compress(search_raw), {'Content-Encoding': 'gzip'})
            if path == detail_path:
                if attempts[path] == 1:
                    return _FakeResponse(b'', read_error=http.client.IncompleteRead(b'x' * 64, 3000000))
                if attempts[path] == 2:
                    # Truncated gzip stream should also trigger retry instead of aborting.
                    return _FakeResponse(gzip.compress(detail_raw)[:12], {'Content-Encoding': 'gzip'})
                return _FakeResponse(gzip.compress(detail_raw), {'Content-Encoding': 'gzip'})
            if path == '/exams.json':
                raise HTTPError(request.full_url, 404, 'Not Found', {}, io.BytesIO(b''))
            raise AssertionError(f'Unexpected request path: {path}')

        with TemporaryDirectory() as tmp:
            out = Path(tmp) / 'public'
            with (
                patch.object(download_public, 'urlopen', side_effect=fake_urlopen),
                patch.object(download_public, 'RETRY_BASE_DELAY', 0.0),
            ):
                download_public.download('https://example.org', out)

            self.assertEqual((out / 'jobs.json').read_bytes(), index_raw)
            self.assertEqual((out / 'snapshot-manifest.json').read_bytes(), manifest_raw)
            self.assertEqual((out / search_path.lstrip('/')).read_bytes(), search_raw)
            self.assertEqual((out / detail_path.lstrip('/')).read_bytes(), detail_raw)
            self.assertEqual(attempts[detail_path], 3)
            # 404 on optional /exams.json must not waste retries.
            self.assertEqual(attempts['/exams.json'], 1)
            self.assertTrue(all('gzip' in enc.lower() for enc in seen_accept_encodings))

    def test_retries_transient_503_and_raises_after_exhausting_attempts(self):
        calls = {'503': 0, 'always_fail': 0}

        def fake_urlopen(request, **kwargs):
            if request.full_url.endswith('/transient'):
                calls['503'] += 1
                if calls['503'] < 3:
                    raise HTTPError(request.full_url, 503, 'Service Unavailable', {}, io.BytesIO(b''))
                return _FakeResponse(b'ok')
            calls['always_fail'] += 1
            return _FakeResponse(b'', read_error=http.client.IncompleteRead(b'part', 100))

        with (
            patch.object(download_public, 'urlopen', side_effect=fake_urlopen),
            patch.object(download_public, 'RETRY_BASE_DELAY', 0.0),
        ):
            self.assertEqual(download_public.fetch_bytes('https://example.org', '/transient'), b'ok')
            self.assertEqual(calls['503'], 3)
            with self.assertRaises(http.client.IncompleteRead):
                download_public.fetch_bytes('https://example.org', '/broken', max_attempts=3)
            self.assertEqual(calls['always_fail'], 3)


if __name__ == '__main__':
    unittest.main()
