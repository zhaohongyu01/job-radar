import sys, json, io, copy, time
from pathlib import Path
from unittest.mock import patch
from tempfile import TemporaryDirectory
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import collect_reputation as c
from tests.test_reputation import document, AT, CONFIG, FakePublicClient

class QualityTests(unittest.TestCase):
    def test_topic_discovery_uses_only_same_enterprise_public_experience_tabs(self):
        html = '<a href="/enterprise/1/discussion?evaluateSubscriptTab=12">公司福利(5)</a><a href="/enterprise/1/discussion?evaluateSubscriptTab=13">工作强度(8)</a>'
        self.assertEqual(c.discussion_topic_path(html, '1'), '/enterprise/1/discussion?evaluateSubscriptTab=13')
        self.assertIsNone(c.discussion_topic_path(html, '2'))
        self.assertIsNone(c.discussion_topic_path('<a href="https://evil.test/enterprise/1/discussion?evaluateSubscriptTab=1">工作强度</a>', '1'))
        self.assertIsNone(c.discussion_topic_path(html.replace('evaluateSubscriptTab=', 'private='), '1'))
        prefixed = '<a href="/enterprise/1/discussion?evaluateSubscriptTab=13">示例科技工作强度 172人发布</a>'
        self.assertEqual(c.discussion_topic_path(prefixed, '1', ['示例科技']), '/enterprise/1/discussion?evaluateSubscriptTab=13')
        self.assertIsNone(c.discussion_topic_path(prefixed, '1', ['另一公司']))
        self.assertIsNone(c.discussion_topic_path(prefixed, '2', ['示例科技']))
    def test_exclusion_diagnostics_account_for_public_rows_without_exporting_raw_text(self):
        page = c.parse_page(document(), 1, 'discussion', AT)
        self.assertEqual(sum(page['exclusion_counts'].values()), page['excluded'])
        self.assertNotIn('author', str(page['exclusion_counts']))
    def test_discovery_diversity_does_not_turn_branch_names_into_company_aliases(self):
        rows = [{'name': name} for name in ['示例保险股份有限公司山东分公司', '示例保险股份有限公司河北分公司', '第二科技有限公司', '第三公司']]
        candidates = c.discovery_candidates(rows, {}, 200000)
        self.assertEqual(candidates, [rows[0], rows[2], rows[3]])
        self.assertEqual(c.discovery_candidates(rows, {rows[0]['name']: {'attempt_epoch': 190000}}, 200000), rows[2:])
        self.assertEqual(c.discovery_candidates(rows, {rows[0]['name']: {'attempt_epoch': 1}}, 200000), candidates)
        self.assertEqual(rows[0]['name'], '示例保险股份有限公司山东分公司')

    def test_attribution_requires_explicit_target_and_quarantines_transitions(self):
        self.assertEqual(c.attribution_for('体验', '我在示例科技工作了两年。', ['示例科技']), 'target')
        for text in ['我在这里工作了两年。', '示例科技不错，我在其他企业工作了两年。', '从前公司离职后入职慢脚了。', '相比前公司，示例科技福利很好。']:
            self.assertEqual(c.attribution_for('体验', text, ['示例科技']), 'uncertain')
        row=c.parse_page(document(),1,'discussion',AT)['records'][0]
        self.assertEqual(row['attribution'],'uncertain'); self.assertEqual(row['signals'],[])

    def test_repeated_pagination_does_not_manufacture_extra_records(self):
        with TemporaryDirectory() as tmp, patch.object(c,'PublicClient',FakePublicClient):
            state,report=c.collect(dict(CONFIG,max_pages=2),{},Path(tmp)/'state.json',30,1)
            page=state['enterprises']['1']['channels']['discussion']
            self.assertEqual(page['pagination_status'],'repeated_or_empty')
            self.assertEqual(len(page['records']),1)

    def test_discovery_validates_exact_names_and_does_not_accept_search_titles_as_identity(self):
        rss=b'<rss><channel><item><link>https://www.nowcoder.com/enterprise/999/discussion</link></item><item><link>https://evil.example/enterprise/2/discussion</link></item></channel></rss>'
        config=dict(CONFIG, enterprises=[],discovery_limit=1,_needs_mapping=[dict(name='示例科技')])
        client=FakePublicClient(config,time.monotonic()+60)
        state={}
        response=io.BytesIO(rss); response.url='https://www.bing.com/search'
        with patch.object(c.urllib.request,'urlopen',return_value=response):
            result=c.discover_enterprises(config,state,client)
        self.assertEqual(result[0]['status'],'verified')
        self.assertEqual(config['enterprises'][0]['id'],999)
        self.assertEqual(set(state['discovered_enterprises']),{'999'})

    def test_legacy_excerpts_are_retained_without_recertifying_employer_or_dates(self):
        old=c.parse_page(document(),1,'discussion',AT)
        old['records'][0].update(kind='experience',signals=[dict(dimension='pay',polarity=1,quote='福利很好')])
        state=dict(normalizer_version=2,enterprises={'1':dict(channels={'discussion':old})})
        with TemporaryDirectory() as tmp,patch.object(c,'PublicClient',FakePublicClient):
            migrated,_=c.collect(CONFIG,state,Path(tmp)/'state.json',30,0)
        row=migrated['enterprises']['1']['channels']['discussion']['records'][0]
        self.assertEqual(row['attribution'],'uncertain');self.assertEqual(row['signals'],[])
        self.assertEqual(row['collected_at'],AT)

if __name__=='__main__': unittest.main()
