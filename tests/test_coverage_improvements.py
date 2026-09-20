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

    def test_history_expansion_from_30_to_180_does_not_early_exit(self):
        with TemporaryDirectory() as tmp:
            now_iso = c.dt.datetime.now(c.TZ).isoformat()
            state = {
                'jobs': {
                    c.item_id(self.item(1)): dict(self.item(1), id=c.item_id(self.item(1)),
                                                  source_id='jobsdufe-announcements')
                },
                'sources': {
                    'jobsdufe-announcements': {
                        'id': 'jobsdufe-announcements',
                        'status': 'ok',
                        'total_items': 3,
                        'list_complete': True,
                        'completed_history_days': 30,
                        'last_full_scan_at': now_iso,
                        'last_patrol_at': now_iso,
                    }
                },
                'last_run_at': now_iso,
                'pending': {}
            }
            c.atomic_json(Path(tmp)/'state.json', state)
            calls = []
            def listing(source, page):
                calls.append(page)
                source['_total_items'] = 3
                return [self.item(page, {1: 0, 2: 40, 3: 150}[page])], 3

            with patch.object(c, 'sdei_list', side_effect=listing):
                c.run(self.args(tmp, pages=2))

            # Early exit must NOT trigger because completed_history_days (30) < target_history_days (180)
            self.assertIn(2, calls)
            state_after = self.read_state(tmp)
            self.assertEqual(state_after['sources']['jobsdufe-announcements']['target_history_days'], 180)

    def test_progressive_patrol_cursor_advances_across_runs(self):
        with TemporaryDirectory() as tmp:
            past_iso = (c.dt.datetime.now(c.TZ) - c.dt.timedelta(hours=80)).isoformat()
            state = {
                'jobs': {
                    c.item_id(self.item(1)): dict(self.item(1), id=c.item_id(self.item(1)),
                                                  source_id='jobsdufe-announcements')
                },
                'sources': {
                    'jobsdufe-announcements': {
                        'id': 'jobsdufe-announcements',
                        'status': 'ok',
                        'total_items': 5,
                        'list_complete': True,
                        'completed_history_days': 180,
                        'last_full_scan_at': past_iso,
                        'last_patrol_at': past_iso,
                        'patrol_page': 2,
                    }
                },
                'last_run_at': past_iso,
                'pending': {}
            }
            c.atomic_json(Path(tmp)/'state.json', state)

            calls = []
            def listing(source, page):
                calls.append(page)
                source['_total_items'] = 5
                return [self.item(page)], 5

            with patch.object(c, 'sdei_list', side_effect=listing):
                c.run(self.args(tmp, pages=2))

            self.assertEqual(calls, [1, 2])
            state1 = self.read_state(tmp)
            self.assertEqual(state1['sources']['jobsdufe-announcements']['patrol_page'], 3)

            # Second patrol run after another 80 hours: advances to page 3
            state1['sources']['jobsdufe-announcements']['last_patrol_at'] = past_iso
            c.atomic_json(Path(tmp)/'state.json', state1)
            calls.clear()
            with patch.object(c, 'sdei_list', side_effect=listing):
                c.run(self.args(tmp, pages=2))

            self.assertEqual(calls, [1, 3])
            state2 = self.read_state(tmp)
            self.assertEqual(state2['sources']['jobsdufe-announcements']['patrol_page'], 4)

    def test_two_tier_attribution_report_mutually_exclusive_reasons(self):
        def job(identifier, title='财务', cities=None, deadline='2026-10-31', verification='verified'):
            return {
                'id': identifier,
                'title': title,
                'source_id': 'sdei',
                'source_url': f'https://example.test/{identifier}',
                'kind': '具体岗位',
                'company': '公司',
                'body': f'工作地点：{",".join(cities or ["济南"])}',
                'cities': list(cities or ['济南']),
                'location_evidence': [],
                'deadline': deadline,
                'detail_verification': verification,
                'last_verified_at': '2026-09-20T10:00:00+08:00',
            }

        prev_jobs = {
            'j1': job('j1'),
            'j2': job('j2'),
            'j3': job('j3'),
            'j4': job('j4'),
            'j5': job('j5'),
            'j8': job('j8'),
            'j9': job('j9'),
        }
        previous_snapshot = {
            'jobs': [dict(c.public_record(j)) for j in prev_jobs.values()],
            'generated_at': '2026-09-18T10:00:00+08:00',
        }

        curr_jobs = {
            'j2': job('j2', verification='failed'),
            'j3': job('j3'),
            'j4': job('j4', deadline='2025-01-01'),
            'j5': job('j5', cities=['青岛']),
            'j6': job('j6'),
            'j7': job('j7', cities=['济南']),
            'j8': dict(job('j8'), listing_status='withdrawn'),
            'j9': dict(job('j9'), graduation_years=['2028']),
        }
        before_state = {'jobs': prev_jobs, 'last_run_at': '2026-09-18T10:00:00+08:00'}
        after_state = {'jobs': curr_jobs, 'last_run_at': '2026-09-20T10:00:00+08:00'}
        current_snapshot = {
            'jobs': [
                dict(c.public_record(curr_jobs['j4'])),
                dict(c.public_record(curr_jobs['j5'])),
                dict(c.public_record(curr_jobs['j6']), duplicate_ids=['j3']),
                dict(c.public_record(curr_jobs['j7'])),
                dict(c.public_record(curr_jobs['j8'])),
                dict(c.public_record(curr_jobs['j9'])),
            ],
            'raw_records': 7,
            'withheld_records': 1,
            'duplicates_merged': 1,
        }

        report = build_coverage_report(before_state, after_state, current_snapshot, previous_snapshot=previous_snapshot)
        preset = report['preset_filter_changes']
        self.assertEqual(preset['status'], 'compared')
        self.assertEqual(preset['before_visible_count'], 7)
        self.assertEqual(preset['after_visible_count'], 2)
        self.assertEqual(preset['dropped_count'], 7)
        self.assertEqual(preset['newly_visible_count'], 2)

        reasons = preset['primary_exclusion_reasons']
        self.assertEqual(reasons['removed_from_source'], 1)
        self.assertEqual(reasons['withheld_unverified'], 1)
        self.assertEqual(reasons['merged_duplicate'], 1)
        self.assertEqual(reasons['filtered_withdrawn'], 1)
        self.assertEqual(reasons['filtered_expired'], 1)
        self.assertEqual(reasons['filtered_city'], 1)
        self.assertEqual(reasons['filtered_year'], 1)
        self.assertEqual(sum(reasons.values()), preset['dropped_count'])

    def test_two_tier_attribution_report_initial_baseline(self):
        curr_jobs = {
            'j1': {'id': 'j1', 'title': '岗位1', 'cities': ['济南'], 'detail_verification': 'verified'},
            'j2': {'id': 'j2', 'title': '岗位2', 'cities': ['青岛'], 'detail_verification': 'verified'},
        }
        current_snapshot = {
            'jobs': [{'id': 'j1', 'cities': ['济南']}],
            'raw_records': 2,
            'withheld_records': 0,
            'duplicates_merged': 0,
        }
        report = build_coverage_report({}, {'jobs': curr_jobs}, current_snapshot, previous_snapshot=None)
        preset = report['preset_filter_changes']
        self.assertEqual(preset['status'], 'initial_or_no_baseline')
        self.assertEqual(preset['current_visible_count'], 1)
        self.assertNotIn('dropped_count', preset)

    def test_routine_run_with_new_announcement_reads_page_2_without_repeat(self):
        with TemporaryDirectory() as tmp:
            now_iso = c.dt.datetime.now(c.TZ).isoformat()
            state = {
                'jobs': {
                    c.item_id(self.item(99)): dict(self.item(99), id=c.item_id(self.item(99)),
                                                   source_id='jobsdufe-announcements')
                },
                'sources': {
                    'jobsdufe-announcements': {
                        'id': 'jobsdufe-announcements',
                        'status': 'ok',
                        'total_items': 5,
                        'list_complete': True,
                        'completed_history_days': 180,
                        'last_full_scan_at': now_iso,
                        'last_patrol_at': now_iso,
                    }
                },
                'last_run_at': now_iso,
                'pending': {}
            }
            c.atomic_json(Path(tmp)/'state.json', state)
            calls = []
            def listing(source, page):
                calls.append(page)
                source['_total_items'] = 6  # total items increased (new item on page 1)
                return [self.item(page)], 6

            with patch.object(c, 'sdei_list', side_effect=listing):
                # Routine run: pages=2, deep_scan=False, patrol not due
                c.run(self.args(tmp, pages=2))

            # Must read page 1 first, then page 2 (NEVER call page 1 twice!)
            self.assertEqual(calls, [1, 2])
            state_after = self.read_state(tmp)
            self.assertFalse(state_after['sources']['jobsdufe-announcements'].get('early_exit'))

    def test_patrol_does_not_skip_last_page(self):
        with TemporaryDirectory() as tmp:
            past_iso = (c.dt.datetime.now(c.TZ) - c.dt.timedelta(hours=80)).isoformat()
            state = {
                'jobs': {},
                'sources': {
                    'jobsdufe-announcements': {
                        'id': 'jobsdufe-announcements',
                        'status': 'ok',
                        'total_items': 6,
                        'list_complete': True,
                        'completed_history_days': 180,
                        'last_full_scan_at': past_iso,
                        'last_patrol_at': past_iso,
                        'patrol_page': 5,
                    }
                },
                'last_run_at': past_iso,
                'pending': {}
            }
            c.atomic_json(Path(tmp)/'state.json', state)
            calls = []
            def listing(source, page):
                calls.append(page)
                source['_total_items'] = 6
                return [self.item(page)], 6

            with patch.object(c, 'sdei_list', side_effect=listing):
                # pages=2: slot 1 reads page 1, slot 2 reads patrol_page (5)
                c.run(self.args(tmp, pages=2))

            self.assertEqual(calls, [1, 5])
            state1 = self.read_state(tmp)
            # patrol_page must be 6 (WAITING for page 6 to be read, NOT reset to 2 prematurely!)
            self.assertEqual(state1['sources']['jobsdufe-announcements']['patrol_page'], 6)

            # Next patrol run: reads page 1 and page 6
            state1['sources']['jobsdufe-announcements']['last_patrol_at'] = past_iso
            c.atomic_json(Path(tmp)/'state.json', state1)
            calls.clear()
            with patch.object(c, 'sdei_list', side_effect=listing):
                c.run(self.args(tmp, pages=2))

            self.assertEqual(calls, [1, 6])
            state2 = self.read_state(tmp)
            # Now that page 6 (the last page) was actually read, it should reset to 2!
            self.assertEqual(state2['sources']['jobsdufe-announcements']['patrol_page'], 2)

    def test_global_publication_uses_historical_snapshot_facts(self):
        def row(identifier, **fields):
            return dict(id=identifier, title='财务岗位', source_id='lcu-positions',
                        source_url=f'https://example.test/{identifier}',
                        kind='具体岗位', company='测试公司', body='', cities=['济南'], location_evidence=[], **fields)
        before = {'jobs': {'1': row('1', detail_verification='failed')}, 'last_run_at': '2026-09-18T10:00:00+08:00'}
        after = {'jobs': {'1': row('1', detail_verification='verified')}, 'last_run_at': '2026-09-20T10:00:00+08:00'}
        # Previous snapshot exists and was empty
        previous_snapshot = {'jobs': [], 'generated_at': '2026-09-18T10:00:00+08:00'}
        snapshot = {'jobs': [dict(c.public_record(after['jobs']['1']))], 'raw_records': 1, 'withheld_records': 0, 'duplicates_merged': 0}

        report = build_coverage_report(before, after, snapshot, previous_snapshot=previous_snapshot)
        # Should be classified as visibility_restored, NOT published_new_records,
        # because it was already present in historical baseline and was not published in previous_snapshot
        restored_ids = [r['id'] for r in report['global_published_changes']['events']['visibility_restored']]
        self.assertEqual(restored_ids, ['1'])

    def test_single_page_budget_alternates_patrol_turn(self):
        with TemporaryDirectory() as tmp:
            past_iso = (c.dt.datetime.now(c.TZ) - c.dt.timedelta(hours=80)).isoformat()
            state = {
                'jobs': {},
                'sources': {
                    'jobsdufe-announcements': {
                        'id': 'jobsdufe-announcements',
                        'status': 'ok',
                        'total_items': 5,
                        'list_complete': True,
                        'completed_history_days': 180,
                        'last_full_scan_at': past_iso,
                        'last_patrol_at': past_iso,
                        'patrol_page': 2,
                    }
                },
                'last_run_at': past_iso,
                'pending': {}
            }
            c.atomic_json(Path(tmp)/'state.json', state)
            calls = []
            def listing(source, page):
                calls.append(page)
                source['_total_items'] = 5
                return [self.item(page)], 5

            with patch.object(c, 'sdei_list', side_effect=listing):
                # Run 1: pages=1, patrol due. Slot 1 reads page 1, toggles patrol_turn to True
                c.run(self.args(tmp, pages=1))

            self.assertEqual(calls, [1])
            state1 = self.read_state(tmp)
            self.assertTrue(state1['sources']['jobsdufe-announcements']['patrol_turn'])
            # Since deep page was not read, last_patrol_at is NOT updated
            self.assertEqual(state1['sources']['jobsdufe-announcements']['last_patrol_at'], past_iso)

            # Run 2: pages=1, patrol_turn is True. Slot 1 reads patrol_page (2), updates last_patrol_at
            c.atomic_json(Path(tmp)/'state.json', state1)
            calls.clear()
            with patch.object(c, 'sdei_list', side_effect=listing):
                c.run(self.args(tmp, pages=1))

            self.assertEqual(calls, [2])
            state2 = self.read_state(tmp)
            self.assertFalse(state2['sources']['jobsdufe-announcements']['patrol_turn'])
            self.assertEqual(state2['sources']['jobsdufe-announcements']['patrol_page'], 3)
            self.assertNotEqual(state2['sources']['jobsdufe-announcements']['last_patrol_at'], past_iso)

    def test_location_match_with_evidence_in_coverage_report(self):
        from coverage_report import location_match
        job_jinan = {'cities': [], 'location_evidence': ['工作地点：济南市高新区软件园']}
        job_qingdao = {'cities': [], 'location_evidence': ['工作地点：青岛市市南区香港中路']}
        job_general = {'cities': ['济南'], 'location_evidence': []}
        self.assertEqual(location_match(job_jinan, '济南'), 'exact')
        self.assertEqual(location_match(job_qingdao, '济南'), 'none')
        self.assertEqual(location_match(job_general, '济南'), 'exact')

    def test_coverage_report_uses_snapshot_generated_at_for_expiration(self):
        # previous_snapshot generated at 10:00:00, before state has 14:00:00
        # A job with deadline 12:00:00 was active at 10:00:00, but expired by 14:00:00
        job_exp = {
            'id': 'exp1', 'title': '岗位', 'source_id': 'sdei',
            'body': '工作地点：济南', 'deadline': '2026-09-18T12:00:00+08:00',
            'detail_verification': 'verified',
        }
        prev_snap = {
            'jobs': [dict(c.public_record(job_exp))],
            'generated_at': '2026-09-18T10:00:00+08:00',
        }
        before = {
            'jobs': {'exp1': job_exp},
            'last_run_at': '2026-09-18T14:00:00+08:00',
        }
        after = {
            'jobs': {'exp1': job_exp},
            'last_run_at': '2026-09-20T10:00:00+08:00',
        }
        curr_snap = {
            'jobs': [dict(c.public_record(job_exp))],
            'raw_records': 1, 'withheld_records': 0, 'duplicates_merged': 0,
            'generated_at': '2026-09-20T10:00:00+08:00',
        }
        report = build_coverage_report(before, after, curr_snap, previous_snapshot=prev_snap)
        preset = report['preset_filter_changes']
        # Must count exp1 as visible in before_visible_count because 10:00 < 12:00
        self.assertEqual(preset['before_visible_count'], 1)
        # In curr_snap at 2026-09-20, it is expired, so after_visible_count is 0
        self.assertEqual(preset['after_visible_count'], 0)
        self.assertEqual(preset['dropped_count'], 1)
        self.assertEqual(preset['primary_exclusion_reasons']['filtered_expired'], 1)

    def test_published_changes_deduplicated_across_merged_channel_duplicates(self):
        # An announcement has 1 primary ID ('main') and 2 duplicate channel IDs ('dup1', 'dup2')
        # All 3 IDs exist in before and after state (raw channel records)
        raw_main = {'id': 'main', 'title': '校招公告', 'source_id': 'sdei', 'source_url': 'http://sdei/1',
                    'detail_verification': 'verified', 'cities': ['济南'], 'deadline': '2026-09-19T12:00:00+08:00'}
        raw_dup1 = {'id': 'dup1', 'title': '校招公告', 'source_id': 'dufe', 'source_url': 'http://dufe/1',
                    'detail_verification': 'verified', 'cities': ['济南'], 'deadline': '2026-09-19T12:00:00+08:00'}
        raw_dup2 = {'id': 'dup2', 'title': '校招公告', 'source_id': 'ujn', 'source_url': 'http://ujn/1',
                    'detail_verification': 'verified', 'cities': ['济南'], 'deadline': '2026-09-19T12:00:00+08:00'}

        before = {
            'jobs': {'main': raw_main, 'dup1': raw_dup1, 'dup2': raw_dup2},
            'last_run_at': '2026-09-18T10:00:00+08:00',
        }
        prev_snap = {
            'jobs': [
                {
                    'id': 'main', 'title': '校招公告', 'source_id': 'sdei', 'source_url': 'http://sdei/1',
                    'duplicate_ids': ['dup1', 'dup2'],
                    'cities': ['济南'],
                    'deadline': '2026-09-19T12:00:00+08:00',
                }
            ],
            'generated_at': '2026-09-18T10:00:00+08:00',
        }

        # In after run: deadline extended to 2026-09-25, and cities changed to ['济南', '青岛']
        raw_main_new = dict(raw_main, deadline='2026-09-25T12:00:00+08:00', cities=['济南', '青岛'])
        raw_dup1_new = dict(raw_dup1, deadline='2026-09-25T12:00:00+08:00', cities=['济南', '青岛'])
        raw_dup2_new = dict(raw_dup2, deadline='2026-09-25T12:00:00+08:00', cities=['济南', '青岛'])
        after = {
            'jobs': {'main': raw_main_new, 'dup1': raw_dup1_new, 'dup2': raw_dup2_new},
            'last_run_at': '2026-09-20T10:00:00+08:00',
        }
        curr_snap = {
            'jobs': [
                {
                    'id': 'main', 'title': '校招公告', 'source_id': 'sdei', 'source_url': 'http://sdei/1',
                    'duplicate_ids': ['dup1', 'dup2'],
                    'cities': ['济南', '青岛'],
                    'deadline': '2026-09-25T12:00:00+08:00',
                }
            ],
            'raw_records': 3, 'withheld_records': 0, 'duplicates_merged': 2,
            'generated_at': '2026-09-20T10:00:00+08:00',
        }

        report = build_coverage_report(before, after, curr_snap, previous_snapshot=prev_snap)
        events = report['global_published_changes']['events']

        # Deadline changed should only be counted ONCE, not 3 times!
        self.assertEqual(len(events['deadline_changed']), 1)
        self.assertEqual(report['event_counts']['deadline_changed'], 1)
        self.assertEqual(events['deadline_changed'][0]['id'], 'main')
        self.assertEqual(events['deadline_changed'][0]['duplicate_ids'], ['dup1', 'dup2'])
        self.assertEqual(events['deadline_changed'][0]['before'], '2026-09-19T12:00:00+08:00')
        self.assertEqual(events['deadline_changed'][0]['after'], '2026-09-25T12:00:00+08:00')

        # Cities changed should only be counted ONCE, not 3 times!
        self.assertEqual(len(events['cities_changed']), 1)
        self.assertEqual(report['event_counts']['cities_changed'], 1)
        self.assertEqual(events['cities_changed'][0]['id'], 'main')
        self.assertEqual(events['cities_changed'][0]['duplicate_ids'], ['dup1', 'dup2'])

        # Now test newly_expired deduplication:
        # If curr_snap's deadline was in the past (e.g. 2026-09-19 12:00 while generated_at is 2026-09-20)
        curr_snap_exp = copy.deepcopy(prev_snap)
        curr_snap_exp['generated_at'] = '2026-09-20T10:00:00+08:00'
        report_exp = build_coverage_report(before, after, curr_snap_exp, previous_snapshot=prev_snap)
        events_exp = report_exp['global_published_changes']['events']
        self.assertEqual(len(events_exp['newly_expired']), 1)
        self.assertEqual(report_exp['event_counts']['newly_expired'], 1)
        self.assertEqual(events_exp['newly_expired'][0]['id'], 'main')
        self.assertEqual(events_exp['newly_expired'][0]['duplicate_ids'], ['dup1', 'dup2'])




