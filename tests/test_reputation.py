import base64
import copy
import hashlib
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import collect_reputation as collector
import publish_reputation as publisher
import prepare_reputation_jobs as queue_input

AT = '2026-10-29T04:00:00Z'
EPOCH = 1793246400
CONFIG = dict(schema_version=1, min_interval_seconds=0, timeout_seconds=1, max_response_bytes=100000,
              cache_hours=48, user_agent='JobRadarReputation/test', enterprises=[dict(id=i, expected_names=['示例科技']) for i in range(1, 8)])
DELIVERY = dict(repository='test/repo', branch='reputation-data', directory='public/reputation')


def document(identifier=1, content=None):
    content = content or dict(id=1234, authorId=123, title='实习体验', content='我在这家公司实习期间，工作地点：济南。岗位：研发。部门：测试。福利很好。很少加班。',
                              createTime=EPOCH * 1000, ipLocation='北京', editTime=(EPOCH + 100) * 1000)
    state = dict(store=dict(enterprise=dict(enterpriseInfoNP=dict(companyId=identifier, companyName='示例科技有限公司', simpleName='示例科技'))),
                 app={'random-app-key': {'postList': [dict(contentData=content, evaluateSubscript=dict(companyId=identifier))]}})
    return '<script>window.__INITIAL_STATE__=' + json.dumps(state, ensure_ascii=False) + ';window.DO_NOT_RUN=true;</script>'


class FakePublicClient:
    def __init__(self, config, deadline):
        self.deadline, self.requests, self.config = deadline, 0, config

    def robots(self):
        self.requests += 1

    def get(self, path):
        self.requests += 1
        identifier = int(path.split('/')[2])
        if identifier in self.config.get('blocked', []):
            return '<html>Not available</html>'
        return document(identifier)


class FakeGitHub:
    def __init__(self, old=None):
        self.old, self.calls = old, []

    def request(self, path, method='GET', body=None, missing=False):
        self.calls.append((path, method, body))
        if method == 'GET':
            if path.startswith('/git/ref/heads/'):
                return dict(object=dict(sha='old-commit')) if self.old else None
            if path == '/git/commits/old-commit':
                return dict(tree=dict(sha='old-tree'))
            if path.startswith('/git/trees/'):
                return dict(tree=[dict(type='blob', path='public/reputation/' + row['file']) for row in self.old['entities']])
            if path.startswith('/contents/'):
                return dict(content=base64.b64encode(json.dumps(self.old).encode()).decode())
            raise AssertionError(path)
        return dict(sha='new-' + ('tree' if path == '/git/trees' else 'commit'))


def assets(directory, identifier='1', collected=AT):
    raw = json.dumps(dict(id='nowcoder:' + identifier, records=[]), separators=(',', ':')).encode()
    filename = 'entity-' + identifier + '-' + hashlib.sha256(raw).hexdigest()[:20] + '.json'
    (directory / filename).write_bytes(raw)
    index = dict(schema_version=1, policy_version=1, generated_at=AT,
                 entities=[dict(id='nowcoder:' + identifier, collected_at=collected, file=filename)])
    (directory / 'index.json').write_text(json.dumps(index), encoding='utf-8')
    return index


class ReputationParsingTests(unittest.TestCase):
    def test_public_json_is_decoded_without_executing_scripts_or_changing_original_dates(self):
        result = collector.parse_page(document(), 1, 'discussion', AT, EPOCH + 1000)
        row = result['records'][0]
        self.assertEqual(row['kind'], 'experience')
        self.assertEqual(row['published_at'], AT)
        self.assertEqual(row['city'], '济南')
        self.assertEqual(row['role'], '研发')
        self.assertEqual(row['department'], '测试')
        self.assertNotIn('authorId', row)
        self.assertEqual(len(row['contributor']), 24)
        self.assertLessEqual(len(row['excerpt']), 81)
        with self.assertRaises(ValueError):
            collector.extract_state('<script>window.__INITIAL_STATE__=executeCode()</script>')

    def test_other_company_recommendations_and_wrong_enterprise_pages_cannot_attach_to_company(self):
        raw = document().replace('"companyId": 1}', '"companyId": 2}')
        self.assertEqual(collector.parse_page(raw, 1, 'discussion', AT, EPOCH + 100)['records'], [])
        with self.assertRaisesRegex(ValueError, 'identity_mismatch'):
            collector.parse_page(document(2), 1, 'discussion', AT)

    def test_questions_interviews_and_promotions_are_not_scored_as_employee_experience(self):
        question = dict(id=1, title='想入职，待遇怎么样？', content='我在考虑入职，福利很好吗？', createTime=EPOCH)
        row = collector.parse_page(document(content=question), 1, 'discussion', AT, EPOCH + 100)['records'][0]
        self.assertEqual(row['kind'], 'question')
        self.assertEqual(row['signals'], [])
        row = collector.parse_page(document(), 1, 'interview', AT, EPOCH + 100)['records'][0]
        self.assertEqual(row['kind'], 'interview')
        self.assertEqual(row['signals'], [])
        promo = dict(question, title='内推招聘开启', content='我在公司工作，福利很好，扫码加入群')
        self.assertEqual(collector.parse_page(document(content=promo), 1, 'discussion', AT, EPOCH + 100)['records'], [])

    def test_negation_rumor_question_and_mixed_sentiment_are_left_unscored(self):
        for text in ['没有拖欠工资', '并非氛围很差', '听说福利很好', '这里双休吗？', '福利很好但是工资偏低', '不是不加班']:
            with self.subTest(text=text):
                self.assertEqual(collector.signals_for(text), [])
        self.assertEqual(collector.signals_for('福利很好。每天加班。')[0]['polarity'], 1)
        self.assertEqual(collector.signals_for('福利很好。每天加班。')[1]['polarity'], -1)

    def test_missing_work_city_does_not_use_ip_location_and_contacts_are_removed(self):
        row = dict(id=1, title='实习体验', content='我在这里实习，联系13812345678 test@example.com。福利很好', ipLocation='北京', createTime=EPOCH)
        evidence = collector.parse_page(document(content=row), 1, 'discussion', AT, EPOCH + 100)['records'][0]
        self.assertIsNone(evidence['city'])
        self.assertNotIn('@', json.dumps(evidence))
        self.assertNotIn('13812345678', json.dumps(evidence))
        for value in [None, True, '2026-10-29', EPOCH + 10000, float('inf')]:
            self.assertIsNone(collector.source_time(value, EPOCH))

    def test_work_city_uses_shared_nationwide_registry_and_does_not_pick_one_city_from_multiple(self):
        content = dict(id=1, title='实习体验', content='我在这里工作了两年，工作地点：乌鲁木齐市。', createTime=EPOCH)
        row = collector.parse_page(document(content=content), 1, 'discussion', AT, EPOCH + 100)['records'][0]
        self.assertEqual(row['city'], '乌鲁木齐')
        content['content'] = '我在这里工作了两年，工作地点：北京/上海。'
        self.assertIsNone(collector.parse_page(document(content=content), 1, 'discussion', AT, EPOCH + 100)['records'][0]['city'])


class ReputationCollectionTests(unittest.TestCase):
    def collect(self, state=None, config=None, budget=30):
        with TemporaryDirectory() as directory, patch.object(collector, 'PublicClient', FakePublicClient):
            path = Path(directory) / 'state.json'
            result, report = collector.collect(config or CONFIG, state or {}, path, budget, 30)
            if path.exists():
                self.assertEqual(json.loads(path.read_text(encoding='utf-8')), result)
            return result, report

    def test_checkpoints_cache_and_ttl_rotation_do_not_refresh_source_dates(self):
        state, first = self.collect()
        self.assertEqual(first['successes'], 7)
        old = copy.deepcopy(state['enterprises']['1']['channels'])
        state, second = self.collect(state)
        self.assertEqual(second['cached'], 7)
        self.assertEqual(second['requests'], 1)
        self.assertEqual(state['enterprises']['1']['channels'], old)

    def test_source_outage_keeps_previous_evidence_and_cools_after_three_consecutive_failures(self):
        state, _ = self.collect()
        old = copy.deepcopy(state['enterprises']['1']['channels'])
        for entry in state['enterprises'].values():
            entry['last_success_epoch'] = 1
        failed, report = self.collect(state, dict(CONFIG, blocked=list(range(1, 8))))
        self.assertEqual(report['attempted'], 2)  # Three consecutive failed pages across independent channels.
        self.assertEqual(failed['enterprises']['1']['channels'], old)
        self.assertGreater(failed['enterprises']['1']['retry_after'], collector.time.time())
        self.assertIn('source_cooling', report['errors'][-1]['reason'])

    def test_robots_failure_and_exhausted_deadline_make_no_source_page_requests(self):
        with patch.object(FakePublicClient, 'robots', side_effect=ValueError('robots_denied')):
            _, report = self.collect()
        self.assertEqual(report['attempted'], 0)
        self.assertEqual(report['requests'], 0)
        _, report = self.collect(budget=0)
        self.assertEqual(report['attempted'], 0)
        client = collector.PublicClient(CONFIG, collector.time.monotonic() + 10)
        with self.assertRaisesRegex(ValueError, 'unapproved'):
            client.get('/search?query=company')
        with self.assertRaisesRegex(ValueError, 'robots_denied'):
            client.get('/enterprise/1/discussion')
        self.assertEqual(client.requests, 0)

    def test_public_queue_priority_changes_order_without_adding_unknown_endpoints(self):
        config = copy.deepcopy(CONFIG)
        config['enterprises'][-1]['priority'] = 100
        with TemporaryDirectory() as directory, patch.object(collector, 'PublicClient', FakePublicClient):
            state, report = collector.collect(config, {}, Path(directory) / 'state.json', 30, 1)
        self.assertEqual(list(state['enterprises']), ['7'])
        self.assertEqual(report['attempted'], 1)


class ReputationPublishingTests(unittest.TestCase):
    def test_first_publish_creates_only_dedicated_data_ref_and_never_touches_main(self):
        with TemporaryDirectory() as directory:
            directory = Path(directory)
            assets(directory)
            api = FakeGitHub()
            result = publisher.publish(directory, DELIVERY, api)
            self.assertTrue(result['published'])
            ref = [body for path, method, body in api.calls if path == '/git/refs'][0]
            self.assertEqual(ref['ref'], 'refs/heads/reputation-data')
            updates = [body for path, method, body in api.calls if path == '/git/trees'][0]['tree']
            self.assertTrue(all(row['path'].startswith('public/reputation/') for row in updates))
            self.assertFalse(any('/main' in path for path, _, _ in api.calls))

    def test_cold_cache_preserves_previously_published_entities_and_atomically_updates_ref(self):
        with TemporaryDirectory() as directory:
            directory = Path(directory)
            old = assets(directory, '1', '2026-10-28T00:00:00Z')
            assets(directory, '2')
            api = FakeGitHub(old)
            result = publisher.publish(directory, DELIVERY, api)
            self.assertEqual(result['enterprises'], 2)
            self.assertEqual(result['with_content'], 0)  # These publication fixtures carry no evidence.
            self.assertEqual(result['scored'], 0)
            updates = [body for path, method, body in api.calls if path == '/git/trees'][0]['tree']
            merged = json.loads(updates[0]['content'])
            self.assertEqual(merged['entities'][0]['collected_at'], '2026-10-28T00:00:00Z')
            self.assertEqual(api.calls[-1][1], 'PATCH')
            self.assertIs(api.calls[-1][2]['force'], False)

    def test_corrupt_assets_wrong_branch_and_wrong_directory_fail_before_any_network_write(self):
        with TemporaryDirectory() as directory:
            directory = Path(directory)
            data = assets(directory)
            api = FakeGitHub()
            for changes in [dict(branch='main'), dict(directory='public'), dict(repository='../bad')]:
                with self.assertRaises(ValueError):
                    publisher.publish(directory, dict(DELIVERY, **changes), api)
            (directory / data['entities'][0]['file']).write_text('corrupted')
            with self.assertRaisesRegex(ValueError, 'checksum'):
                publisher.publish(directory, DELIVERY, api)
            self.assertEqual(api.calls, [])

    def test_merge_compares_instants_not_timestamp_lexical_order(self):
        old = dict(schema_version=1, policy_version=1, generated_at=AT,
                   entities=[dict(id='nowcoder:1', collected_at='2026-10-29T08:00:00+08:00')])
        incoming = dict(old, entities=[dict(id='nowcoder:1', collected_at='2026-10-28T23:00:00Z')])
        self.assertEqual(publisher.merge_index(old, incoming)['entities'], old['entities'])

    def test_schema2_provider_assets_can_publish_and_legacy_updates_cannot_downgrade_the_data_schema(self):
        with TemporaryDirectory() as directory:
            directory = Path(directory)
            raw = json.dumps(dict(id='maimai:123', records=[])).encode()
            filename = 'entity-maimai-123-' + hashlib.sha256(raw).hexdigest()[:20] + '.json'
            (directory / filename).write_bytes(raw)
            index = dict(schema_version=2, policy_version=1, generated_at=AT,
                         entities=[dict(id='maimai:123', collected_at=AT, file=filename)])
            (directory / 'index.json').write_text(json.dumps(index))
            self.assertTrue(publisher.publish(directory, DELIVERY, FakeGitHub())['published'])
            self.assertEqual(publisher.merge_index(index, dict(index, schema_version=1, entities=[]))['schema_version'], 2)


class PublicQueueInputTests(unittest.TestCase):
    def test_queue_input_checks_asset_hash_and_does_not_fetch_full_details(self):
        raw = json.dumps(dict(jobs=[dict(id='job-1', company='示例有限公司', cities=[])]), separators=(',', ':')).encode()
        file = '/job-assets/index-' + hashlib.sha256(raw).hexdigest()[:20] + '.json'
        snapshot = dict(generated_at=AT, index_count=1, index_shards=[file], jobs=[], details_url='/do-not-fetch.json')
        calls = []

        class Response:
            def __init__(self, url, content):
                self.url, self.content = url, content
            def __enter__(self):
                return self
            def __exit__(self, *_):
                return False
            def read(self, _):
                return self.content

        def fetch(request, timeout):
            calls.append(request.full_url)
            return Response(request.full_url, json.dumps(snapshot).encode() if request.full_url.endswith('/jobs.json') else raw)

        with patch.object(queue_input.urllib.request, 'urlopen', side_effect=fetch):
            self.assertEqual(queue_input.download('https://example.test')['jobs'][0]['id'], 'job-1')
        self.assertEqual(len(calls), 2)
        snapshot['index_shards'] = ['/job-assets/index-' + '0' * 20 + '.json']
        with patch.object(queue_input.urllib.request, 'urlopen', side_effect=fetch), self.assertRaisesRegex(ValueError, 'checksum'):
            queue_input.download('https://example.test')


if __name__ == '__main__':
    unittest.main()
