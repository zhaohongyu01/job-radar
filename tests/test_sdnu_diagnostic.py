import datetime as dt
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import diagnose_sdnu_calendar as probe


class DiagnosticTests(unittest.TestCase):
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
