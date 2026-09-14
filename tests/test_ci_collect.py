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
            args = SimpleNamespace(public_dir=public, data_dir=data, pages=5, days=14, refresh_hours=72)
            def partial_run(command, check):
                stamp = dt.datetime.now(c.TZ).replace(microsecond=0).isoformat()
                state['last_run_at'] = stamp
                state['sources']['fixture'].update(last_attempt_at=stamp, status='partial', errors=[{'reason': 'public pagination limit', 'url': 'https://example.com'}])
                c.atomic_json(data / 'state.json', state)
                c.export_snapshot(state, public)
                return SimpleNamespace(returncode=2)
            with patch.object(ci.subprocess, 'run', side_effect=partial_run):
                ci.collect(args)
            report = ci.read_json(data / 'ci-report.json')
            self.assertFalse(report['deployment_blocked'])
            self.assertEqual(report['records'], 2)
            with patch.object(ci.subprocess, 'run', return_value=SimpleNamespace(returncode=1)):
                with self.assertRaisesRegex(ValueError, 'crashed'):
                    ci.collect(args)
            self.assertTrue(ci.read_json(data / 'ci-report.json')['deployment_blocked'])


if __name__ == '__main__':
    unittest.main()
