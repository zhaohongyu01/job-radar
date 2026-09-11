import importlib.util
import unittest
from unittest.mock import patch
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('collect',ROOT/'scripts/collect.py')
c=importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)

class CollectionTests(unittest.TestCase):
    def test_split_deadline_and_application_fields_are_recovered(self):
        row=c.refine_facts({'title':'中信证券（山东）有限责任公司招聘','company':'', 'source_id':'sdu',
            'body':'招聘截止日期\n2027-04-30\n应聘网址\nhttp:// careers.citics.com\n简历投递邮箱\nzxzqsd@citics.com',
            'last_verified_at':'2026-09-10','source_url':'https://example.com/notice'})
        self.assertEqual(row['deadline'],'2027-04-30T23:59:59+08:00')
        self.assertEqual(row['application_url'],'http://careers.citics.com')
        self.assertEqual(row['emails'],['zxzqsd@citics.com'])
        self.assertEqual(row['last_verified_at'],'2026-09-10')
        self.assertIsNone(c.deadline('招聘截止日期\n发布日期\n2026-09-10')[0])
        self.assertIsNone(c.deadline('招聘截止日期\n2026-09-10\n报名截止：2026-10-01')[0])
        conflicted=c.refine_facts({'body':'招聘截止日期\n2026-09-10\n报名截止：2026-10-01','deadline':'2026-10-01T23:59:59+08:00'})
        self.assertIsNone(conflicted['deadline'])
        self.assertIsNone(c.deadline('报名时间：2026-09-10 开始')[0])

    def test_company_conflict_uses_declared_alias_without_losing_original(self):
        original={'title':'平安点创租赁2027届校园招聘','company':'中国建设银行股份有限公司四川省分行',
                  'source_id':'jobsdufe-announcements','body':'平安点创国际融资租赁有限公司(以下简称“平安点创租赁”) 于2026年成立。'}
        row=c.refine_facts(original)
        self.assertEqual(row['company'],'平安点创国际融资租赁有限公司')
        self.assertEqual(row['company_original'],original['company'])
        self.assertEqual(original['company'],'中国建设银行股份有限公司四川省分行')
        uncertain=c.refine_facts(dict(original,body='另一家企业的校园招聘公告。'))
        self.assertEqual(uncertain['company'],'')
        # Missing structured employer text in a specific position is not a conflict.
        position=c.refine_facts(dict(original,source_id='jobsdufe-positions',body='岗位职责：核对财务凭证'))
        self.assertEqual(position['company'],original['company'])
        verified=c.refine_facts({'title':'某银行天津分行2027校园招聘','company':'某银行股份有限公司天津分行', 'source_id':'nankai', 'body':'某银行股份有限公司天津分行招聘公告'})
        self.assertEqual(verified['company'],'某银行股份有限公司天津分行')

    def test_application_requires_unambiguous_explicit_http_link(self):
        row={'title':'招聘','body':'投递：https://jobs.example.com/apply#campus','source_url':'https://example.com'}
        self.assertEqual(c.refine_facts(row)['application_url'],'https://jobs.example.com/apply#campus')
        self.assertFalse(c.refine_facts(dict(row,body='投递：javascript:alert(1)')).get('application_url'))
        self.assertFalse(c.refine_facts(dict(row,body='投递：https://a.example.com\n投递：https://b.example.com')).get('application_url'))

    def test_later_page_failure_retains_discoveries_and_export_is_consistent(self):
        source=next(s for s in c.SOURCES if s['id']=='jobsdufe-positions')
        item={'url':'https://example.com/retained','title':'甲企业财务招聘',
              'published_at':'2026-09-10','inline_html':'<div id="zoom">工作地点：济南<br>税收学专业</div>'}
        with TemporaryDirectory() as temp:
            args=SimpleNamespace(data_dir=temp,public_dir=temp,sources=source['id'],pages=2,days=180,
                                 refresh_hours=0,nankai_area=0,target_city='',offerjack_pages=1)
            with patch.object(c,'sdei_list',side_effect=[([item],2),RuntimeError('network failure')]):
                self.assertEqual(c.run(args),2)
            snapshot=json.loads((Path(temp)/'jobs.json').read_text(encoding='utf8'))
            self.assertEqual(len(snapshot['jobs']),1)
            self.assertEqual(snapshot['sources'][0]['status'],'partial')
            row=snapshot['jobs'][0]
            full=json.loads((Path(temp)/snapshot['detail_shards'][row['id'][:2]].lstrip('/')).read_text(encoding='utf8'))['jobs'][row['id']]
            search=json.loads((Path(temp)/snapshot['search_url'].lstrip('/')).read_text(encoding='utf8'))['jobs']
            self.assertEqual(full['body'],search[row['id']])
            self.assertIn('税收学',search[row['id']])
            state=json.loads((Path(temp)/'state.json').read_text(encoding='utf8'))
            again=c.export_snapshot(state,Path(temp))
            self.assertEqual(again['detail_shards'],snapshot['detail_shards'])
            self.assertEqual(again['generated_at'],snapshot['generated_at'])

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

    def test_public_supplement_exposes_authentication_limit_without_fallback(self):
        payload=json.dumps({'code':401,'msg':'未登录用户只能查看第一页数据','data':None},ensure_ascii=False)
        with patch.object(c,'fetch',return_value=payload):
            with self.assertRaises(c.PublicPaginationLimit):
                c.offerjack_list(2)

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
        one={'id':'a','title':'财务招聘','company':'同一企业','kind':'具体岗位','cities':['济南'],'body':'岗位职责：审核凭证，进行成本分析。'*10,'first_seen_at':'2026-09-01','source_name':'高校甲','source_url':'https://a.example/job'}
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
        self.assertIsNone(c.safe_url('//mailto:邮箱投递：@基于公告附件内的各岗位邮箱完成投递', 'https://example.com'))

    def test_location_country_classification_keeps_mixed_and_excludes_overseas_only(self):
        self.assertEqual(c.domestic_status(['工作地点：山东省、海外'], []), 'mixed')
        self.assertEqual(c.domestic_status(['工作地点：国外'], []), 'overseas')
        self.assertEqual(c.domestic_status(['工作地点：上海、海外'], ['上海']), 'mixed')
        self.assertEqual(c.domestic_status(['工作地点：全国'], []), 'domestic')

    def test_dedup_keeps_company_boundaries_and_direct_application_link(self):
        one={'id':'a','title':'招聘公告','company':'甲公司','kind':'招聘公告','cities':['济南'],'body':'统一正文内容'*20,'first_seen_at':'2026-09-01','source_name':'高校甲','source_url':'https://a.example/job','application_url':None}
        two=dict(one,id='b',company='甲公司',source_name='高校乙',source_url='https://b.example/job',application_url='https://b.example/app')
        other=dict(two,id='c',company='乙公司',source_name='高校丙',source_url='https://c.example/job')
        result=c.deduplicate([one,two,other])
        self.assertEqual(len(c.deduplicate([dict(one,company=''),dict(two,company='')])),2)
        self.assertEqual(len(result),2)
        self.assertEqual(result[0]['application_url'],'https://b.example/app')
        self.assertEqual(result[0]['duplicate_sources'][0]['application_url'],'https://b.example/app')

    def test_public_summary_is_lightweight_but_searchable(self):
        row={'id':'a','title':'财务招聘','company':'甲公司','body':'完整公告正文'*500,
             'attachments':[{'title':'附件','url':'https://a.example/file'}],
             'links':[{'title':'链接','url':'https://a.example/link'}],
             'excerpt':'完整公告正文','directions':['财务 / 经济'],'education':'本科',
             'location_evidence':['工作地点：济南']}
        summary=c.public_summary(row)
        self.assertNotIn('body',summary)
        self.assertNotIn('attachments',summary)
        self.assertNotIn('links',summary)
        self.assertIn('财务 / 经济',summary['directions'])
        self.assertNotIn('search_text',summary)

    def test_offerjack_run_rotates_public_city_queries_after_auth_limit(self):
        calls=[]
        def fake_list(page, city=''):
            calls.append((page,city))
            if page > 1:
                raise c.PublicPaginationLimit('需要登录后查看更多')
            row={'id':'row-'+(city or 'all'),'enterpriseName':'企业'+(city or '全国'),
                 'workLocation':'济南','recruitmentBatch':'秋招','graduationYear':'2027届',
                 'position':'财务管理','enterpriseNature':'民营企业','industry':'金融',
                 'announcementLink':'https://source.example/'+(city or 'all'),
                 'deliveryAddress':'https://apply.example/'+(city or 'all'),
                 'deadline':'尽快投递','updateTime':'2026-09-10'}
            values=''.join('<p>工作地点：'+row['workLocation']+'</p><p>招聘岗位：财务管理</p>')
            return [{'identity':'offerjack:'+row['id'],'url':row['announcementLink'],
                     'title':row['enterpriseName']+' · 秋招招聘','published_at':'2026-09-10',
                     'inline_html':'<div id="zoom">'+values+'</div>','structured':row}],2
        with TemporaryDirectory() as temp:
            args=SimpleNamespace(data_dir=temp,public_dir=temp,sources='offerjack',pages=1,days=180,
                                 refresh_hours=0,nankai_area=0,target_city='',offerjack_pages=2)
            with patch.object(c,'offerjack_list',side_effect=fake_list):
                code=c.run(args)
            self.assertEqual(code,2)
            self.assertEqual(calls[0],(1,''))
            self.assertEqual(calls[1],(2,''))
            self.assertTrue(all(page==1 for page,_ in calls[2:]))
            self.assertEqual(len(calls),len(c.CITIES)+2)
            snapshot=json.loads((Path(temp)/'jobs.json').read_text(encoding='utf8'))
            self.assertEqual(snapshot['schema_version'],2)
            self.assertEqual(snapshot['sources'][0]['status'],'partial')

if __name__=='__main__': unittest.main()
