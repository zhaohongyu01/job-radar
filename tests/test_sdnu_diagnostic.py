import datetime as dt
from pathlib import Path
import sys
import contextlib
import io
import json
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import diagnose_sdnu_calendar as probe


class DiagnosticTests(unittest.TestCase):
    def test_production_first_list_timeout_stops_without_spending_detail_requests(self):
        with TemporaryDirectory() as tmp, contextlib.redirect_stdout(io.StringIO()):
            args = SimpleNamespace(data_dir=tmp, public_dir=tmp, sources='sdnu-graduate-talks',
                pages=1, days=30, refresh_hours=72, nankai_area=0, target_city='',
                offerjack_pages=1, probe_budget=0, state_only=True)
            with patch.object(probe.collector, 'fetch', side_effect=TimeoutError('list timeout')) as fetch:
                probe.collector.run(args)
            source = json.loads((Path(tmp)/'state.json').read_text(encoding='utf-8'))['sources']['sdnu-graduate-talks']
        self.assertEqual(source['status'], 'failed')
        self.assertEqual(source['pages'], 0)
        self.assertEqual(source['detail_attempted'], 0)
        fetch.assert_called_once()
        self.assertEqual(fetch.call_args.kwargs, {'timeout': 6, 'retries': 0})

    def test_persisted_host_cooldown_makes_no_request(self):
        until = (dt.datetime.now(probe.collector.TZ) + dt.timedelta(hours=1)).isoformat()
        with patch.object(probe.collector, 'fetch') as fetch:
            result = probe.diagnose({'sources': {'sdnu-graduate-talks': {'blocked_until': until}}})
        self.assertEqual(result['result'], 'cooldown')
        fetch.assert_not_called()

    def test_single_list_read_cannot_fetch_details_or_invent_events(self):
        with patch.object(probe.collector, 'fetch', return_value='list') as fetch, patch.object(
            probe.collector, 'sdnu_graduate_list', return_value=[{'published_at': '2026-10-21'}]):
            result = probe.diagnose({'sources': {}})
        self.assertEqual(result['result'], 'list_verified')
        self.assertEqual(result['rows'], 1)
        self.assertEqual(result['latest_publication'], '2026-10-21')
        fetch.assert_called_once()
        self.assertEqual(fetch.call_args.kwargs, {'timeout': 6, 'retries': 0})

    def test_invalid_baseline_fails_closed(self):
        with patch.object(probe.collector, 'fetch') as fetch:
            with self.assertRaises(ValueError):
                probe.diagnose({})
        fetch.assert_not_called()
