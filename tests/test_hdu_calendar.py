"""Public compressed HTML, malformed pages and bounded source orchestration."""
import base64
import contextlib
import io
import json
import sys
import unittest
import urllib.error
import zlib
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import collect as c
from external_calendars import jysd_calendar, check_jysd_robots
from city_registry import resolve_event_city

SOURCE = next(row for row in c.SOURCES if row['id'] == 'hdu-talks')


def document(page=1, outer=88, inner=75):
    # Exact publicly observed wrapper, synthetic names and stable test dates.
    rows = ''.join(f'<ul class="infoList teachinList"><li><span class="status-text">{mode}</span>'
        f'<a href="/teachin/view/id/{page}{index}">示例单位{index}</a></li><li>{venue}</li>'
        '<li>2026-11-03 14:00-16:30（周二）</li></ul>' for index, (mode, venue) in
        enumerate([('线下', '第6教研楼中105'), ('线上', '线上宣讲')]))
    rows += '<a href="/teachin/index/do1/job.hdu.edu.cn/domain/hdu/page/44">44</a>'
    payload = 'x' * outer + base64.b64encode(('x' * inner + rows).encode()).decode()
    encoded = base64.b64encode(zlib.compress(payload.encode())).decode()
    return f'<script>$(this).replaceWith(Base64.decode(unzip("{encoded}").substr({outer})).substr({inner}));</script>'


class HduCalendarTests(unittest.TestCase):
    def test_independent_per_response_literal_offsets_preserve_events(self):
        baseline = jysd_calendar(document(), SOURCE)
        for outer, inner in [(71, 39), (79, 69), (0, 0), (999, 999)]:
            self.assertEqual(jysd_calendar(document(outer=outer, inner=inner), SOURCE), baseline)
    def test_physical_and_online_are_distinct_without_inventing_job_cities(self):
        items, pages = jysd_calendar(document(), SOURCE)
        self.assertEqual(pages, 44)
        physical, online = [c.calendar_record(item, SOURCE) for item in items]
        self.assertEqual(physical['talk_event']['city'], '杭州')
        self.assertEqual(physical['talk_event']['event_type'], 'talk')
        self.assertEqual(physical['talk_event']['start_time'], '14:00')
        self.assertEqual(physical['talk_event']['end_time'], '16:30')
        self.assertIsNone(physical['published_at'])
        self.assertEqual(physical['cities'], [])
        self.assertEqual(online['talk_event']['mode'], 'online')
        self.assertIsNone(online['talk_event']['city'])
        self.assertIsNone(resolve_event_city('杭州电子科技大学', '绍兴市 第6教研楼中105')[0])
        self.assertIsNone(resolve_event_city('未知大学', '第6教研楼中105')[0])
        self.assertEqual(resolve_event_city('杭州电子科技大学', '第3教研楼401')[0], '杭州')
        self.assertEqual(resolve_event_city('杭州电子科技大学', '第12教研楼107')[0], '杭州')
        self.assertIsNone(resolve_event_city('杭州电子科技大学', '第9教研楼107')[0])

    def test_missing_changed_or_oversized_fragment_is_never_empty_success(self):
        for html in ['请登录', '<section id="content8370"></section>', document() * 2, document().replace('substr(88)', 'substring(88)')]:
            with self.assertRaises(ValueError): jysd_calendar(html, SOURCE)
        with self.assertRaises(ValueError):
            jysd_calendar(document(), dict(SOURCE, url='https://zjut.jysd.com/teachin'))
        bomb = base64.b64encode(zlib.compress(b'x' * 1_000_002)).decode()
        with self.assertRaises(ValueError):
            jysd_calendar(f'Base64.decode(unzip("{bomb}").substr(88)).substr(75))', SOURCE)

    def test_robots_denial_and_network_failure_stop_collection(self):
        with self.assertRaises(PermissionError):
            check_jysd_robots(lambda *a, **k: 'User-agent:*\nDisallow:/', SOURCE)
        with self.assertRaises(ValueError):
            check_jysd_robots(lambda *a, **k: '<html>captcha</html>', SOURCE)
        with self.assertRaises(TimeoutError):
            check_jysd_robots(lambda *a, **k: (_ for _ in ()).throw(TimeoutError()), SOURCE)
        check_jysd_robots(lambda *a, **k: (_ for _ in ()).throw(urllib.error.HTTPError(a[0], 404, '', {}, None)), SOURCE)

    def test_orchestration_reads_two_pages_resumes_and_never_requests_event_details(self):
        calls = []
        def fetch(url, **kwargs):
            calls.append(url)
            if url.endswith('/robots.txt'):
                return 'User-agent:*\nAllow:/'
            if url == SOURCE['url']:
                return document()
            return document(int(url.rsplit('/', 1)[1]))
        with TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            args = SimpleNamespace(data_dir=directory, public_dir=directory, sources='hdu-talks', pages=8,
                days=30, refresh_hours=72, nankai_area=0, target_city='', offerjack_pages=1, probe_budget=0, state_only=True)
            with patch.object(c, 'fetch', side_effect=fetch):
                self.assertEqual(c.run(args), 0)
                state = json.loads((Path(directory) / 'state.json').read_text(encoding='utf-8'))
                self.assertEqual(len(state['jobs']), 4)
                self.assertEqual(state['pending']['hdu-talks'], [])
                self.assertFalse(state['sources']['hdu-talks']['list_complete'])
                self.assertEqual(c.run(args), 0)
            self.assertTrue(calls[-1].endswith('/page/3'))
            self.assertFalse(any('/view/' in url for url in calls))
            self.assertIn('hdu-talks', c.SOURCE_PACKS['universities-a'])
            self.assertNotIn('hdu-talks', c.SOURCE_PACKS['universities-b'])


if __name__ == '__main__':
    unittest.main()
