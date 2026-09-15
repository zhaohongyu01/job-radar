import datetime as dt
import hashlib
import io
import json
from email.message import Message
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import urllib.error
from urllib.parse import urlsplit, parse_qs

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'scripts'))
sys.path.insert(0, str(ROOT/'tests'))
import collect as c
import ci_collect as ci
import collector_runtime as runtime
import parse_positions as positions
import stage_public
from test_ci_collect import fixture


class Response(io.BytesIO):
    headers = Message()


@patch.dict(c.os.environ, {'GITHUB_STEP_SUMMARY':''})
class ReliabilityTests(unittest.TestCase):
    def test_sdu_query_and_legacy_ids_survive_repair_refresh_and_restore(self):
        items, _ = c.sdu_list((ROOT/'tests/fixtures/sdu-list.html').read_text(encoding='utf-8'),
                             next(s['url'] for s in c.SOURCES if s['id']=='sdu'))
        url = items[0]['url']
        self.assertEqual(urlsplit(url).path, '/eweb/jygl/index.so')
        self.assertEqual(parse_qs(urlsplit(url).query)['modcode'], ['jygl_zpxxck'])
        baseline = fixture()
        old_rows = list(baseline['jobs'].values())
        old_rows[0].update(source_id='sdu', source_url=url.replace('index.so?', 'index.so'), identity='legacy-identity')
        old_rows[1].update(source_id='sdu', source_url=url, identity=url)
        fixed = c.repair_sdu_urls(baseline['jobs'])
        fresh = dict(old_rows[1], body='最新完整的财务岗位正文', source_url=url)
        merged, _ = c.merge(fixed, [fresh], '2026-09-15T10:00:00+08:00')
        self.assertEqual(set(merged), set(baseline['jobs']))
        self.assertTrue(all(j['source_url']==url and j['body']==fresh['body'] for j in merged.values()))
        self.assertEqual(merged[old_rows[0]['id']]['identity'], 'legacy-identity')
        with TemporaryDirectory() as temp:
            public = Path(temp)
            state = dict(baseline, jobs=merged)
            snapshot = c.export_snapshot(state, public)
            self.assertEqual(len(snapshot['jobs']), 1)
            restored = ci.snapshot_state(snapshot, lambda path:ci.read_json(public/path.lstrip('/')))
            self.assertEqual(set(restored['jobs']), set(merged))
            self.assertTrue(all(j['body']==fresh['body'] for j in restored['jobs'].values()))

    def test_retry_only_transient_errors_and_respect_retry_after(self):
        permanent = urllib.error.HTTPError('https://test.invalid',404,'Not Found',{},None)
        with patch.object(c, 'pace'), patch.object(c.OPENER,'open',side_effect=permanent) as opener:
            with self.assertRaises(urllib.error.HTTPError):
                c.fetch('https://test.invalid', retries=5)
            self.assertEqual(opener.call_count, 1)
        temporary = urllib.error.HTTPError('https://test.invalid',503,'Unavailable',{},None)
        with patch.object(c,'pace'), patch.object(runtime.time,'sleep'), \
             patch.object(c.OPENER,'open',side_effect=[temporary,temporary,Response(b'ok')]) as opener:
            self.assertEqual(c.fetch('https://test.invalid', retries=2), 'ok')
            self.assertEqual(opener.call_count, 3)
        limited = urllib.error.HTTPError('https://test.invalid',429,'Rate limited',{'Retry-After':'120'},None)
        self.assertEqual(runtime.retry_delay(limited,0),120)
        with patch.object(runtime.time,'sleep') as sleeper:
            self.assertFalse(runtime.retry_request('https://rate.invalid', limited, 0, 2))
            sleeper.assert_not_called()

    def test_total_read_budget_stops_progressing_but_slow_stream(self):
        class SlowStream:
            def read(self, count):
                time.sleep(0.025)
                return b'x'
        started = time.monotonic()
        with runtime.request_budget(0.06), self.assertRaises(TimeoutError):
            runtime.bounded_read(SlowStream(), 10000, 1)
        self.assertLess(time.monotonic()-started, 0.5)

    def test_source_process_wall_clock_budget_is_enforced(self):
        started = time.monotonic()
        code, timed_out = ci.run_process([sys.executable,'-c','import time; time.sleep(30)'], 0.15)
        self.assertTrue(timed_out)
        self.assertNotEqual(code,0)
        self.assertLess(time.monotonic()-started,5)

    def test_attachment_timeout_preserves_original_link_and_deferred_status(self):
        attachment = {'url':'https://example.com/jobs.pdf','title':'招聘岗位表'}
        with patch.object(positions.subprocess,'run',side_effect=subprocess.TimeoutExpired('worker',1)):
            result = positions.extract_all_positions('', '', [attachment], lambda url:b'pdf')
        self.assertEqual(result,[])
        self.assertEqual(attachment['parse_status'],'deferred')
        self.assertEqual(attachment['url'],'https://example.com/jobs.pdf')

    def test_complete_inventory_requires_spaced_rechecks_and_restores_reappeared_job(self):
        jobs = fixture()['jobs']
        source_id = 'fixture'
        a, b = list(jobs)
        first = c.reconcile_listings(jobs, source_id, {a,b}, True, '2026-09-14T06:00:00+08:00')
        partial = c.reconcile_listings(first, source_id, {b}, False, '2026-09-14T18:00:00+08:00')
        self.assertEqual(partial[a]['listing_status'],'active')
        missing = c.reconcile_listings(partial, source_id, {b}, True, '2026-09-14T18:00:00+08:00')
        self.assertEqual(missing[a]['listing_status'],'unconfirmed')
        rerun = c.reconcile_listings(missing, source_id, {b}, True, '2026-09-14T18:10:00+08:00')
        self.assertEqual(rerun[a]['listing_missing_count'],1)
        removed = c.reconcile_listings(rerun, source_id, {b}, True, '2026-09-15T06:00:00+08:00')
        self.assertEqual(removed[a]['listing_status'],'withdrawn')
        reappeared = c.reconcile_listings(removed, source_id, {a,b}, True, '2026-09-15T18:00:00+08:00')
        self.assertEqual(reappeared[a]['listing_status'],'active')
        self.assertEqual(set(reappeared),set(jobs))

    def test_recover_journal_after_timeout_preserves_details_and_pending_discoveries(self):
        with TemporaryDirectory() as temp:
            directory = Path(temp)
            prior = fixture()
            c.atomic_json(directory/'state.json',prior)
            definition = prior['sources']['fixture']
            job = dict(next(iter(prior['jobs'].values())), body='Recovered complete detail')
            pending = {'url':'https://example.com/3','title':'新岗位','published_at':'2026-09-15'}
            c.atomic_json(directory/'checkpoint.json', {'source':definition,'pending':[pending],
                            'run_at':'2026-09-15T08:00:00+08:00'})
            (directory/'progress.jsonl').write_text(json.dumps({'job':job,'url':job['source_url'],'verified':True})+'\n{"truncated":',encoding='utf-8')
            result = ci.recover_source(directory, definition, prior, '2026-09-15T08:00:00+08:00', -1, True)
            self.assertEqual(result['jobs'][job['id']]['body'],'Recovered complete detail')
            self.assertIn(c.item_id(pending), result['jobs'])
            self.assertEqual(result['pending']['fixture'],[pending])
            self.assertEqual(result['sources']['fixture']['parsed'],1)
            self.assertEqual(result['sources']['fixture']['status'],'partial')

    def test_prepare_network_failure_defers_live_guard_but_keeps_intact_cache(self):
        with TemporaryDirectory() as temp:
            public, data = Path(temp)/'public', Path(temp)/'data'
            state = fixture()
            c.export_snapshot(state, public)
            c.atomic_json(data/'state.json',state)
            with patch.object(ci,'download_json',side_effect=TimeoutError('outage')):
                ci.prepare(public,data,'https://example.com')
            self.assertEqual(set(ci.read_json(data/'state.json')['jobs']),set(state['jobs']))
            self.assertFalse(ci.read_json(data/'ci-baseline.json')['live_verified'])

    def test_prepare_corrupt_cache_falls_back_to_checked_in_snapshot(self):
        with TemporaryDirectory() as temp:
            public, data = Path(temp)/'public', Path(temp)/'data'
            state = fixture()
            c.export_snapshot(state, public)
            data.mkdir(parents=True)
            (data/'state.json').write_text('{"jobs":', encoding='utf-8')
            ci.prepare(public, data, '')
            restored = ci.read_json(data/'state.json')
            self.assertEqual(set(restored['jobs']), set(state['jobs']))
            self.assertTrue(ci.read_json(data/'ci-baseline.json')['live_verified'])

    def test_matching_manifest_uses_checked_raw_cache_without_loading_details(self):
        with TemporaryDirectory() as temp:
            public, data = Path(temp)/'public', Path(temp)/'data'
            state = fixture()
            c.export_snapshot(state, public)
            c.atomic_json(data/'state.json',state)
            metadata = ci.read_json(public/'snapshot-manifest.json')
            receipt = dict(metadata,state_sha256=hashlib.sha256((data/'state.json').read_bytes()).hexdigest())
            c.atomic_json(data/'published-baseline.json',receipt)
            with patch.object(ci,'download_json',return_value=json.dumps(metadata).encode()) as download, \
                 patch.object(ci,'snapshot_state',side_effect=AssertionError('unnecessary detail hydration')):
                ci.prepare(public,data,'https://example.com')
            download.assert_called_once_with('https://example.com/snapshot-manifest.json')
            self.assertTrue(ci.read_json(data/'ci-baseline.json')['live_verified'])

    def create_shard(self, root, fresh=True):
        public, data, shards = (root/p for p in ('public','data','shards'))
        state = fixture()
        c.export_snapshot(state,public)
        c.atomic_json(data/'state.json',state)
        if fresh:
            stamp = '2026-09-15T12:00:00+08:00'
            shard = {'jobs':{},'sources':{},'pending':{},'last_run_at':stamp,
                     'delta_version':1,'base_generation':state['last_run_at'],'source_pack':'finance'}
            for identifier in c.source_pack_ids('finance'):
                shard['sources'][identifier] = dict(id=identifier,name=identifier,status='ok',
                    last_attempt_at=stamp,last_success_at=stamp,parsed=0,cached=0,errors=[])
            c.atomic_json(shards/'collector-shard-finance/state.json',shard)
        return public,data,shards,state

    def test_healthy_shard_can_publish_with_missing_peer_and_keeps_history(self):
        with TemporaryDirectory() as temp:
            public,data,shards,before = self.create_shard(Path(temp))
            with patch.dict(c.os.environ,{'JOB_RADAR_SCHEDULE_ENABLED':'true'}):
                ci.merge_shards(public,data,shards,expected_shards=['finance','large-enterprises'])
            result = ci.read_json(data/'state.json')
            self.assertEqual(set(result['jobs']),set(before['jobs']))
            self.assertTrue(ci.read_json(public/'jobs.json')['schedule_enabled'])
            self.assertTrue(all(result['sources'][key]['status']=='failed' for key in c.source_pack_ids('large-enterprises')))

    def test_no_usable_shards_cannot_publish(self):
        with TemporaryDirectory() as temp:
            public,data,shards,_ = self.create_shard(Path(temp),fresh=False)
            old = (public/'jobs.json').read_bytes()
            with self.assertRaisesRegex(ValueError,'No source'):
                ci.merge_shards(public,data,shards,expected_shards=['finance'])
            self.assertEqual((public/'jobs.json').read_bytes(),old)

    def test_still_unreachable_live_baseline_cannot_be_overwritten(self):
        with TemporaryDirectory() as temp:
            public,data,shards,state = self.create_shard(Path(temp))
            c.atomic_json(data/'ci-baseline.json',{'site':'https://example.com','live_verified':False})
            old = (public/'jobs.json').read_bytes()
            with patch.object(ci,'download_json',side_effect=TimeoutError('still offline')), self.assertRaises(TimeoutError):
                ci.merge_shards(public,data,shards,expected_shards=['finance'])
            self.assertEqual((public/'jobs.json').read_bytes(),old)

    def test_wrong_generation_delta_is_rejected(self):
        with TemporaryDirectory() as temp:
            public,data,shards,_ = self.create_shard(Path(temp))
            path = shards/'collector-shard-finance/state.json'
            shard = ci.read_json(path)
            shard['base_generation']='2000-01-01T00:00:00+08:00'
            c.atomic_json(path,shard)
            with self.assertRaisesRegex(ValueError,'different baseline'):
                ci.merge_shards(public,data,shards,expected_shards=['finance'])

    def test_light_index_keeps_filter_fields_and_full_snapshot_restores_facts(self):
        with TemporaryDirectory() as temp:
            public = Path(temp)
            state = fixture()
            snapshot = c.export_snapshot(state,public)
            summary = snapshot['jobs'][0]
            self.assertNotIn('facts',summary['duplicate_sources'][0])
            self.assertIn('location_evidence',summary)
            self.assertEqual(summary['excerpt'],next(iter(state['jobs'].values()))['excerpt'])
            self.assertNotIn('fingerprint',summary)
            restored = ci.snapshot_state(snapshot,lambda path:ci.read_json(public/path.lstrip('/')))
            self.assertTrue(all(j['body'] for j in restored['jobs'].values()))

    def test_staged_data_replaces_old_snapshot_without_rebuilding_code(self):
        with TemporaryDirectory() as temp:
            root = Path(temp)
            public, dist = root/'public', root/'dist'
            c.export_snapshot(fixture(),public)
            c.atomic_json(dist/'server/wrangler.json',{'assets':{'directory':'../client'}})
            (dist/'server/index.js').write_text('unchanged worker',encoding='utf-8')
            stage_public.stage(public,dist)
            self.assertEqual((public/'jobs.json').read_bytes(),(dist/'client/jobs.json').read_bytes())
            self.assertEqual((dist/'server/index.js').read_text(),'unchanged worker')
            self.assertTrue((dist/'client/snapshot-manifest.json').exists())

    def test_shared_school_host_has_one_source_pack(self):
        owners = {pack for pack,ids in c.SOURCE_PACKS.items()
                  for source in c.SOURCES if source['id'] in ids and source.get('adapter')=='sdei'}
        self.assertEqual(owners,{'universities-b'})


if __name__ == '__main__':
    unittest.main()
