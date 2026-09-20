import contextlib
import copy
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
from coverage_report import build_coverage_report


class CoverageImprovements(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
        self.stack.enter_context(contextlib.redirect_stderr(io.StringIO()))
        self.stack.enter_context(patch.dict(c.os.environ, {'GITHUB_STEP_SUMMARY': ''}))
        self.stack.enter_context(patch.object(c, 'fetch', side_effect=AssertionError('unexpected network')))
        self.stack.enter_context(patch.object(c, 'fetch_bytes', side_effect=AssertionError('unexpected attachment request')))
        self.stack.enter_context(patch.object(c.collector_runtime.time, 'sleep', side_effect=AssertionError('unexpected wait')))

    def args(self, tmp, sources='jobsdufe-announcements', pages=2, deep_scan=False):
        return SimpleNamespace(data_dir=Path(tmp), public_dir=Path(tmp), sources=sources,
            pages=pages, days=30, history_days=180, refresh_hours=72,
            nankai_area=0, target_city='', offerjack_pages=1, probe_budget=0, state_only=True,
            deep_scan=deep_scan)

    def item(self, page, age=0):
        return {'url': f'https://example.test/{page}', 'title': f'机会{page}',
                'published_at': (c.dt.datetime.now(c.TZ)-c.dt.timedelta(days=age)).date().isoformat(),
                'inline_html': '<div id="zoom">财务岗位，工作地点：济南</div>'}

    def read_state(self, tmp):
        return json.loads((Path(tmp)/'state.json').read_text(encoding='utf-8'))

    def test_history_sweep_reaches_old_jobs_with_bounded_resume(self):
        with TemporaryDirectory() as tmp:
            calls = []
            def listing(source, page):
                calls.append(page)
                return [self.item(page, {1: 0, 2: 60, 3: 120, 4: 220}[page])], 5
            with patch.object(c, 'sdei_list', side_effect=listing):
                c.run(self.args(tmp))
                self.assertEqual(calls, [1, 2])
                self.assertEqual(len(self.read_state(tmp)['jobs']), 2)
                calls.clear()
                c.run(self.args(tmp))
                self.assertEqual(calls, [1, 3])
                calls.clear()
                c.run(self.args(tmp))
                self.assertEqual(calls, [1, 4])
            state = self.read_state(tmp)
            self.assertEqual(len(state['jobs']), 3)
            self.assertTrue(state['sources']['jobsdufe-announcements']['list_complete'])

    def test_safe_early_exit_and_deep_scan_behavior(self):
        with TemporaryDirectory() as tmp:
            def listing(source, page):
                source['_total_items'] = 2
                return [self.item(page)], 2
            with patch.object(c, 'sdei_list', side_effect=listing):
                c.run(self.args(tmp))
            calls = []
            def replaced(source, page):
                calls.append(page)
                source['_total_items'] = 2
                return [self.item(1 if page == 1 else 99)], 2
            # Normal run: safe early-exit triggers on unchanged front page
            with patch.object(c, 'sdei_list', side_effect=replaced):
                c.run(self.args(tmp, deep_scan=False))
            self.assertEqual(calls, [1])
            self.assertTrue(self.read_state(tmp)['sources']['jobsdufe-announcements']['early_exit'])
            self.assertEqual(len(self.read_state(tmp)['jobs']), 2)

            # Deep scan run: bypasses safe early-exit and scans all pages
            calls.clear()
            with patch.object(c, 'sdei_list', side_effect=replaced):
                c.run(self.args(tmp, deep_scan=True))
            self.assertEqual(calls, [1, 2])
            self.assertEqual(len(self.read_state(tmp)['jobs']), 3)

    def test_collector_checks_positions_when_announcement_has_no_changes(self):
        sources = 'jobsdufe-announcements,jobsdufe-positions'
        with TemporaryDirectory() as tmp:
            def listing(source, page):
                item = self.item(source['id'])
                return [item], 1
            with patch.object(c, 'sdei_list', side_effect=listing) as mocked:
                c.run(self.args(tmp, sources))
                mocked.reset_mock()
                c.run(self.args(tmp, sources))
                self.assertEqual({call.args[0]['id'] for call in mocked.call_args_list}, set(sources.split(',')))

    def test_ci_dispatches_fresh_positions_independently(self):
        sources = 'jobsdufe-announcements,jobsdufe-positions'
        now = c.dt.datetime.now(c.TZ).isoformat()
        definitions = [s for s in c.SOURCES if s['id'] in sources.split(',')]
        with TemporaryDirectory() as tmp:
            baseline = {'jobs': {}, 'sources': {s['id']: dict(s, status='ok', errors=[],
                last_success_at=now, list_complete=True) for s in definitions}, 'last_run_at': now}
            c.atomic_json(Path(tmp)/'state.json', baseline)
            def worker(source, prior, args, budget):
                return dict(prior, sources={source['id']: baseline['sources'][source['id']]}, last_run_at=now)
            with patch.object(ci, 'run_source', side_effect=worker) as run, patch.object(ci, 'write_report'):
                ci.collect(self.args(tmp, sources))
            self.assertEqual({call.args[0]['id'] for call in run.call_args_list}, set(sources.split(',')))

    def test_report_explains_changes_without_mutating_baselines(self):
        def row(identifier, **fields):
            return dict(id=identifier, title='财务岗位', source_id='lcu-positions',
                source_url=f'https://school.gxjy.sdei.edu.cn/lcu/school/companyissueinfo/edit1/{identifier}',
                kind='具体岗位', company='测试公司', body='', cities=[], location_evidence=[], **fields)
        before = {'last_run_at': '2026-09-18T09:00:00+08:00', 'jobs': {
            '1': row('1', detail_verification='verified'),
            '2': row('2', detail_verification='failed'),
            '3': row('3', detail_verification='verified')}}
        after = {'last_run_at': '2026-09-19T09:00:00+08:00', 'jobs': {
            '1': dict(before['jobs']['1'], detail_verification='failed',
                      body='报名有效期至2025年11月30日。\n工作地点：济南'),
            '2': dict(before['jobs']['2'], detail_verification='verified'),
            '4': row('4', detail_verification='verified')}}
        snapshot = {'jobs': [dict(after['jobs']['2'], duplicate_ids=['4'])],
                    'raw_records': 2, 'withheld_records': 1, 'duplicates_merged': 1}
        original = copy.deepcopy((before, after, snapshot))
        report = build_coverage_report(before, after, snapshot)
        for key in ('new_records', 'missing_records', 'withheld', 'visibility_restored',
                    'cities_changed', 'deadline_changed', 'newly_expired', 'duplicate_groups'):
            self.assertEqual(report['event_counts'][key], 1, key)
        self.assertEqual(report['counts']['published_groups'], 1)
        self.assertEqual((before, after, snapshot), original)
