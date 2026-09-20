import contextlib
import io
import datetime as dt
import importlib.util
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
spec = importlib.util.spec_from_file_location('ci_collect', ROOT / 'scripts/ci_collect.py')
ci = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ci)
import collect as c


def fixture():
    stamp = '2026-09-01T12:00:00+08:00'
    source = {'id': 'fixture', 'name': 'Fixture', 'url': 'https://example.com', 'status': 'ok',
              'last_attempt_at': stamp, 'last_success_at': stamp, 'parsed': 2, 'errors': []}
    html = '<div id="zoom">工作地点：济南<br>校园招聘2027届毕业生，财务和管理岗位。' + '具体岗位要求请核对。' * 12 + '</div>'
    first = c.parse_detail(html, {'url': 'https://example.com/1', 'title': '甲公司2027届校园招聘',
                                  'published_at': '2026-09-01', 'structured': {'companyName': '甲公司'}}, source)
    second = dict(first, id='abcdef01234567890123', source_url='https://example.com/2')
    jobs, _ = c.merge({}, [first, second], stamp)
    return {'jobs': jobs, 'sources': {'fixture': source}, 'last_run_at': stamp}


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self.output = io.StringIO()
        self.enterContext(contextlib.redirect_stdout(self.output))
        self.enterContext(contextlib.redirect_stderr(self.output))
        summary_patch = patch.dict(c.os.environ, {'GITHUB_STEP_SUMMARY':''})
        summary_patch.start()
        self.addCleanup(summary_patch.stop)

    def test_merge_shards_keeps_baseline_and_requires_fresh_pack_sources(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            public, data, shards = root / 'public', root / 'data', root / 'shards'
            public.mkdir()
            data.mkdir()
            baseline = fixture()
            c.export_snapshot(baseline, public)
            ci.atomic_json(data / 'state.json', baseline)
            stamp = '2026-09-14T12:00:00+08:00'
            shard = json.loads(json.dumps(baseline))
            shard['last_run_at'] = stamp
            for source_id in c.source_pack_ids('finance'):
                shard['sources'][source_id] = {
                    'id': source_id, 'name': source_id, 'status': 'ok',
                    'last_attempt_at': stamp, 'last_success_at': stamp,
                    'parsed': 0, 'cached': 1, 'errors': [],
                }
            shard_dir = shards / 'collector-shard-finance'
            shard_dir.mkdir(parents=True)
            ci.atomic_json(shard_dir / 'state.json', shard)

            result = ci.merge_shards(public, data, shards, days=30, expected_shards=['finance'])
            self.assertEqual(result, 0)
            merged = ci.read_json(data / 'state.json')
            self.assertEqual(set(baseline['jobs']), set(merged['jobs']))
            self.assertTrue(all(source_id in merged['sources'] for source_id in c.source_pack_ids('finance')))
            self.assertTrue((data / 'ci-report.json').exists())

    def test_merge_shards_handles_nested_data_directory_artifact(self):
        """GitHub Actions v4 downloads artifact with preserved relative directory: collector-shard-pack/data/state.json"""
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            public, data, shards = root / 'public', root / 'data', root / 'shards'
            public.mkdir()
            data.mkdir()
            baseline = fixture()
            c.export_snapshot(baseline, public)
            ci.atomic_json(data / 'state.json', baseline)
            stamp = '2026-09-14T12:00:00+08:00'
            shard = json.loads(json.dumps(baseline))
            shard['last_run_at'] = stamp
            for source_id in c.source_pack_ids('finance'):
                shard['sources'][source_id] = {
                    'id': source_id, 'name': source_id, 'status': 'ok',
                    'last_attempt_at': stamp, 'last_success_at': stamp,
                    'parsed': 0, 'cached': 1, 'errors': [],
                }
            # Note the nested 'data' directory created by GitHub download-artifact v4:
            shard_data_dir = shards / 'collector-shard-finance' / 'data'
            shard_data_dir.mkdir(parents=True)
            ci.atomic_json(shard_data_dir / 'state.json', shard)

            result = ci.merge_shards(public, data, shards, days=30, expected_shards=['finance'])
            self.assertEqual(result, 0)
            merged = ci.read_json(data / 'state.json')
            self.assertEqual(set(baseline['jobs']), set(merged['jobs']))
            self.assertTrue(all(source_id in merged['sources'] for source_id in c.source_pack_ids('finance')))


    def test_cold_start_recovers_full_details_reposts_and_history(self):
        with TemporaryDirectory() as tmp:
            public, data = Path(tmp) / 'public', Path(tmp) / 'data'
            public.mkdir()
            state = fixture()
            snapshot = c.export_snapshot(state, public)
            self.assertEqual(len(snapshot['jobs']), 1)
            ci.prepare(public, data, '')
            restored = ci.read_json(data / 'state.json')
            self.assertEqual(set(restored['jobs']), set(state['jobs']))
            self.assertEqual({j['source_url'] for j in restored['jobs'].values()}, {'https://example.com/1', 'https://example.com/2'})
            self.assertEqual(restored['last_run_at'], state['last_run_at'])
            self.assertEqual({j['last_verified_at'] for j in restored['jobs'].values()}, {state['last_run_at']})
            again = c.export_snapshot(restored, public)
            self.assertEqual(again['raw_records'], 2)
            self.assertEqual(len(again['jobs']), 1)

    def test_snapshot_restore_fidelity_preserves_duplicate_facts(self):
        with TemporaryDirectory() as tmp:
            public, data = Path(tmp) / 'public', Path(tmp) / 'data'
            public.mkdir()
            stamp = '2026-09-01T12:00:00+08:00'
            source = {'id': 'fixture', 'name': 'Fixture', 'url': 'https://example.com', 'status': 'ok',
                      'last_attempt_at': stamp, 'last_success_at': stamp, 'parsed': 2, 'errors': []}
            master = {
                'id': '11000000000000000000',
                'title': '某集团2027届校园招聘',
                'company': '某大型集团',
                'kind': '招聘公告',
                'types': ['校招'],
                'graduation_years': ['2027'],
                'published_at': '2026-09-01',
                'cities': ['北京'],
                'location_evidence': ['工作地点：北京'],
                'education': '硕士及以上',
                'deadline': '2026-11-30',
                'source_id': 'fixture',
                'source_name': '总公司招聘网',
                'source_url': 'https://example.com/master',
                'provenance': '公开原始来源',
                'first_seen_at': '2026-09-01T10:00:00+08:00',
                'last_verified_at': stamp,
                'body': '总公司招聘正文' * 20,
            }
            duplicate = {
                'id': '22000000000000000000',
                'title': '某集团山东分部2027校招',
                'company': '某大型集团',
                'kind': '招聘公告',
                'types': ['校招'],
                'graduation_years': ['2027'],
                'published_at': '2026-09-02',
                'cities': ['济南'],
                'location_evidence': ['工作地点：济南'],
                'education': '本科及以上',
                'deadline': '2026-10-15',
                'position_count': 5,
                'source_id': 'fixture',
                'source_name': '山大就业网',
                'source_url': 'https://example.com/sdu',
                'provenance': '公开原始来源',
                'first_seen_at': '2026-09-02T10:00:00+08:00',
                'last_verified_at': stamp,
                'body': '分部招聘正文' * 20,
            }
            state = {'jobs': {master['id']: master, duplicate['id']: duplicate},
                     'sources': {'fixture': source}, 'last_run_at': stamp}
            snapshot = c.export_snapshot(state, public)
            self.assertEqual(len(snapshot['jobs']), 1)
            self.assertIn(duplicate['id'], snapshot['jobs'][0]['duplicate_ids'])

            ci.prepare(public, data, '')
            restored = ci.read_json(data / 'state.json')
            self.assertEqual(len(restored['jobs']), 2)

            restored_dup = restored['jobs'][duplicate['id']]
            self.assertEqual(restored_dup['title'], '某集团山东分部2027校招')
            self.assertEqual(restored_dup['cities'], ['济南'])
            self.assertEqual(restored_dup['education'], '本科及以上')
            self.assertEqual(restored_dup['deadline'], '2026-10-15')
            self.assertEqual(restored_dup['position_count'], 5)
            self.assertEqual(restored_dup['source_url'], 'https://example.com/sdu')

    def test_cache_union_keeps_newer_facts_and_additional_jobs(self):
        before = fixture()
        newer = json.loads(json.dumps(before))
        identifier = next(iter(newer['jobs']))
        newer['jobs'][identifier].update(last_verified_at='2026-09-02T12:00:00+08:00', title='延期公告')
        newer['jobs']['extra'] = dict(newer['jobs'][identifier], id='extra')
        combined = ci.combine_states(before, newer)
        self.assertEqual(len(combined['jobs']), 3)
        self.assertEqual(combined['jobs'][identifier]['title'], '延期公告')

    def test_bad_asset_path_and_missing_repost_are_rejected(self):
        snapshot = {'schema_version': 2, 'jobs': [{'id': 'aa'}], 'sources': [],
                    'detail_shards': {'aa': '/../data/state.json'}}
        with self.assertRaisesRegex(ValueError, 'asset path'):
            ci.snapshot_state(snapshot, lambda _: self.fail('unsafe read'))
        with TemporaryDirectory() as tmp:
            public = Path(tmp)
            snapshot = c.export_snapshot(fixture(), public)
            def missing_repost(path):
                payload = ci.read_json(public / path.lstrip('/'))
                next(iter(payload['jobs'].values()))['duplicate_ids'] = []
                return payload
            with self.assertRaisesRegex(ValueError, 'Repost'):
                ci.snapshot_state(snapshot, missing_repost)

    def test_partial_is_allowed_only_after_fresh_complete_publication(self):
        state = fixture()
        started = dt.datetime.fromisoformat(state['last_run_at'])
        with TemporaryDirectory() as tmp:
            snapshot = c.export_snapshot(state, Path(tmp))
            self.assertEqual(len(ci.validate_result(2, state, snapshot, state['jobs'], started)), 1)
            with self.assertRaisesRegex(ValueError, 'crashed'):
                ci.validate_result(1, state, snapshot, state['jobs'], started)
            with self.assertRaisesRegex(ValueError, 'fresh snapshot'):
                ci.validate_result(2, state, snapshot, state['jobs'], started + dt.timedelta(seconds=1))
            with self.assertRaisesRegex(ValueError, 'Historical'):
                ci.validate_result(2, state, snapshot, ['lost-job'], started)
            bad = dict(snapshot, jobs=[dict(snapshot['jobs'][0], duplicate_ids=[])])
            with self.assertRaisesRegex(ValueError, 'Historical'):
                ci.validate_result(2, state, bad, state['jobs'], started)
            state['sources']['fixture'].update(status='failed', parsed=0, cached=0)
            with self.assertRaisesRegex(ValueError, 'No source'):
                ci.validate_result(2, state, snapshot, state['jobs'], started)

    @patch.dict(c.os.environ, {'GITHUB_STEP_SUMMARY': ''})
    def test_wrapper_converts_partial_to_success_and_writes_diagnostics(self):
        with TemporaryDirectory() as tmp:
            public, data = Path(tmp) / 'public', Path(tmp) / 'data'
            public.mkdir()
            state = fixture()
            c.export_snapshot(state, public)
            ci.prepare(public, data, '')
            args = SimpleNamespace(public_dir=public, data_dir=data, pages=5, days=14, refresh_hours=72, sources='fixture')
            def partial_run(definition, prior, args, budget):
                stamp = dt.datetime.now(c.TZ).replace(microsecond=0).isoformat()
                state['last_run_at'] = stamp
                state['sources']['fixture'].update(last_attempt_at=stamp, status='partial', errors=[{'reason': 'public pagination limit', 'url': 'https://example.com'}])
                for job in state['jobs'].values():
                    job['last_verified_at'] = stamp
                return state
            original_snapshot = (public/'jobs.json').read_bytes()
            with patch.object(ci, 'SOURCES', [state['sources']['fixture']]), patch.object(ci, 'run_source', side_effect=partial_run):
                ci.collect(args)
            report = ci.read_json(data / 'ci-report.json')
            self.assertFalse(report['deployment_blocked'])
            self.assertEqual(report['records'], 2)
            self.assertEqual((public/'jobs.json').read_bytes(), original_snapshot)
            self.assertEqual(ci.read_json(data/'state.json')['delta_version'], 1)


    def test_combine_states_prioritizes_raw_cache_over_online_snapshot_on_equal_timestamp(self):
        timestamp = '2026-09-14T12:00:00+08:00'
        git_state = {'jobs': {'j1': {'id': 'j1', 'title': 'Git版本', 'fingerprint': 'fp1', 'last_verified_at': timestamp}}, 'sources': {}, 'last_run_at': timestamp, 'priority': 1}
        raw_cache = {'jobs': {'j1': {'id': 'j1', 'title': '真实缓存版本', 'fingerprint': 'fp2', 'last_verified_at': timestamp}}, 'sources': {}, 'last_run_at': timestamp, 'priority': 2}
        online_snapshot = {'jobs': {'j1': {'id': 'j1', 'title': '线上有损快照', 'fingerprint': 'fp3', 'last_verified_at': timestamp}}, 'sources': {}, 'last_run_at': timestamp, 'priority': 1}
        
        combined = ci.combine_states(git_state, raw_cache, online_snapshot)
        self.assertEqual(combined['jobs']['j1']['title'], '真实缓存版本')
        self.assertEqual(combined['jobs']['j1']['fingerprint'], 'fp2')

    def test_snapshot_state_restores_primary_facts_and_copy_identities(self):
        with TemporaryDirectory() as tmp:
            public = Path(tmp)
            id1 = 'a1' + '0' * 18
            id2 = 'b2' + '0' * 18
            primary_job = {
                'id': id1, 'identity': 'offerjack:101', 'title': '科技公司校招',
                'company': '某科技集团', 'source_id': 'offerjack', 'source_name': 'OfferJack',
                'source_url': 'https://offerjack.example.com/1',
                'published_at': '2026-09-01', 'cities': ['北京'],
                'location_evidence': ['北京'], 'education': '硕士',
                'deadline': None, 'deadline_evidence': None, 'deadline_precision': None,
                'types': ['校招'], 'graduation_years': ['2026'],
                'positions': [{'name': '算法研发', 'city': '北京'}], 'position_count': 1,
                'sample_positions': ['算法研发'], 'majors': ['计算机'],
                'application_url': None,
                'body': '科技公司校招，工作地点北京。', 'excerpt': '科技公司校招',
                'last_verified_at': '2026-09-14T10:00:00+08:00',
                'fingerprint': 'fp_primary',
            }
            duplicate_job = {
                'id': id2, 'identity': 'upc:202', 'title': '科技公司校招（海大站）',
                'company': '某科技集团', 'source_id': 'upc', 'source_name': '中国石油大学',
                'source_url': 'https://upc.example.com/2',
                'published_at': '2026-09-02', 'cities': ['青岛'],
                'location_evidence': ['青岛'], 'education': '本科',
                'deadline': '2026-10-05', 'deadline_evidence': '10月5日截止', 'deadline_precision': 'day',
                'types': ['校招'], 'graduation_years': ['2026'],
                'positions': [{'name': '测试开发', 'city': '青岛'}], 'position_count': 1,
                'sample_positions': ['测试开发'], 'majors': ['自动化'],
                'application_url': 'https://apply2.example.com',
                'body': '科技公司校招，工作地点青岛。', 'excerpt': '科技公司校招',
                'last_verified_at': '2026-09-14T10:00:00+08:00',
                'fingerprint': 'fp_dup',
            }
            state = {
                'jobs': {id1: primary_job, id2: duplicate_job},
                'sources': {
                    'offerjack': {'id': 'offerjack', 'name': 'OfferJack', 'last_attempt_at': '2026-09-14T10:00:00+08:00'},
                    'upc': {'id': 'upc', 'name': '中国石油大学', 'last_attempt_at': '2026-09-14T10:00:00+08:00'}
                },
                'last_run_at': '2026-09-14T10:00:00+08:00'
            }
            snapshot = c.export_snapshot(state, public)
            self.assertEqual(len(snapshot['jobs']), 1)
            
            def load_asset(path):
                return ci.read_json(public / path.lstrip('/'))
            restored = ci.snapshot_state(snapshot, load_asset)
            self.assertEqual(len(restored['jobs']), 2)
            
            restored_p1 = restored['jobs'][id1]
            self.assertEqual(restored_p1['identity'], 'offerjack:101')
            self.assertEqual(restored_p1['cities'], ['北京'])
            self.assertEqual(len(restored_p1['positions']), 1)
            self.assertEqual(restored_p1['positions'][0]['name'], '算法研发')
            self.assertIsNone(restored_p1['deadline'])
            self.assertIsNone(restored_p1['application_url'])
            
            restored_p2 = restored['jobs'][id2]
            self.assertEqual(restored_p2['identity'], 'upc:202')
            self.assertEqual(restored_p2['cities'], ['青岛'])
            self.assertEqual(len(restored_p2['positions']), 1)
            self.assertEqual(restored_p2['positions'][0]['name'], '测试开发')

    def test_collect_script_accepts_all_ci_collect_arguments(self):
        cmd = [
            sys.executable,
            str(ci.ROOT / 'scripts/collect.py'),
            '--help',
        ]
        out = ci.subprocess.check_output(cmd, text=True)
        self.assertIn('--detail-timeout', out)
        self.assertIn('--detail-retries', out)
        self.assertIn('--detail-failure-limit', out)
        self.assertIn('--sdei-group', out)
        self.assertIn('--deep-scan', out)
        self.assertIn('--force-positions', out)

    def test_validate_result_accepts_deferred_and_blocked_sources(self):
        started = dt.datetime(2026, 9, 15, 10, 0, 0, tzinfo=c.TZ)
        stamp = started.isoformat()
        state = {
            'jobs': {'job1': {'id': 'job1', 'source_id': 'sdut-announcements'}},
            'sources': {
                'sdut-announcements': {
                    'id': 'sdut-announcements', 'name': '山东理工大学', 'status': 'deferred',
                    'last_attempt_at': stamp, 'parsed': 0, 'cached': 0, 'errors': []
                },
                'ujn-announcements': {
                    'id': 'ujn-announcements', 'name': '济南大学', 'status': 'blocked',
                    'last_attempt_at': stamp, 'parsed': 0, 'cached': 0, 'errors': []
                }
            },
            'last_run_at': stamp
        }
        snapshot = {
            'jobs': [{'id': 'job1'}],
            'generated_at': stamp
        }
        baseline_ids = ['job1']
        # Should not raise ValueError
        attempted = ci.validate_result(0, state, snapshot, baseline_ids, started)
        self.assertEqual(len(attempted), 2)

    def test_write_report_isolates_shard_sources_when_source_filter_specified(self):
        with TemporaryDirectory() as tmp:
            data = Path(tmp)
            state = {
                'jobs': {'j1': {'id': 'j1'}},
                'sources': {
                    's1': {'id': 's1', 'name': '源1', 'status': 'ok'},
                    's2': {'id': 's2', 'name': '源2', 'status': 'failed'},
                },
            }
            ci.write_report(data, 0, state, source_filter={'s1'}, pack_name='test-pack')
            report = ci.read_json(data / 'ci-report.json')
            self.assertEqual(len(report['sources']), 1)
            self.assertEqual(report['sources'][0]['id'], 's1')

    def test_ci_collect_shared_host_cooling(self):
        with TemporaryDirectory() as tmp:
            data = Path(tmp)
            blocked_time = (dt.datetime.now(c.TZ) + dt.timedelta(hours=2)).isoformat(timespec='seconds')
            baseline = {
                'jobs': {},
                'sources': {
                    'jobsdufe-announcements': {'id': 'jobsdufe-announcements', 'status': 'blocked', 'blocked_until': blocked_time}
                },
                'pending': {},
                'last_run_at': '2026-09-14T12:00:00+08:00'
            }
            ci.atomic_json(data / 'state.json', baseline)
            args = SimpleNamespace(
                data_dir=data, sources='ujn-announcements', source_pack='',
                pages=1, days=30, refresh_hours=24, shard_budget=100, source_budget=10
            )
            with patch.object(ci, 'run_source') as mock_run:
                ci.collect(args)
                mock_run.assert_not_called()
            state = ci.read_json(data / 'state.json')
            self.assertEqual(state['sources']['ujn-announcements']['status'], 'blocked')
            self.assertEqual(state['sources']['ujn-announcements']['blocked_until'], blocked_time)

    def test_ci_collect_positions_fallback_when_stale(self):
        with TemporaryDirectory() as tmp:
            data = Path(tmp)
            now = dt.datetime.now(c.TZ)
            recent_time = now.isoformat(timespec='seconds')
            stale_time = (now - dt.timedelta(days=5)).isoformat(timespec='seconds')
            baseline = {
                'jobs': {},
                'sources': {
                    'jobsdufe-announcements': {'id': 'jobsdufe-announcements', 'status': 'ok', 'last_success_at': recent_time},
                    'jobsdufe-positions': {'id': 'jobsdufe-positions', 'status': 'ok', 'last_success_at': stale_time}
                },
                'pending': {},
                'last_run_at': recent_time
            }
            ci.atomic_json(data / 'state.json', baseline)
            args = SimpleNamespace(
                data_dir=data, sources='jobsdufe-announcements,jobsdufe-positions', source_pack='',
                pages=1, days=30, refresh_hours=24, shard_budget=100, source_budget=10,
                deep_scan=False, force_positions=False
            )
            run_called = []
            def fake_run_source(defn, prior, a, budget):
                run_called.append(defn['id'])
                return {'jobs': {}, 'sources': {defn['id']: {'id': defn['id'], 'name': defn['name'], 'status': 'ok', 'last_success_at': recent_time,
                                                             'last_attempt_at': recent_time, 'pages': 1, 'discovered': 0,
                                                             'parsed': 0, 'cached': 0, 'probed': 0, 'detail_attempted': 0,
                                                             'detail_failed': 0, 'detail_skipped': 0, 'errors': [],
                                                             'coverage': 'ok'}},
                        'pending': {}, 'last_run_at': recent_time}
            with patch.object(ci, 'run_source', side_effect=fake_run_source), \
                 patch.object(c, 'get_active_sdei_schools', return_value=({'jobsdufe'}, 1)):
                ci.collect(args)
            # jobsdufe-positions should have been called because its last_success_at is stale (>72h)
            self.assertIn('jobsdufe-positions', run_called)

    def test_ci_collect_source_priority_and_last_list_read_at(self):
        with TemporaryDirectory() as tmp:
            data = Path(tmp)
            now = dt.datetime.now(c.TZ)
            past_iso = (now - dt.timedelta(days=2)).isoformat(timespec='seconds')
            baseline = {
                'jobs': {},
                'sources': {
                    'sdei-news': {'id': 'sdei-news', 'status': 'ok', 'last_list_read_at': past_iso},
                    'upc': {'id': 'upc', 'status': 'ok'}  # No last_list_read_at, should be prioritized!
                },
                'pending': {},
                'last_run_at': past_iso
            }
            ci.atomic_json(data / 'state.json', baseline)
            args = SimpleNamespace(
                data_dir=data, sources='sdei-news,upc', source_pack='',
                pages=1, days=30, refresh_hours=24, shard_budget=100, source_budget=10,
                deep_scan=False, force_positions=False
            )
            order = []
            def fake_run_source(defn, prior, a, budget):
                order.append(defn['id'])
                pages = 1 if defn['id'] == 'upc' else 0
                return {'jobs': {}, 'sources': {defn['id']: {'id': defn['id'], 'name': defn['name'], 'status': 'ok',
                                                             'pages': pages, 'errors': []}},
                        'pending': {}, 'last_run_at': past_iso}
            with patch.object(ci, 'run_source', side_effect=fake_run_source):
                ci.collect(args)

            # upc had no last_list_read_at, so it was prioritized over sdei-news
            self.assertEqual(order, ['upc', 'sdei-news'])
            state = ci.read_json(data / 'state.json')
            # upc read pages=1, so last_list_read_at is updated to now
            self.assertIn('last_list_read_at', state['sources']['upc'])
            # sdei-news had pages=0, so its last_list_read_at remains past_iso
            self.assertEqual(state['sources']['sdei-news']['last_list_read_at'], past_iso)

    def test_failed_list_backoff_preserves_execution_and_read_times(self):
        with TemporaryDirectory() as tmp:
            data = Path(tmp)
            stamp = (dt.datetime.now(c.TZ) - dt.timedelta(days=2)).isoformat(timespec='seconds')
            ci.atomic_json(data / 'state.json', {
                'jobs': {}, 'pending': {}, 'last_run_at': stamp,
                'sources': {'jobsdufe-announcements': {
                    'id': 'jobsdufe-announcements', 'last_list_read_at': stamp}}})
            args = SimpleNamespace(data_dir=data, sources='jobsdufe-announcements', source_pack='',
                pages=1, days=30, refresh_hours=24, shard_budget=100, source_budget=10,
                deep_scan=False, force_positions=False)
            def fail(defn, prior, a, budget):
                return dict(prior, sources={defn['id']: {
                    **defn, 'status': 'failed', 'pages': 0, 'errors': [{'reason': 'mock timeout'}]}})
            with patch.object(ci, 'run_source', side_effect=fail) as worker:
                ci.collect(args)
                ci.collect(args)
                failed = ci.read_json(data / 'state.json')['sources']['jobsdufe-announcements']
                self.assertEqual(failed['consecutive_list_failures'], 2)
                self.assertGreater(dt.datetime.fromisoformat(failed['source_retry_after']), dt.datetime.now(c.TZ))
                ci.collect(args)
                self.assertEqual(worker.call_count, 2)
            skipped = ci.read_json(data / 'state.json')['sources']['jobsdufe-announcements']
            self.assertEqual(skipped['status'], 'deferred')
            self.assertEqual(skipped['last_list_read_at'], stamp)
            self.assertEqual(skipped['last_execution_at'], failed['last_execution_at'])
            self.assertEqual(skipped['consecutive_list_failures'], 2)

    def test_failed_source_rotates_behind_unexecuted_sources(self):
        with TemporaryDirectory() as tmp:
            data = Path(tmp)
            now = dt.datetime.now(c.TZ)
            old_time = (now - dt.timedelta(days=3)).isoformat(timespec='seconds')
            recent_exec = (now - dt.timedelta(minutes=10)).isoformat(timespec='seconds')
            mid_read = (now - dt.timedelta(days=1)).isoformat(timespec='seconds')
            baseline = {
                'jobs': {},
                'sources': {
                    'sdei-news': {
                        'id': 'sdei-news', 'last_list_read_at': old_time,
                        'last_execution_at': recent_exec, 'consecutive_list_failures': 1
                    },
                    'upc': {
                        'id': 'upc', 'last_list_read_at': mid_read, 'consecutive_list_failures': 0
                    }
                },
                'pending': {},
                'last_run_at': recent_exec
            }
            ci.atomic_json(data / 'state.json', baseline)
            args = SimpleNamespace(
                data_dir=data, sources='sdei-news,upc', source_pack='',
                pages=1, days=30, refresh_hours=24, shard_budget=100, source_budget=10,
                deep_scan=False, force_positions=False
            )
            order = []
            def fake_run(defn, prior, a, budget):
                order.append(defn['id'])
                return dict(prior, sources={defn['id']: {**defn, 'status': 'ok', 'pages': 1, 'errors': []}})
            with patch.object(ci, 'run_source', side_effect=fake_run):
                ci.collect(args)
            self.assertEqual(order, ['upc', 'sdei-news'])

    def test_ci_collect_talks_priority_and_180s_budget_deferral(self):
        with TemporaryDirectory() as tmp:
            data = Path(tmp)
            now = dt.datetime.now(c.TZ).isoformat(timespec='seconds')
            baseline = {
                'jobs': {},
                'sources': {},
                'pending': {},
                'last_run_at': now
            }
            ci.atomic_json(data / 'state.json', baseline)
            talk_sources = [s for s in ci.SOURCES if s.get('channel') == 'talks'][:7]
            sources_str = ','.join(s['id'] for s in talk_sources) + ',jobsdufe-announcements'
            args = SimpleNamespace(
                data_dir=data, sources=sources_str, source_pack='',
                pages=1, days=30, refresh_hours=24, shard_budget=1500, source_budget=120,
                deep_scan=False, force_positions=False
            )
            executed = []
            fake_clock = [1000.0]
            def fake_time():
                return fake_clock[0]

            def fake_run_source(defn, prior, a, budget):
                executed.append(defn['id'])
                if defn.get('channel') == 'talks':
                    self.assertEqual(budget, 30.0)
                    fake_clock[0] += budget
                else:
                    self.assertEqual(budget, 120.0)
                return {'jobs': {}, 'sources': {defn['id']: {'id': defn['id'], 'name': defn['name'], 'status': 'ok',
                                                             'pages': 1, 'errors': []}},
                        'pending': {}, 'last_run_at': now}

            with patch.object(ci.time, 'monotonic', side_effect=fake_time), \
                 patch.object(ci.collector, 'get_active_sdei_schools', return_value=({s['school'] for s in talk_sources}, 0)), \
                 patch.object(ci, 'run_source', side_effect=fake_run_source):
                ci.collect(args)

            self.assertEqual(len(executed), 7)
            self.assertTrue(all(identifier.endswith('-talks') for identifier in executed[:6]))
            self.assertEqual(executed[-1], 'jobsdufe-announcements')
            self.assertEqual(fake_clock[0], 1180.0)

            state = ci.read_json(data / 'state.json')
            skipped = {s['id'] for s in talk_sources} - set(executed)
            self.assertEqual(len(skipped), 1)
            ujn_status = state['sources'][skipped.pop()]
            self.assertEqual(ujn_status['status'], 'deferred')
            self.assertIn('180秒预算', ujn_status['coverage'])
            self.assertEqual(ujn_status['errors'], [])


if __name__ == '__main__':
    unittest.main()

