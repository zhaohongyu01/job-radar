import contextlib
import datetime as dt
import email.utils
import io
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import urllib.error
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import collect as c
import collector_runtime as r


class CoolingTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.dict(r._paused, {}, clear=True))
        self.enterContext(patch.dict(r._next_request, {}, clear=True))
        self.enterContext(patch.object(r, '_shared_path', None))
        self.enterContext(patch.object(c, '_sdei_sessions', set()))
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        self.source = next(s for s in c.SOURCES if s['id'] == 'ujn-announcements')

    def args(self, tmp):
        return SimpleNamespace(data_dir=tmp, public_dir=tmp,
            sources=self.source['id'], pages=1, days=30, refresh_hours=72,
            nankai_area=0, target_city='', offerjack_pages=1, probe_budget=0,
            state_only=True)

    def test_rejections_block_api_and_persist_cooldown(self):
        for code in (403, 420, 429):
            with self.subTest(code=code), TemporaryDirectory() as tmp:
                c._sdei_sessions.clear()
                r._paused.clear()
                error = urllib.error.HTTPError(self.source['url'], code, 'rejected',
                                               {'Retry-After': '21600'}, None)
                start = dt.datetime.now(c.TZ)
                with patch.object(c.OPENER, 'open', side_effect=error), patch.object(c, 'fetch') as api:
                    c.run(self.args(tmp))
                    api.assert_not_called()
                status = json.loads((Path(tmp)/'state.json').read_text(encoding='utf-8'))['sources'][self.source['id']]
                self.assertEqual(status['status'], 'blocked')
                until = dt.datetime.fromisoformat(status['blocked_until'])
                self.assertGreaterEqual((until-start).total_seconds(), 21600 if code == 429 else 14400)
                with self.assertRaises(r.HostPaused):
                    r.pace(self.source['url'])
                r.pace('https://other.example.test/')
                with patch.object(c.OPENER, 'open') as opener, patch.object(c, 'fetch') as api:
                    c.run(self.args(tmp))
                    opener.assert_not_called()
                    api.assert_not_called()

    def test_ordinary_prewarm_failure_allows_api(self):
        for error in (TimeoutError('timeout'), urllib.error.HTTPError('x',404,'missing',{},None)):
            c._sdei_sessions.clear()
            with patch.object(r, 'pace'), patch.object(c.OPENER, 'open', side_effect=error), patch.object(c, 'fetch', return_value='{"rows": [], "total": 0}') as api:
                self.assertEqual(c.sdei_list(dict(self.source), 1), ([], 0))
                api.assert_called_once()

    def test_expired_cooldown_resumes(self):
        with TemporaryDirectory() as tmp:
            stamp = (dt.datetime.now(c.TZ)-dt.timedelta(hours=5)).isoformat()
            c.atomic_json(Path(tmp)/'state.json', {'jobs':{}, 'pending':{}, 'last_run_at':stamp,
                'sources':{self.source['id']:{'blocked_until':stamp, 'status':'blocked'}}})
            with patch.object(c, 'sdei_list', return_value=([], 0)) as listing:
                c.run(self.args(tmp))
                listing.assert_called_once()
            status = json.loads((Path(tmp)/'state.json').read_text(encoding='utf-8'))['sources'][self.source['id']]
            self.assertEqual(status['status'], 'ok')

    def test_date_retry_after_preserves_remaining_time(self):
        future = dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=8)
        error = urllib.error.HTTPError('x',429,'limited',{'Retry-After':email.utils.format_datetime(future)},None)
        r.pause_on_rejection(self.source['url'],error)
        with self.assertRaises(r.HostPaused) as raised:
            r.pace(self.source['url'])
        self.assertGreater(raised.exception.retry_after_seconds, 7*3600)

    def test_expired_request_budget_still_fails(self):
        with r.request_budget(-1), self.assertRaises(TimeoutError):
            r.remaining(0)
