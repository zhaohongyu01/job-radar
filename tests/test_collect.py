import importlib.util
import unittest
from unittest.mock import patch
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('collect',ROOT/'scripts/collect.py')
c=importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)

class CollectionTests(unittest.TestCase):
    def test_public_supplement_preserves_application_fragment_and_provenance(self):
        payload=(ROOT/'tests/fixtures/offerjack-sample.json').read_text(encoding='utf8')
        with patch.object(c,'fetch',return_value=payload):
            items,pages=c.offerjack_list(1,'济南')
        self.assertEqual(pages,920)
        source=next(s for s in c.SOURCES if s['id']=='offerjack')
        job=c.parse_detail(items[0]['inline_html'],items[0],source)
        self.assertEqual(job['provenance'],'第三方线索')
        self.assertEqual(job['types'],['校招'])
        self.assertEqual(job['graduation_years'],['2027'])
        self.assertIn('#/?anchorName=',job['application_url'])
        self.assertIn('上海',job['cities'])
        self.assertNotIn('济南',job['cities'])

    def test_region_pagination_does_not_silently_stop_at_page_one(self):
        _,pages=c.nankai_list('<a href="/correcruit/index/sel_area/15/p/35.html">35</a>','https://career.nankai.edu.cn')
        self.assertEqual(pages,35)
        _,pages=c.nankai_list('<a href="/correcruit/index/p/18.html">18</a>','https://career.nankai.edu.cn')
        self.assertEqual(pages,18)

    def test_public_projection_fixes_old_labels_without_claiming_new_fetch(self):
        old={'source_id':'sdu','title':'招聘','body':'工作地点：北京\n总部：济南','cities':['北京','济南'], 'location_evidence':['工作地点：北京\n总部：济南'], 'last_verified_at':'2026-09-01'}
        row=c.public_record(old)
        self.assertEqual(row['cities'],['北京'])
        self.assertEqual(row['last_verified_at'],'2026-09-01')
    def test_public_position_api_preserves_role_location_and_deadline(self):
        source=next(s for s in c.SOURCES if s['id']=='jobsdufe-positions')
        payload=(ROOT/'tests/fixtures/jobsdufe-jobs-sample.json').read_text(encoding='utf8')
        with patch.object(c,'fetch',return_value=payload):
            items,total=c.sdei_list(source,1)
        self.assertEqual(total,22)
        job=c.parse_detail(items[0]['inline_html'],items[0],source)
        self.assertEqual(job['kind'],'具体岗位')
        self.assertEqual(job['cities'],['青岛'])
        self.assertEqual(job['education'],'本科生毕业')
        self.assertEqual(job['deadline'],'2026-12-31T23:59:59+08:00')
        self.assertIn('/edit1/20449',job['source_url'])
        self.assertNotIn('济南',job['cities'])

    def test_announcement_api_image_and_list_date_survive(self):
        source=next(s for s in c.SOURCES if s['id']=='jobsdufe-announcements')
        payload=(ROOT/'tests/fixtures/sdufe-list-sample.json').read_text(encoding='utf8')
        with patch.object(c,'fetch',return_value=payload):
            items,_=c.sdei_list(source,1)
        job=c.parse_detail(items[0]['inline_html'],items[0],source)
        self.assertEqual(job['published_at'],'2026-09-09')
        self.assertEqual(job['cities'],[])
        self.assertTrue(job['attachments'][0]['url'].endswith('.jpg'))

    def test_dedup_keeps_different_locations_and_all_original_urls(self):
        one={'id':'a','title':'财务招聘','kind':'具体岗位','cities':['济南'],'body':'岗位职责：审核凭证，进行成本分析。'*10,'first_seen_at':'2026-09-01','source_name':'高校甲','source_url':'https://a.example/job'}
        two=dict(one,id='b',source_name='高校乙',source_url='https://b.example/job')
        other=dict(two,id='c',cities=['青岛'])
        result=c.deduplicate([one,two,other])
        self.assertEqual(len(result),2)
        self.assertEqual(result[0]['duplicate_sources'],[{'title':'高校乙','url':'https://b.example/job'}])

    def test_secondary_metadata_never_copies_editorial_or_claims_primary(self):
        source=next(s for s in c.SOURCES if s['id']=='wondercv')
        html='<h1 class="hero-title">某企业2027届校园招聘</h1><div class="side-stat"><span>工作地点</span><strong>济南</strong></div><div class="side-stat"><span>学历要求</span><strong>本科</strong></div><section id="tips">不应复制的编辑建议</section>'
        job=c.parse_detail(html,{'url':'https://www.wondercv.com/xiaozhao/example/','published_at':'2026-09-10'},source)
        self.assertEqual(job['cities'],['济南'])
        self.assertEqual(job['provenance'],'第三方线索')
        self.assertEqual(job['date_label'],'收录')
        self.assertNotIn('编辑建议',job['body'])

    def test_sdu_list_has_one_title_per_announcement_and_real_dates(self):
        html=(ROOT/'tests/fixtures/sdu-list.html').read_text(encoding='utf-8')
        items,next_page=c.sdu_list(html,c.SOURCES[2]['url'])
        self.assertEqual(len(items),20)
        self.assertEqual(len({i['url'] for i in items}),20)
        self.assertEqual(items[0]['published_at'],'2026-05-13')
        self.assertIn('山东社会科学院',items[0]['title'])
        self.assertIn('currentPage=1',next_page)

    def test_sdu_detail_finance_and_actual_work_location(self):
        html=(ROOT/'tests/fixtures/sdu-detail.html').read_text(encoding='utf-8')
        job=c.parse_detail(html,{'url':'https://jobcareer.sdu.edu.cn/example','title':'fallback'},c.SOURCES[2])
        self.assertEqual(job['published_at'],'2026-09-09')
        self.assertIn('威海',job['cities'])
        self.assertIn('财务 / 经济',job['directions'])
        self.assertEqual(job['graduation_years'],['2027'])

    def test_official_list_templates_keep_full_titles_and_external_links(self):
        for name,source in [('hrss',c.SOURCES[3]),('gzw',c.SOURCES[4])]:
            html=(ROOT/f'tests/fixtures/{name}-list.html').read_text(encoding='utf-8')
            items,_=c.gov_list(html,source['url'])
            self.assertGreater(len(items),0)
            self.assertTrue(all(i['published_at'] and i['url'] for i in items))
            self.assertNotIn('...',items[0]['title'])

    def test_real_campus_announcement(self):
        html=(ROOT/'tests/fixtures/nankai-detail.html').read_text(encoding='utf-8')
        job=c.parse_detail(html,{'url':'https://career.nankai.edu.cn/correcruit/content/id/117451.html','title':'fallback'},c.SOURCES[0])
        self.assertIn('济南',job['cities'])
        self.assertEqual(job['graduation_years'],['2027'])
        self.assertEqual(job['application_url'],'http://career.inspur.com/campus2027/index.html')
        self.assertIsNone(job['deadline'])
        self.assertEqual(job['published_at'],'2026-09-01')

    def test_real_email_deadline(self):
        html=(ROOT/'tests/fixtures/jinan-detail.html').read_text(encoding='utf-8')
        job=c.parse_detail(html,{'url':'https://www.jinan.gov.cn/example.html','title':'fallback'},c.SOURCES[1])
        self.assertEqual(job['emails'],['jynyfzjt@163.com'])
        self.assertEqual(job['deadline'],'2026-09-14T17:00:00+08:00')
        self.assertTrue(job['qr_attachment'])

    def test_start_date_is_not_deadline(self):
        self.assertIsNone(c.deadline('报名时间：2026年9月1日开始')[0])
        self.assertEqual(c.deadline('报名时间：2026年9月1日至2026年9月14日')[0],'2026-09-14T23:59:59+08:00')

    def test_headquarters_does_not_become_job_location(self):
        html='<div class="title1">招聘</div><div class="zpnr"><p>公司总部位于济南，发展前景广阔，欢迎加入我们的团队。</p><p>工作地点：北京</p></div>'
        job=c.parse_detail(html,{'url':'https://example.com/job','title':'招聘'},c.SOURCES[0])
        self.assertEqual(job['cities'],['北京'])
        self.assertIn('济南',job['possible_cities'])
        html='<div class="zpnr"><p>工作地点：北京</p><p>公司总部位于济南，联系方式见下方。</p></div>'
        job=c.parse_detail(html,{'url':'https://example.com/job','title':'招聘'},c.SOURCES[0])
        self.assertEqual(job['cities'],['北京'])

    def test_failure_preserves_records_and_success_timestamp(self):
        job={'id':'one','title':'原岗位'}
        previous,_=c.merge({},[job],'2026-09-01T00:00:00Z')
        after,counts=c.merge(previous,[],'2026-09-02T00:00:00Z')
        self.assertEqual(after,previous)
        self.assertEqual(counts['new'],0)

    def test_repeated_fetch_is_not_new_and_changes_keep_identity(self):
        job={'id':'one','title':'原岗位'}
        first,_=c.merge({},[job],'2026-09-01T00:00:00Z')
        second,counts=c.merge(first,[job],'2026-09-02T00:00:00Z')
        self.assertEqual(counts,{'new':0,'changed':0,'unchanged':1})
        third,counts=c.merge(second,[dict(job,title='延期公告')],'2026-09-03T00:00:00Z')
        self.assertEqual(counts['changed'],1)
        self.assertEqual(third['one']['first_seen_at'],first['one']['first_seen_at'])
        self.assertEqual(third['one']['revision'],2)

    def test_non_http_links_rejected(self):
        self.assertIsNone(c.safe_url('javascript:alert(1)','https://example.com'))
        self.assertIsNone(c.safe_url('data:text/html,hello','https://example.com'))

if __name__=='__main__': unittest.main()
