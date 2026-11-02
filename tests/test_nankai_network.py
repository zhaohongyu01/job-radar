import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import diagnose_nankai as d

LIST = b'<a href="/correcruit/content/id/1.html">one</a><a href="/correcruit/content/id/2.html">two</a>'
BODY = ('<div class="zpnr">' + '真实公开岗位职责和申请要求。' * 12 + '</div>').encode()


class NetworkTests(unittest.TestCase):
    def test_same_origin_links_and_real_detail_container_are_required(self):
        facts, links = d.page_facts(LIST + b'<a href="https://outside.test/detail">bad</a>')
        self.assertEqual(len(links), 2)
        self.assertTrue(all(url.startswith(d.ORIGIN) for url in links))
        self.assertFalse(facts['detail_container'])
        self.assertTrue(d.page_facts(BODY)[0]['detail_container'])
        empty = b'<div class="zpnr"><script>' + b'not real body' * 100 + b'</script></div><aside>' + b'sidebar' * 100 + b'</aside>'
        self.assertEqual(d.page_facts(empty)[0]['text_characters'], 0)
        with self.assertRaises(ValueError):
            d.run(detail_ids=('https://outside.test',))
        with self.assertRaises(ValueError):
            d.run(detail_ids=('1', '2', '3'))

    @patch.object(d.time, 'sleep')
    @patch.object(d.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '["IPv4", "IPv6"]'))
    def test_only_two_details_and_one_calendar_without_publication_or_raw_bodies(self, *_):
        def fetch(url, *args):
            return {'http_code': 200}, BODY if '/content/' in url else LIST
        with patch.object(d, 'urllib_probe', side_effect=fetch), patch.object(d, 'curl_probe', side_effect=fetch), patch.object(d.urllib.request, 'getproxies', return_value={}):
            report = d.run()
        self.assertEqual(len(report['requests']), 6)
        self.assertEqual(report['verified_details'], 2)
        self.assertEqual(report['working_mode'], 'urllib')
        self.assertNotIn('真实公开', json.dumps(report, ensure_ascii=False))
        self.assertNotIn('outside', json.dumps(report))

    @patch.object(d.time, 'sleep')
    @patch.object(d.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '["IPv4"]'))
    def test_rejection_stops_other_routes_instead_of_retrying_through_restriction(self, *_):
        with patch.object(d, 'urllib_probe', return_value=({'http_code': 403}, b'')), patch.object(d, 'curl_probe') as curl:
            report = d.run()
        self.assertEqual(len(report['requests']), 1)
        self.assertTrue(report['stopped_after_rejection'])
        self.assertEqual(report['verified_details'], 0)
        curl.assert_not_called()


if __name__ == '__main__':
    unittest.main()
