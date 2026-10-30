import sys, json, io, copy, time
from pathlib import Path
from unittest.mock import patch
from tempfile import TemporaryDirectory
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import collect_reputation as c
from tests.test_reputation import document, AT, CONFIG, FakePublicClient

class QualityTests(unittest.TestCase):
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
