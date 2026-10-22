import contextlib
import datetime as dt
import io
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import collect as c
import ci_collect as ci
from collection_plan import scan_plan, defer_detail, retry_due, prioritize_details
from audit_freshness import audit


class FreshnessTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        self.enterContext(contextlib.redirect_stderr(io.StringIO()))
        self.enterContext(patch.dict(c.os.environ, {'GITHUB_STEP_SUMMARY': ''}))

    def test_all_school_channels_get_a_head_turn_before_any_backfill(self):
        definitions = [s for s in c.SOURCES if s.get('adapter') == 'sdei']
        plan = scan_plan(definitions, lambda source: source['id'], True)
        heads = [s['id'] for s, head in plan if head]
        self.assertEqual(set(heads), {s['id'] for s in definitions})
        self.assertEqual(len(heads), len(set(heads)))
        self.assertTrue(all(head for _, head in plan[:len(heads)]))

    def test_head_pass_keeps_history_cursor_and_old_pending_but_parses_new_announcements(self):
        with TemporaryDirectory() as tmp:
            now = c.dt.datetime.now(c.TZ).isoformat(timespec='seconds')
            today = now[:10]
            sid = 'sdut-announcements'
            old_pending = [{'url': f'https://example.test/old/{i}', 'title': f'Old {i}', 'published_at': '2026-01-01'} for i in range(30)]
            c.atomic_json(Path(tmp) / 'state.json', {'jobs': {}, 'sources': {sid: {
                'id': sid, 'resume_page': 37, 'patrol_page': 12, 'list_complete': False,
                'head_scan_at': '2026-09-01T00:00:00+08:00',
                'last_success_at': '2026-09-01T00:00:00+08:00'}}, 'pending': {sid: old_pending}, 'last_run_at': now})
            found = [{'url': f'https://example.test/new/{i}', 'title': f'New {i}', 'published_at': today,
                'inline_html': '<div id="zoom">工作地点：济南。本科招聘，详见原公告。</div>'} for i in range(20)]
            args = SimpleNamespace(data_dir=tmp, public_dir=tmp, sources=sid, pages=5,
                days=30, refresh_hours=72, nankai_area=0, target_city='', offerjack_pages=1,
                probe_budget=10, state_only=True, head_only=True)
            with patch.object(c, 'sdei_list', side_effect=lambda source, page: (found[(page-1)*10:page*10], 100)) as listing, patch.object(c, 'fetch', side_effect=AssertionError('old backlog fetched')):
                c.run(args)
            self.assertEqual(listing.call_count, 2)
            state = json.loads((Path(tmp) / 'state.json').read_text(encoding='utf-8'))
            self.assertGreaterEqual(state['sources'][sid]['head_scan_at'], now)
            self.assertEqual(state['sources'][sid]['resume_page'], 37)
            self.assertEqual(state['sources'][sid]['patrol_page'], 12)
            self.assertEqual(len(state['jobs']), 12)
            self.assertEqual(len(state['pending'][sid]), 38)
            self.assertTrue(all(item['url'] in {p['url'] for p in state['pending'][sid]} for item in old_pending))

    def test_rotated_backfill_does_not_overwrite_successful_head_scan(self):
        with TemporaryDirectory() as tmp:
            directory = Path(tmp)
            stamp = c.dt.datetime.now(c.TZ).isoformat(timespec='seconds')
            ids = ['sdut-announcements', 'sdut-talks', 'sdut-positions']
            c.atomic_json(directory / 'state.json', {'jobs': {}, 'sources': {}, 'pending': {}, 'last_run_at': stamp})
            calls = []
            def worker(source, prior, args, budget):
                calls.append((source['id'], args.head_only, budget))
                status = dict(source, status='ok', pages=1, parsed=0, cached=1, errors=[],
                    last_attempt_at=stamp, last_success_at=stamp, list_complete=False)
                if args.head_only:
                    status['head_scan_at'] = stamp
                return {'jobs': {}, 'sources': {source['id']: status}, 'pending': {source['id']: []}, 'last_run_at': stamp}
            args = SimpleNamespace(data_dir=directory, sources=','.join(ids), source_pack='',
                freshness_first=True, shard_budget=300, source_budget=30, deep_scan=False)
            with patch.object(ci, 'run_source', side_effect=worker), patch.object(c, 'get_active_sdei_schools', return_value=(set(), 1)):
                ci.collect(args)
            state = ci.read_json(directory / 'state.json')
            self.assertEqual({sid for sid, head, _ in calls if head}, set(ids))
            self.assertTrue(all(head for _, head, _ in calls[:3]))
            self.assertTrue(all(budget <= 30 for _, _, budget in calls))
            self.assertEqual(state['sources']['sdut-announcements']['status'], 'ok')
            self.assertEqual(state['sources']['sdut-talks']['head_scan_at'], stamp)

    def test_detail_backoff_preserves_work_and_prioritizes_newer_fail_free_items(self):
        now = dt.datetime(2026, 10, 22, 12, tzinfo=c.TZ)
        broken = {'url': 'https://example.test/broken', 'published_at': '2026-09-01'}
        defer_detail(broken, now)
        self.assertFalse(retry_due(broken, now))
        self.assertTrue(retry_due(broken, now + dt.timedelta(hours=3)))
        fresh = {'url': 'https://example.test/fresh', 'published_at': '2026-10-22'}
        prior = {'url': 'https://example.test/prior', 'published_at': '2026-10-20'}
        self.assertEqual(prioritize_details([broken, prior, fresh], {}), [fresh, prior, broken])

    def test_upcoming_talks_precede_past_backlog_and_key_changes_invalidate_signature(self):
        from collection_plan import listing_signature
        today = c.dt.datetime.now(c.TZ).date()
        past = {'url': 'https://example.test/past', 'structured': {'fairDate': (today - dt.timedelta(days=1)).isoformat()}}
        upcoming = {'url': 'https://example.test/next', 'structured': {'fairDate': (today + dt.timedelta(days=1)).isoformat(), 'fairAddress': '报告厅'}}
        self.assertEqual(prioritize_details([past, upcoming], {})[0], upcoming)
        self.assertNotEqual(listing_signature(upcoming), listing_signature(dict(upcoming, structured={**upcoming['structured'], 'fairAddress': '新报告厅'})))

    def test_audit_does_not_confuse_new_snapshot_with_fresh_sources_or_future_dates(self):
        now = dt.datetime(2026, 10, 22, 12, tzinfo=c.TZ)
        event = {'id': 'event', 'date': '2026-10-23', 'city': '济南', 'school': '大学', 'venue': '报告厅'}
        report = audit({'generated_at': now.isoformat(), 'jobs': [
            {'published_at': '2026-10-22', 'talk_events': [event]},
            {'published_at': '2027-01-17', 'talk_events': [event]},
            {'published_at': '2026-09-11'}], 'sources': [
            {'id': 'old', 'status': 'failed', 'last_success_at': '2026-09-11T12:00:00+08:00'},
            {'id': 'partial', 'status': 'partial', 'last_list_read_at': '2026-10-22T10:00:00+08:00', 'pending_details': 20}]}, now)
        self.assertEqual(report['latest_publication'], '2026-10-22')
        self.assertEqual(report['sources_checked_last_24_hours'], 1)
        self.assertEqual(report['future_publication_dates'], 1)
        self.assertEqual(report['pending_details'], 20)
        self.assertEqual(report['upcoming_talks'], 1)

    def test_official_bank_url_date_is_a_calendar_date(self):
        html = '<a href="./202610/t20261022_123456.html">2027届校园招聘</a>'
        items, _ = c.official_bank_list(html, 'https://www.psbc.com/cn/gyyc/rczp/xyzp/', {})
        self.assertEqual(items[0]['published_at'], '2026-10-22')

    def test_future_source_publication_is_kept_as_evidence_without_faking_today(self):
        row = c.public_record({'id': 'future', 'title': '招聘公告', 'company': '', 'source_id': 'bzmc-announcements',
            'body': '', 'published_at': '2027-01-17', 'first_seen_at': '2026-10-20T12:00:00+08:00',
            'last_verified_at': '2026-10-22T12:00:00+08:00', 'cities': [], 'location_evidence': []})
        self.assertIsNone(row['published_at'])
        self.assertEqual(row['source_published_at'], '2027-01-17')


if __name__ == '__main__':
    unittest.main()
