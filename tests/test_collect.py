import importlib.util
import unittest
from unittest.mock import patch
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import urllib.error

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('collect',ROOT/'scripts/collect.py')
c=importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)

class CollectionTests(unittest.TestCase):
    def test_ci_source_packs_cover_every_registered_source(self):
        packed = {source_id for pack in c.SOURCE_PACKS.values() for source_id in pack}
        self.assertEqual(packed, {source['id'] for source in c.SOURCES})
        self.assertIn('boc-recruitment', c.source_pack_ids('finance'))
        self.assertIn('jinan-employment', c.source_pack_ids('regional-official'))
        self.assertIn('taiping-campus', c.source_pack_ids('finance'))
        self.assertIn('haier-social', c.source_pack_ids('large-enterprises'))
        self.assertIn('hisense-campus', c.source_pack_ids('large-enterprises'))
        self.assertGreaterEqual(len(c.source_pack_ids('finance')), 1)
        with self.assertRaisesRegex(ValueError, 'unknown source pack'):
            c.source_pack_ids('missing-pack')

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

    def test_detail_circuit_breaker_skips_blocked_source_without_losing_list_items(self):
        source=next(s for s in c.SOURCES if s['id']=='jobsdufe-positions')
        items=[{
            'url':f'https://example.com/detail/{idx}',
            'title':f'示例企业{idx} 财务招聘',
            'published_at':'2026-09-10',
        } for idx in range(8)]
        with TemporaryDirectory() as temp:
            args=SimpleNamespace(data_dir=temp,public_dir=temp,sources=source['id'],pages=1,days=180,
                                 refresh_hours=0,nankai_area=0,target_city='',offerjack_pages=1,
                                 detail_timeout=1,detail_retries=0,detail_failure_limit=3)
            with patch.object(c,'sdei_list',return_value=(items,1)), \
                 patch.object(c,'fetch',side_effect=TimeoutError('runner cannot reach detail host')):
                self.assertEqual(c.run(args),2)
            snapshot=json.loads((Path(temp)/'jobs.json').read_text(encoding='utf8'))
            self.assertEqual(len(snapshot['jobs']),8)
            status=snapshot['sources'][0]
            self.assertEqual(status['status'],'partial')
            self.assertGreaterEqual(status['detail_failed'],3)
            self.assertGreater(status['detail_skipped'],0)
            self.assertTrue(any('单源熔断' in error['reason'] for error in status['errors']))

    def test_detail_circuit_breaker_stops_repeated_new_page_404s(self):
        source=next(s for s in c.SOURCES if s['id']=='jobsdufe-positions')
        items=[{
            'url':f'https://example.com/detail/{idx}',
            'title':f'示例企业{idx} 财务招聘',
            'published_at':'2026-09-10',
        } for idx in range(8)]
        with TemporaryDirectory() as temp:
            args=SimpleNamespace(data_dir=temp,public_dir=temp,sources=source['id'],pages=1,days=180,
                                 refresh_hours=0,nankai_area=0,target_city='',offerjack_pages=1,
                                 detail_timeout=1,detail_retries=0,detail_failure_limit=3)
            error_404 = urllib.error.HTTPError('https://example.com', 404, 'Not Found', {}, None)
            with patch.object(c,'sdei_list',return_value=(items,1)), \
                 patch.object(c,'fetch',side_effect=error_404):
                self.assertEqual(c.run(args),2)
            snapshot=json.loads((Path(temp)/'jobs.json').read_text(encoding='utf8'))
            self.assertEqual(len(snapshot['jobs']),8)
            status=snapshot['sources'][0]
            self.assertGreater(status.get('detail_skipped', 0), 0)
            self.assertTrue(any('单源熔断' in error['reason'] for error in status.get('errors', [])))

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

    def test_province_recruitment_feed_parses_public_json_pages(self):
        payload=json.dumps({
            'total': 2,
            'totalPage': 3,
            'rows': json.dumps([
                {'id': 207402, 'title': '济南市事业单位公开招聘公告',
                 'urlRead': '/html/2026/09/07/207402.html', 'pubdate': '2026-09-07'},
                {'id': 207403, 'title': '某银行2027校园招聘',
                 'urlRead': '/html/2026/09/08/207403.html', 'pubdate': '2026-09-08'},
            ], ensure_ascii=False),
        }, ensure_ascii=False)
        with patch.object(c, 'fetch', return_value=payload):
            items, pages=c.sdei_news_list(1)
        self.assertEqual(pages, 3)
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]['url'], 'https://html.gxjy.sdei.edu.cn/html/2026/09/07/207402.html')
        self.assertEqual(items[1]['identity'], 'sdei-news:207403')

    def test_official_bank_list_filters_result_notices_and_reads_pagination(self):
        html='''
        <div class="list"><ul>
          <li><a href="./202609/t20260903_25689311.html" title="中国银行2027年度校园招聘公告">中国银行2027年度校园招聘公告</a><span>[ 2026-09-03 ]</span></li>
          <li><a href="./202604/t20260415_25661369.html" title="中国银行2026年度拟接收境内院校应届毕业生情况公示">结果名单</a><span>[ 2026-04-15 ]</span></li>
        </ul></div>
        <script>createPageHTML(18, 0, "index", "html");</script>
        '''
        source=next(s for s in c.SOURCES if s['id']=='boc-recruitment')
        items,pages=c.official_bank_list(html,source['url'],source)
        self.assertEqual(pages,18)
        self.assertEqual(len(items),1)
        self.assertEqual(items[0]['published_at'],'2026-09-03')
        self.assertTrue(items[0]['url'].endswith('/202609/t20260903_25689311.html'))

    def test_official_bank_detail_uses_editor_body_and_source_type(self):
        source=next(s for s in c.SOURCES if s['id']=='psbc-social')
        html='''
        <html><head>
          <meta name="ArticleTitle" content="邮储银行总行社会招聘公告">
          <meta name="PubDate" content="2026-06-15 09:00:00">
        </head><body><div class="view trs_editor_view">
          <p>工作地点：济南</p><p>报名截止时间：2026年10月1日</p>
          <p>投递网址：https://example.com/apply</p>
        </div></body></html>
        '''
        job=c.parse_detail(html,{'url':'https://www.psbc.com/job.html','title':'fallback'},source)
        self.assertEqual(job['company'],'中国邮政储蓄银行')
        self.assertIn('社招',job['types'])
        self.assertEqual(job['cities'],['济南'])
        self.assertEqual(job['application_url'],'https://example.com/apply')

    def test_jinan_cms_adapter_reads_dynamic_government_list(self):
        source=next(s for s in c.SOURCES if s['id']=='hrss')
        fragment='''<div class="page-content"><li>
          <a title="济南市事业单位2026年公开招聘工作人员公告 2026年09月14日"
             href="https://example.gov.cn/job/1">招聘公告...</a>
          <span>[2026-09-14]</span></li></div>
          <div class="pagination" rows="15" count="31"></div>'''
        payload=json.dumps({'success':True,'data':{'html':fragment}},ensure_ascii=False)
        with patch.object(c,'fetch',return_value=payload) as mocked:
            items,pages=c.jinan_cms_list(source,2)
        self.assertEqual(pages,3)
        self.assertEqual(items[0]['title'],'济南市事业单位2026年公开招聘工作人员公告')
        self.assertEqual(items[0]['published_at'],'2026-09-14')
        self.assertIn('pageNo%22%3A+2',mocked.call_args.args[0])

    def test_jinan_employment_feed_keeps_jobs_and_filters_result_notices(self):
        source=next(s for s in c.SOURCES if s['id']=='jinan-employment')
        fragment='''<div class="page-content"><ul>
          <li><a title="2026年济南市专场网络招聘会 2026年09月14日" href="/job/1">招聘会</a><span>[2026-09-14]</span></li>
          <li><a title="某单位公开招聘拟聘人员公示 2026年09月13日" href="/job/2">公示</a><span>[2026-09-13]</span></li>
          <li><a title="全市就业工作会议召开 2026年09月12日" href="/news/3">工作动态</a><span>[2026-09-12]</span></li>
        </ul></div><div class="pagination" rows="15" count="3"></div>'''
        payload=json.dumps({'success':True,'data':{'html':fragment}},ensure_ascii=False)
        with patch.object(c,'fetch',return_value=payload):
            items,pages=c.jinan_cms_list(source,1)
        self.assertEqual(pages,1)
        self.assertEqual([item['title'] for item in items],['2026年济南市专场网络招聘会'])

    def test_zhiye_official_jobs_preserve_location_requirements_and_apply_url(self):
        source=next(s for s in c.SOURCES if s['id']=='taiping-campus')
        payload={
            'Code':200,'Count':51,'Data':[{
                'JobAdId':561286063,'JobAdName':'2027届财务管理管培生','Status':1,
                'Org':'太平人寿山东分公司','Category':'校园招聘','LocNames':['山东省','济南市'],
                'PostDate':'2026-09-10T16:52:27','EndTime':'2026-10-31T23:59:59',
                'Degree':'本科','Salary':'面议','ClassificationOne':'财务管理类',
                'ClassificationTwo':'太平人寿山东分公司','Duty':'负责预算与财务分析。',
                'Require':'经济、金融、会计相关专业。',
            },{
                'JobAdId':561286064,'JobAdName':'长期招聘岗位','Status':1,
                'Org':'太平人寿山东分公司','LocNames':['山东省','济南市'],
                'PostDate':'2026-08-01T10:00:00','EndTime':'2222-02-02T00:00:00',
            }]
        }
        with patch.object(c,'fetch_json_post',return_value=payload) as mocked:
            items,pages=c.zhiye_jobs_list(source,1,50)
        self.assertEqual(pages,2)
        self.assertEqual(mocked.call_args.args[1]['PageIndex'],0)
        job=c.parse_detail(items[0]['inline_html'],items[0],source)
        self.assertEqual(job['company'],'太平人寿山东分公司')
        self.assertEqual(job['cities'],['济南'])
        self.assertEqual(job['education'],'本科')
        self.assertEqual(job['graduation_years'],['2027'])
        self.assertIn('保险',job['sectors'])
        self.assertEqual(job['deadline'],'2026-10-31T23:59:59+08:00')
        self.assertIn('/campus/detail?jobAdId=561286063',job['application_url'])
        sentinel_job=c.parse_detail(items[1]['inline_html'],items[1],source)
        self.assertIsNone(sentinel_job['deadline'])

    def test_haier_social_and_campus_public_apis_create_searchable_jobs(self):
        social_payload=json.dumps({'status':1,'data':{'count':101,'list':[{
            'id':'10231020','job_name':'财务分析专员','update_time':'2026-09-14 18:23:56',
            'location':'山东省-济南市','func_desc':'财务类','xwinfo':'海尔智家财务平台',
            'education_required_label':'本科及以上','work_experience_label':'3年以上',
            'salary_label':'薪资面议',
        }]}},ensure_ascii=False)
        with patch.object(c,'fetch',return_value=social_payload):
            social_items,social_pages=c.haier_jobs_list(1,100)
        self.assertEqual(social_pages,2)
        social_source=next(s for s in c.SOURCES if s['id']=='haier-social')
        social_job=c.parse_detail(social_items[0]['inline_html'],social_items[0],social_source)
        self.assertEqual(social_job['cities'],['济南'])
        self.assertIn('社招',social_job['types'])
        self.assertEqual(social_job['education'],'本科及以上')

        campus_source=dict(next(s for s in c.SOURCES if s['id']=='haier-campus'),activity_ids=['68'])
        campus_payload=json.dumps({'status':1,'data':{'count':1,
            'activity':{'name':'海尔集团2027校园招聘'},'list':[{
                'id':'59','name':'人力资源管理','fun_name':'职能类',
                'department':'海尔智家','addr':'青岛市',
                'click_url':'/client/campus/deliverfirst/id/68/fid/12/rid/59.html',
            }]}},ensure_ascii=False)
        with patch.object(c,'fetch',return_value=campus_payload):
            campus_items,campus_pages=c.haier_campus_list(campus_source,1)
        self.assertEqual(campus_pages,1)
        campus_job=c.parse_detail(campus_items[0]['inline_html'],campus_items[0],campus_source)
        self.assertEqual(campus_job['cities'],['青岛'])
        self.assertEqual(campus_job['graduation_years'],['2027'])
        self.assertIn('校招',campus_job['types'])

    def test_old_only_source_is_successful_inside_recent_window(self):
        source=next(s for s in c.SOURCES if s['id']=='psbc-social')
        html='''<ul><li><span>2020-01-01</span>
          <a href="./202001/t20200101_1.html" title="邮储银行2020年社会招聘公告">旧招聘公告</a></li></ul>'''
        with TemporaryDirectory() as temp, patch.object(c, 'fetch', return_value=html):
            args=SimpleNamespace(data_dir=temp,public_dir=temp,sources=source['id'],pages=1,days=30,
                                 refresh_hours=0,nankai_area=0,target_city='',offerjack_pages=1,
                                 probe_budget=0,detail_timeout=1,detail_retries=0,detail_failure_limit=2)
            self.assertEqual(c.run(args),0)
            state=json.loads((Path(temp)/'state.json').read_text(encoding='utf8'))
            self.assertEqual(state['sources'][source['id']]['status'],'ok')

    def test_active_enterprise_listing_is_retained_outside_history_window(self):
        source=next(s for s in c.SOURCES if s['id']=='haier-social')
        item={
            'identity':'haier-social:old-active','url':'https://maker.haier.net/client/job/detail/id/old-active',
            'application_url':'https://maker.haier.net/client/job/detail/id/old-active',
            'title':'财务分析专员','company':'海尔集团','published_at':'2025-01-01',
            'inline_html':'<div id="zoom"><p>岗位名称：财务分析专员</p><p>工作地点：济南市</p></div>',
            'structured':{'companyName':'海尔集团'},'kind':'具体岗位','is_active_listing':True,
        }
        with TemporaryDirectory() as temp, patch.object(c,'haier_jobs_list',return_value=([item],1)):
            args=SimpleNamespace(data_dir=temp,public_dir=temp,sources=source['id'],pages=1,days=30,
                                 refresh_hours=0,nankai_area=0,target_city='',offerjack_pages=1,
                                 probe_budget=0,detail_timeout=1,detail_retries=0,detail_failure_limit=2)
            self.assertEqual(c.run(args),0)
            state=json.loads((Path(temp)/'state.json').read_text(encoding='utf8'))
            self.assertEqual(len(state['jobs']),1)
            self.assertEqual(next(iter(state['jobs'].values()))['cities'],['济南'])

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
        self.assertEqual(result[0]['duplicate_sources'][0]['url'], 'https://b.example/job')
        self.assertEqual(result[0]['duplicate_sources'][0]['title'], '高校乙')

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
        for name in ['hrss','gzw']:
            source=next(s for s in c.SOURCES if s['id']==name)
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
             'location_evidence':['工作地点：济南'],
             'duplicate_sources':[{'title':'高校乙','url':'https://b.example'}]}
        summary=c.public_summary(row)
        self.assertNotIn('body',summary)
        self.assertNotIn('attachments',summary)
        self.assertNotIn('links',summary)
        self.assertIn('财务 / 经济',summary['directions'])
        self.assertNotIn('search_text',summary)
        self.assertIn('duplicate_sources',summary)

    def test_cross_channel_campus_recruitment_merges_without_duplicates(self):
        sdu_job = {
            'id': 'sdu_1',
            'title': '浪潮集团2027届校园招聘简章',
            'company': '浪潮集团有限公司',
            'kind': '招聘公告',
            'types': ['校招'],
            'graduation_years': ['2027'],
            'cities': ['济南'],
            'location_evidence': ['工作地点：济南'],
            'emails': ['hr@inspur.com'],
            'body': '浪潮集团2027届校园招聘启动！'*20,
            'source_name': '山东大学就业信息网',
            'source_url': 'https://jobcareer.sdu.edu.cn/view/1',
            'provenance': '公开原始来源',
            'first_seen_at': '2026-09-01',
        }
        nankai_job = {
            'id': 'nankai_2',
            'title': '浪潮集团2027届校园招聘',
            'company': '浪潮集团',
            'kind': '招聘公告',
            'types': ['校招'],
            'graduation_years': ['2027'],
            'cities': ['天津'],
            'location_evidence': ['工作地点：天津'],
            'body': '浪潮集团2027校园招聘，工作地点济南、天津。'*15,
            'source_name': '南开大学就业网',
            'source_url': 'https://career.nankai.edu.cn/view/2',
            'provenance': '公开原始来源',
            'first_seen_at': '2026-09-02',
        }
        wonder_job = {
            'id': 'wonder_3',
            'title': '【校招】浪潮集团2027届校园招聘公告',
            'company': '浪潮集团',
            'kind': '招聘公告',
            'types': ['校招'],
            'graduation_years': ['2027'],
            'cities': ['济南'],
            'body': '浪潮集团2027校招在线投递。'*10,
            'application_url': 'https://career.inspur.com/campus',
            'source_name': '超级简历 · 公开校招线索',
            'source_url': 'https://wondercv.com/job/3',
            'provenance': '第三方线索',
            'first_seen_at': '2026-09-03',
        }
        merged = c.deduplicate([sdu_job, nankai_job, wonder_job])
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]['source_name'], '山东大学就业信息网')
        self.assertEqual(merged[0]['application_url'], 'https://career.inspur.com/campus')
        self.assertEqual(len(merged[0]['duplicate_sources']), 2)
        titles = {s['title'] for s in merged[0]['duplicate_sources']}
        self.assertIn('南开大学就业网', titles)
        self.assertIn('超级简历 · 公开校招线索', titles)
        self.assertIn('济南', merged[0]['cities'])
        self.assertIn('天津', merged[0]['cities'])
        self.assertIn('hr@inspur.com', merged[0]['emails'])

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

    def test_extract_graduation_years_matches_various_formats_and_filters_historical(self):
        self.assertEqual(c.extract_graduation_years('2027应届毕业生招聘简章'), ['2027'])
        self.assertEqual(c.extract_graduation_years('浦发银行青岛分行2027年度校园招聘启事'), ['2027'])
        # The campaign year in ``2026年校园招聘`` must not become a
        # graduation cohort; the explicit 2027届 requirement is retained.
        self.assertEqual(c.extract_graduation_years('某集团2026年校园招聘，仅面向2027届毕业生'), ['2027'])
        self.assertEqual(c.extract_graduation_years('面向2027年毕业的海内外学生'), ['2027'])
        self.assertEqual(c.extract_graduation_years('2026/2027届毕业生招聘'), ['2026', '2027'])
        self.assertEqual(c.extract_graduation_years('面向2027或2028届同学'), ['2027', '2028'])
        self.assertEqual(c.extract_graduation_years('27秋招全面启动'), ['2027'])
        # Historical company background mentions should be safely filtered out
        self.assertEqual(c.extract_graduation_years('自2006届启动校园招聘以来累计招聘万人'), [])
        self.assertEqual(c.extract_graduation_years('2018届管培生成长纪实'), [])

    def test_extract_locations_enrichment(self):
        # 1. Non-standard location labels like 招聘机构, 用人单位所在地
        evidence = c.extract_locations_from_text([], "二、招聘机构\n济南市分行、青岛市分行、淄博市分行", title="校园招聘", company="某国有大行")
        self.assertTrue(any('济南' in e for e in evidence))
        self.assertTrue(any('青岛' in e for e in evidence))

        # 2. Placeholders / boilerplate should be ignored
        ignored = c.extract_locations_from_text([], "工作地点：详见招聘岗位表\n意向城市：点击查看详情", title="招聘", company="某公司")
        self.assertEqual(len(ignored), 0)

        # 3. City branch in title / company
        branch_evidence = c.extract_locations_from_text([], "欢迎投递", title="平安银行北京分行2027校园招聘", company="平安银行")
        self.assertTrue(any('北京' in e for e in branch_evidence))

        # 4. Province branch in title / company
        prov_evidence = c.extract_locations_from_text([], "欢迎加入", title="中国邮政储蓄银行山东省分行招聘", company="中国邮政储蓄银行")
        self.assertTrue(any('山东省各分支机构' in e for e in prov_evidence))

        # 5. public_record updates cities and domestic_status
        record = c.public_record({
            'id': 'test_branch',
            'source_id': 'sdu',
            'title': '中国邮政储蓄银行山东省分行招聘',
            'company': '中国邮政储蓄银行山东省分行',
            'body': '二、招聘机构\n济南市分行、青岛市分行',
            'location_evidence': [],
            'cities': []
        })
        self.assertIn('济南', record['cities'])
        self.assertIn('青岛', record['cities'])
        self.assertEqual(record['domestic_status'], 'domestic')

    def test_supplemental_recruitment_not_merged_and_upc_qdhrss_cleanups(self):
        # 1. Regular campus announcement and supplemental recruitment must NOT be merged
        regular_job = {
            'id': 'reg-1',
            'title': '某大厂2027届秋季校园招聘',
            'company': '某互联网大厂',
            'kind': '招聘公告',
            'types': ['校招'],
            'graduation_years': ['2027'],
            'first_seen_at': '2026-09-01',
            'published_at': '2026-09-01',
            'deadline': '2026-09-10T23:59:59+08:00',
            'source_name': '山大',
            'source_url': 'https://sdu.example/reg',
        }
        supplemental_job = {
            'id': 'supp-1',
            'title': '某大厂2027届秋招补录公告',
            'company': '某互联网大厂',
            'kind': '招聘公告',
            'types': ['校招'],
            'graduation_years': ['2027'],
            'first_seen_at': '2026-09-12',
            'published_at': '2026-09-12',
            'deadline': '2026-10-31T23:59:59+08:00',
            'source_name': '南开',
            'source_url': 'https://nankai.example/supp',
        }
        merged = c.deduplicate([regular_job, supplemental_job])
        self.assertEqual(len(merged), 2, "补录公告与原秋招公告应保留为独立机会，不能被强行合并")

        # 2. qdhrss list filters out 拟聘, 公示, 体检
        sample_html = '''
        <ul>
            <li><a href="1.shtml" title="2026青岛市事业单位招聘工作人员公告">招聘公告</a>2026-09-10</li>
            <li><a href="2.shtml" title="2026公开遴选公务员拟录取人员公示">拟录取名单</a>2026-09-10</li>
            <li><a href="3.shtml" title="2026高层次人才引才体检通知">体检通知</a>2026-09-10</li>
        </ul>
        '''
        items, _ = c.qdhrss_list(sample_html, 'https://hrss.qingdao.gov.cn')
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]['title'], '2026青岛市事业单位招聘工作人员公告')

        # 3. UPC generic website is not application_url unless career path
        upc_source = next(s for s in c.SOURCES if s['id'] == 'upc')
        parsed_home = c.parse_detail('<div><p>招聘</p></div>', {
            'url': 'https://career.upc.edu.cn/detail',
            'title': '某企业招聘',
            'structured': {'dwwz': 'http://www.example.com'}
        }, upc_source)
        self.assertIsNone(parsed_home['application_url'], "企业首页不应作为直达投递入口")

        parsed_career = c.parse_detail('<div><p>招聘</p></div>', {
            'url': 'https://career.upc.edu.cn/detail',
            'title': '某企业招聘',
            'structured': {'dwwz': 'http://campus.example.com/apply'}
        }, upc_source)
        self.assertEqual(parsed_career['application_url'], 'http://campus.example.com/apply')

        parsed_updated = c.parse_detail('<div><p>报名网址：https://new.example.com/campus/apply</p></div>', {
            'url': 'https://career.upc.edu.cn/detail',
            'title': '某企业招聘',
            'application_url': 'https://old.example.com/apply',
            'structured': {'dwwz': 'https://old.example.com/career'},
        }, upc_source)
        self.assertEqual(parsed_updated['application_url'], 'https://new.example.com/campus/apply')

        # 4. parse_detail extracts embedded positions and enriches job
        pos_html = '''
        <div>
          <p>某半导体企业2027校园招聘启动！</p>
          <table>
            <tr><th>岗位名称</th><th>需求专业</th><th>学历要求</th><th>工作地点</th><th>人数</th></tr>
            <tr><td>芯片验证工程师</td><td>微电子科学、集成电路</td><td>硕士及以上</td><td>济南</td><td>5人</td></tr>
          </table>
        </div>
        '''
        parsed_job = c.parse_detail(pos_html, {
            'url': 'https://career.upc.edu.cn/detail/chip',
            'title': '某芯片企业2027校招',
            'structured': {},
        }, upc_source)
        self.assertEqual(parsed_job.get('position_count'), 1)
        self.assertEqual(parsed_job['positions'][0]['name'], '芯片验证工程师')
        self.assertIn('微电子科学', parsed_job['majors'])
        self.assertIn('济南', parsed_job['cities'])

        summary = c.public_summary(parsed_job)
        self.assertNotIn('positions', summary)
        self.assertEqual(summary.get('position_count'), 1)
        self.assertEqual(summary.get('sample_positions'), ['芯片验证工程师'])

    def test_lifecycle_and_change_alerts(self):
        # 1. Initial job publication timeline
        job_v1 = {
            'id': 'life123',
            'title': '某集团2027校招启事',
            'company': '某大型集团',
            'source_name': '山东大学就业网',
            'published_at': '2026-09-01',
            'deadline': '2026-09-20',
            'position_count': 2,
            'body': '欢迎应届毕业生投递。',
        }
        res1, counts1 = c.merge({}, [job_v1], '2026-09-01T10:00:00+08:00')
        self.assertEqual(counts1['new'], 1)
        saved1 = res1['life123']
        self.assertEqual(saved1['lifecycle_stage'], 'accepting')
        self.assertEqual(len(saved1['timeline']), 2) # published + positions_updated
        self.assertEqual(saved1['timeline'][0]['type'], 'published')

        # 2. Deadline extended update in second run
        job_v2 = dict(job_v1, deadline='2026-10-15', body='欢迎应届毕业生投递。报名截止日期现延长至10月15日。')
        res2, counts2 = c.merge(res1, [job_v2], '2026-09-10T12:00:00+08:00')
        self.assertEqual(counts2['changed'], 1)
        saved2 = res2['life123']
        self.assertEqual(saved2['lifecycle_stage'], 'extended')
        self.assertIsNotNone(saved2.get('recent_change'))
        self.assertEqual(saved2['recent_change']['type'], 'deadline_extended')
        self.assertIn('2026-10-15', saved2['recent_change']['detail'])
        types = [e['type'] for e in saved2['timeline']]
        self.assertIn('deadline_extended', types)

        # 3. Supplemental update in third run
        job_v3 = dict(job_v2, title='某集团2027校招春招补录通知', body='启动第二批补录。')
        res3, counts3 = c.merge(res2, [job_v3], '2026-09-14T09:00:00+08:00')
        saved3 = res3['life123']
        self.assertEqual(saved3['lifecycle_stage'], 'supplemental')
        self.assertEqual(saved3['recent_change']['type'], 'supplemental')
        types3 = [e['type'] for e in saved3['timeline']]
        self.assertIn('supplemental', types3)

        # 4. Deduplicate merges timeline events without duplicates
        dup_job = dict(job_v3, id='life456', source_name='南开大学就业网', source_url='https://nankai.example/job')
        deduped = c.deduplicate([saved3, dup_job])
        self.assertEqual(len(deduped), 1)
        self.assertEqual(deduped[0]['lifecycle_stage'], 'supplemental')
        # All timeline events unique
        keys = [(e['date'], e['type'], e['title']) for e in deduped[0]['timeline']]
        self.assertEqual(len(keys), len(set(keys)))

        # 5. Public summary preserves lifecycle_stage and recent_change
        summary = c.public_summary(saved3)
        self.assertEqual(summary['lifecycle_stage'], 'supplemental')
        self.assertEqual(summary['recent_change']['type'], 'supplemental')
        self.assertTrue(len(summary['timeline']) > 0)

    def test_concrete_change_diff_extraction_and_fake_change_filtering(self):
        base_job = {
            'id': 'diff_job_1',
            'title': '某科技公司2027校园招聘',
            'company': '某科技公司',
            'source_name': '测试招聘网',
            'published_at': '2026-09-01',
            'cities': ['济南'],
            'education': '本科',
            'application_url': 'https://apply1.example.com',
            'attachments': [{'title': '岗位表v1.xlsx', 'url': 'https://files.example.com/1.xlsx'}],
            'body': '诚聘软件工程师。\n工作地点济南。',
            'structured': {'updateTime': '2026-09-01 10:00:00', 'viewCount': 10},
        }
        res1, counts1 = c.merge({}, [base_job], '2026-09-01T10:00:00+08:00')
        self.assertEqual(counts1['new'], 1)

        # 1. Fake change: only volatile structured metadata and whitespace changed
        fake_change_job = dict(
            base_job,
            structured={'updateTime': '2026-09-14 12:00:00', 'viewCount': 250},
            body='诚聘软件工程师。 \n 工作地点济南。  ',
        )
        res_fake, counts_fake = c.merge(res1, [fake_change_job], '2026-09-14T12:00:00+08:00')
        self.assertEqual(counts_fake['changed'], 0)
        self.assertEqual(counts_fake['unchanged'], 1)
        self.assertIsNone(res_fake['diff_job_1'].get('recent_change'))

        # 2. Location added
        city_job = dict(base_job, cities=['济南', '青岛'])
        res_city, counts_city = c.merge(res1, [city_job], '2026-09-14T12:00:00+08:00')
        self.assertEqual(counts_city['changed'], 1)
        rc_city = res_city['diff_job_1']['recent_change']
        self.assertEqual(rc_city['label'], '地点调整')
        self.assertIn('工作地点新增「青岛」', rc_city['detail'])

        # 3. Application URL updated
        url_job = dict(base_job, application_url='https://apply2.example.com/career')
        res_url, counts_url = c.merge(res1, [url_job], '2026-09-14T12:00:00+08:00')
        self.assertEqual(counts_url['changed'], 1)
        rc_url = res_url['diff_job_1']['recent_change']
        self.assertEqual(rc_url['label'], '入口更新')
        self.assertIn('网申投递入口已更新为最新链接', rc_url['detail'])

        # 4. Attachment added
        att_job = dict(base_job, attachments=[
            {'title': '岗位表v1.xlsx', 'url': 'https://files.example.com/1.xlsx'},
            {'title': '新增专业补录需求表.xlsx', 'url': 'https://files.example.com/2.xlsx'},
        ])
        res_att, counts_att = c.merge(res1, [att_job], '2026-09-14T12:00:00+08:00')
        self.assertEqual(counts_att['changed'], 1)
        rc_att = res_att['diff_job_1']['recent_change']
        self.assertEqual(rc_att['label'], '附件变动')
        self.assertIn('新增专业补录需求表.xlsx', rc_att['detail'])

        # 5. Education requirement changed
        edu_job = dict(base_job, education='硕士及以上')
        res_edu, counts_edu = c.merge(res1, [edu_job], '2026-09-14T12:00:00+08:00')
        self.assertEqual(counts_edu['changed'], 1)
        rc_edu = res_edu['diff_job_1']['recent_change']
        self.assertEqual(rc_edu['label'], '资格调整')
        self.assertIn('学历要求调整为「硕士及以上」', rc_edu['detail'])

        # 6. Text body updated with salary keywords
        salary_job = dict(base_job, body='诚聘软件工程师。\n提供有竞争力的年薪与月度津贴福利。')
        res_sal, counts_sal = c.merge(res1, [salary_job], '2026-09-14T12:00:00+08:00')
        self.assertEqual(counts_sal['changed'], 1)
        rc_sal = res_sal['diff_job_1']['recent_change']
        self.assertIn('公告正文补充薪酬福利与待遇说明', rc_sal['detail'])

        # 7. Legacy boilerplate cleanup on unchanged job
        legacy_job = dict(base_job, recent_change={
            'type': 'content_updated',
            'label': '内容更新',
            'date': '2026-09-13',
            'detail': '招聘公告正文或附件内容已同步最新变动',
        }, timeline=[{
            'date': '2026-09-13',
            'type': 'content_updated',
            'title': '信息更新',
            'detail': '招聘公告正文或附件内容已同步最新变动',
        }])
        res_cleaned, counts_clean = c.merge({'diff_job_1': legacy_job}, [base_job], '2026-09-14T12:00:00+08:00')
        self.assertEqual(counts_clean['unchanged'], 1)
        self.assertIsNone(res_cleaned['diff_job_1'].get('recent_change'))
        self.assertEqual(len(res_cleaned['diff_job_1'].get('timeline', [])), 0)

    def test_deduplicate_attaches_facts_dictionary(self):
        job1 = {
            'id': 'job_alpha',
            'title': '中石化2027届校园招聘',
            'company': '中国石化',
            'kind': '招聘公告',
            'types': ['校招'],
            'graduation_years': ['2027'],
            'published_at': '2026-09-01',
            'cities': ['北京'],
            'location_evidence': ['工作地点：北京'],
            'education': '硕士',
            'deadline': '2026-11-01',
            'source_name': '中石化官网',
            'source_url': 'https://sinopec.example/job1',
            'first_seen_at': '2026-09-01T09:00:00+08:00',
            'body': '中石化总公司招聘正文'*15,
        }
        job2 = {
            'id': 'job_beta',
            'title': '中国石化胜利油田分公司2027校招',
            'company': '中国石化',
            'kind': '招聘公告',
            'types': ['校招'],
            'graduation_years': ['2027'],
            'published_at': '2026-09-02',
            'cities': ['东营'],
            'location_evidence': ['工作地点：东营'],
            'education': '本科及以上',
            'deadline': '2026-10-15',
            'position_count': 12,
            'source_name': '中国石油大学就业网',
            'source_url': 'https://upc.example/job2',
            'first_seen_at': '2026-09-02T09:00:00+08:00',
            'body': '胜利油田招聘正文'*15,
        }
        merged = c.deduplicate([job1, job2])
        self.assertEqual(len(merged), 1)
        self.assertEqual(len(merged[0]['duplicate_sources']), 1)
        dup_source = merged[0]['duplicate_sources'][0]
        self.assertEqual(dup_source['id'], 'job_beta')
        self.assertEqual(dup_source['announcement_title'], '中国石化胜利油田分公司2027校招')
        self.assertIn('facts', dup_source)
        facts = dup_source['facts']
        self.assertEqual(facts['title'], '中国石化胜利油田分公司2027校招')
        self.assertEqual(facts['cities'], ['东营'])
        self.assertEqual(facts['education'], '本科及以上')
        self.assertEqual(facts['deadline'], '2026-10-15')
        self.assertEqual(facts['position_count'], 12)

    def test_active_announcement_probing_selects_unexpired_stale_records(self):
        # Setup mock previous jobs
        now = c.dt.datetime.now(c.TZ)
        stale_time = (now - c.dt.timedelta(hours=80)).isoformat()
        fresh_time = (now - c.dt.timedelta(hours=10)).isoformat()
        future_deadline = (now.date() + c.dt.timedelta(days=30)).isoformat()
        past_deadline = (now.date() - c.dt.timedelta(days=30)).isoformat()

        # Job 1: unexpired, verified 80h ago -> should be probed
        job_stale_active = {
            'id': 'stale1',
            'source_id': 'nankai',
            'source_url': 'https://career.nankai.edu.cn/job/stale1',
            'title': '某集团秋招',
            'published_at': (now.date() - c.dt.timedelta(days=25)).isoformat(),
            'deadline': future_deadline,
            'last_verified_at': stale_time,
        }
        # Job 2: unexpired, verified 10h ago -> fresh, should NOT be probed
        job_fresh_active = {
            'id': 'fresh2',
            'source_id': 'nankai',
            'source_url': 'https://career.nankai.edu.cn/job/fresh2',
            'title': '某银行秋招',
            'published_at': (now.date() - c.dt.timedelta(days=20)).isoformat(),
            'deadline': future_deadline,
            'last_verified_at': fresh_time,
        }
        # Job 3: expired 30d ago, verified 80h ago -> expired, should NOT be probed
        job_expired = {
            'id': 'exp3',
            'source_id': 'nankai',
            'source_url': 'https://career.nankai.edu.cn/job/exp3',
            'title': '某公司旧公告',
            'published_at': (now.date() - c.dt.timedelta(days=60)).isoformat(),
            'deadline': past_deadline,
            'last_verified_at': stale_time,
        }
        # Job 4: different source
        job_other_source = {
            'id': 'other4',
            'source_id': 'sdu',
            'source_url': 'https://jobcareer.sdu.edu.cn/job/other4',
            'title': '山大秋招',
            'published_at': (now.date() - c.dt.timedelta(days=25)).isoformat(),
            'deadline': future_deadline,
            'last_verified_at': stale_time,
        }

        previous = {
            'jobs': {
                'stale1': job_stale_active,
                'fresh2': job_fresh_active,
                'exp3': job_expired,
                'other4': job_other_source,
            },
            'sources': {},
        }

        source = {'id': 'nankai', 'name': '南开大学'}
        items = [] # no items from current list page
        args = type('Args', (), {'refresh_hours': 72, 'probe_budget': 10})()

        # Simulate probe selection logic from collect.py
        today_str = now.date().isoformat()
        recent_expiry_cutoff = (now.date() - c.dt.timedelta(days=7)).isoformat()
        probe_refresh_cutoff = (now - c.dt.timedelta(hours=args.refresh_hours)).isoformat()
        existing_urls = {i.get('url') for i in items if i.get('url')}
        existing_ids = {c.hashlib.sha256(i.get('identity', i['url']).encode()).hexdigest()[:20] for i in items if i.get('url')}

        probe_candidates = []
        for j_id, old_job in previous.get('jobs', {}).items():
            if old_job.get('source_id') != source['id']:
                continue
            url = old_job.get('source_url')
            if not url or url in existing_urls or j_id in existing_ids:
                continue
            d_line = old_job.get('deadline')
            is_active = (d_line is None) or (d_line >= today_str) or (d_line >= recent_expiry_cutoff)
            if not is_active:
                continue
            last_ver = old_job.get('last_verified_at', '')
            if probe_refresh_cutoff and last_ver and last_ver >= probe_refresh_cutoff:
                continue
            probe_candidates.append(old_job)

        probe_candidates.sort(key=lambda j: j.get('last_verified_at') or '')
        selected = probe_candidates[:args.probe_budget]

        # Only stale1 should be selected!
        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0]['id'], 'stale1')

    def test_deduplicate_preserves_earliest_published_at_and_single_first_publish(self):
        job1 = {
            'id': 'sdu-1',
            'company': '歌尔股份有限公司',
            'title': '歌尔2027全球校园招聘',
            'types': ['校招'],
            'graduation_years': ['2027'],
            'source_name': '山东大学就业信息网',
            'source_url': 'https://job.sdu.edu.cn/detail/1',
            'published_at': '2026-09-07',
            'first_seen_at': '2026-09-07T08:00:00+08:00',
            'timeline': [{
                'date': '2026-09-07',
                'type': 'published',
                'title': '首次发布',
                'detail': '来源于 山东大学就业信息网',
                'source': '山东大学就业信息网',
            }],
        }
        job2 = {
            'id': 'upc-1',
            'company': '歌尔股份有限公司',
            'title': '歌尔2027全球校园招聘',
            'types': ['校招'],
            'graduation_years': ['2027'],
            'source_name': '中国石油大学（华东）就业网',
            'source_url': 'https://job.upc.edu.cn/detail/2',
            'published_at': '2026-09-14',
            'first_seen_at': '2026-09-14T08:00:00+08:00',
            'timeline': [{
                'date': '2026-09-14',
                'type': 'published',
                'title': '首次发布',
                'detail': '来源于 中国石油大学（华东）就业网',
                'source': '中国石油大学（华东）就业网',
            }],
        }
        deduped = c.deduplicate([job1, job2])
        self.assertEqual(len(deduped), 1)
        parent = deduped[0]
        # published_at must remain the earliest publication date across channels
        self.assertEqual(parent['published_at'], '2026-09-07')

        # timeline must only have one '首次发布', subsequent reposts become '跨渠道发布'
        first_pub_events = [e for e in parent.get('timeline', []) if e.get('title') == '首次发布']
        self.assertEqual(len(first_pub_events), 1)
        self.assertEqual(first_pub_events[0]['date'], '2026-09-07')
        self.assertEqual(first_pub_events[0]['source'], '山东大学就业信息网')

        repost_events = [e for e in parent.get('timeline', []) if e.get('title') == '跨渠道发布']
        self.assertEqual(len(repost_events), 1)
    def test_public_record_sanitizes_legacy_upc_location_evidence(self):
        legacy_upc_job = {
            'id': 'upc-old-1',
            'identity': 'upc:old-1',
            'source_id': 'upc',
            'source_name': '中国石油大学（华东）就业网',
            'source_url': 'https://career.upc.edu.cn/detail/1',
            'title': '某装备制造集团招聘简章',
            'company': '某装备制造集团',
            'body': '用人单位所在地：济南市\n诚招研发工程师、机械工程师若干，待遇优厚。',
            'location_evidence': ['工作地点：济南市'],
            'positions': [{'name': '研发工程师', 'city': ''}],
            'types': ['校招'],
            'published_at': '2026-09-01',
            'last_verified_at': '2026-09-01T10:00:00+08:00',
        }
        res = c.public_record(legacy_upc_job)
        self.assertNotIn('济南', res['cities'])
        self.assertFalse(any('济南' in ev for ev in res['location_evidence']))

        valid_upc_job = {
            'id': 'upc-valid-1',
            'identity': 'upc:valid-1',
            'source_id': 'upc',
            'source_name': '中国石油大学（华东）就业网',
            'source_url': 'https://career.upc.edu.cn/detail/2',
            'title': '某装备制造集团青岛研发中心招聘',
            'company': '某装备制造集团',
            'body': '工作地点：青岛市黄岛区，诚招研发工程师。',
            'location_evidence': ['工作地点：青岛市'],
            'positions': [{'name': '研发工程师', 'city': '青岛'}],
            'types': ['校招'],
            'published_at': '2026-09-01',
            'last_verified_at': '2026-09-01T10:00:00+08:00',
        }
        res_valid = c.public_record(valid_upc_job)
        self.assertIn('青岛', res_valid['cities'])
        self.assertTrue(any('青岛' in ev for ev in res_valid['location_evidence']))

    def test_upc_probe_task_preserves_company_and_application_url(self):
        # A previously crawled UPC job with company and application_url
        old_job = {
            'id': 'upc-p1',
            'identity': 'upc:p1',
            'source_id': 'upc',
            'source_name': '中国石油大学（华东）就业网',
            'source_url': 'https://career.upc.edu.cn/detail/career?id=p1',
            'title': '示例制造集团校园招聘',
            'company': '示例制造集团',
            'application_url': 'https://job.example.com/apply',
            'education': '本科及以上',
            'published_at': '2026-09-01',
            'last_verified_at': '2026-09-01T10:00:00+08:00',
            'deadline': '2026-11-01',
            'deadline_evidence': '11月1日截止',
            'deadline_precision': 'day',
        }
        # Plain HTML without structured dwmc or dwwz
        html = '<div class="ck-content"><p>欢迎加入我们，招聘岗位请见原公告。</p></div>'
        source = {'id': 'upc', 'name': '中国石油大学（华东）就业网', 'adapter': 'upc'}
        
        # When probing, item passes structured context and previous_facts
        probe_item = {
            'url': old_job['source_url'],
            'title': old_job['title'],
            'published_at': old_job['published_at'],
            'identity': old_job['identity'],
            'target_id': old_job['id'],
            'company': old_job['company'],
            'application_url': old_job['application_url'],
            'structured': {'dwmc': old_job['company']},
            'previous_facts': old_job,
            'is_probe': True,
        }
        
        parsed = c.parse_detail(html, probe_item, source)
        self.assertEqual(parsed['company'], '示例制造集团')
        self.assertEqual(parsed['application_url'], 'https://job.example.com/apply')

    def test_deduplicate_merges_branch_legal_names_and_year_variations(self):
        job1 = {
            'id': 'ytu-psbc',
            'company': '中国邮政储蓄银行山东省分行',
            'title': '中国邮政储蓄银行山东省分行2027校园招聘',
            'types': ['校招'],
            'graduation_years': ['2027'],
            'source_name': '烟台大学',
            'source_url': 'https://job.ytu.edu.cn/1',
            'published_at': '2026-09-14',
        }
        job2 = {
            'id': 'upc-psbc',
            'company': '中国邮政储蓄银行股份有限公司山东省分行',
            'title': '中国邮政储蓄银行山东省分行2027年校园招聘',
            'types': ['校招'],
            'graduation_years': [],
            'source_name': '中国石油大学（华东）就业网',
            'source_url': 'https://job.upc.edu.cn/2',
            'published_at': '2026-09-13',
        }
        deduped = c.deduplicate([job1, job2])
        self.assertEqual(len(deduped), 1)
        self.assertEqual(len(deduped[0].get('duplicate_sources', [])), 1)

    def test_get_active_sdei_schools_rotation_and_deep_scan(self):
        # Day of year 1 (Jan 1) -> 1 % 4 = 1
        d1 = c.dt.datetime(2026, 1, 1, 12, 0, 0, tzinfo=c.TZ)
        schools1, grp1 = c.get_active_sdei_schools(now_dt=d1)
        self.assertEqual(grp1, 1)
        self.assertTrue(all(core in schools1 for core in c.CORE_SDEI_SCHOOLS))
        self.assertTrue(all(s in schools1 for s in c.ROTATING_SDEI_GROUPS[1]))
        self.assertFalse(any(s in schools1 for s in c.ROTATING_SDEI_GROUPS[0]))

        # Forced group
        schools_f, grp_f = c.get_active_sdei_schools(now_dt=d1, force_group=3)
        self.assertEqual(grp_f, 3)
        self.assertTrue(all(s in schools_f for s in c.ROTATING_SDEI_GROUPS[3]))

        # Deep scan includes all schools
        schools_all, _ = c.get_active_sdei_schools(now_dt=d1, deep_scan=True)
        self.assertEqual(len(schools_all), 17)

    def test_sdei_pacing_and_rejection_pauses(self):
        import collector_runtime as cr
        err_403 = urllib.error.HTTPError('https://school.gxjy.sdei.edu.cn', 403, 'Forbidden', {}, None)
        err_420 = urllib.error.HTTPError('https://jnhrss.jinan.gov.cn', 420, 'Enhance Your Calm', {}, None)
        
        # 403 and 420 should never be retried immediately
        self.assertIsNone(cr.retry_delay(err_403, 0))
        self.assertIsNone(cr.retry_delay(err_420, 0))

        # Rejection triggers host pause
        cr.pause_on_rejection('https://school.gxjy.sdei.edu.cn/test', err_403)
        with self.assertRaises(cr.HostPaused):
            cr.pace('https://school.gxjy.sdei.edu.cn/test')

        # Clean up paused host
        with cr._lock:
            cr._paused.pop('school.gxjy.sdei.edu.cn', None)

    def test_safe_early_exit_on_chronological_feed(self):
        source = next(s for s in c.SOURCES if s['id'] == 'jobsdufe-announcements')
        stamp = '2026-09-10'
        item = {
            'url': 'https://school.gxjy.sdei.edu.cn/front/news/detail/1001',
            'title': '测试公告已在库中',
            'published_at': stamp,
            'inline_html': '<div id="zoom">测试内容</div>',
        }
        item_job_id = c.item_id(item)
        with TemporaryDirectory() as temp:
            # Seed state with this job
            state = {
                'jobs': {
                    item_job_id: {
                        'id': item_job_id,
                        'source_id': source['id'],
                        'published_at': stamp,
                        'url': item['url'],
                    }
                },
                'sources': {
                    source['id']: {
                        'id': source['id'],
                        'status': 'ok',
                        'total_items': 10,
                    }
                },
                'last_run_at': '2026-09-10T12:00:00+08:00',
                'pending': {}
            }
            state_path = Path(temp) / 'state.json'
            state_path.write_text(json.dumps(state), encoding='utf-8')
            
            args = SimpleNamespace(
                data_dir=temp, public_dir=temp, sources=source['id'], pages=5, days=180,
                refresh_hours=0, nankai_area=0, target_city='', offerjack_pages=1,
                detail_timeout=1, detail_retries=0, detail_failure_limit=3,
                deep_scan=False, force_positions=False, sdei_group=None
            )
            
            fetch_called_pages = []
            def fake_sdei_list(src, page):
                fetch_called_pages.append(page)
                return [item], 5

            with patch.object(c, 'sdei_list', side_effect=fake_sdei_list):
                res = c.run(args)
            
            self.assertEqual(res, 0)
            # Only page 1 should have been fetched thanks to safe early exit!
            self.assertEqual(fetch_called_pages, [1])
            new_state = json.loads(state_path.read_text(encoding='utf-8'))
            self.assertTrue(new_state['sources'][source['id']].get('early_exit'))


if __name__=='__main__': unittest.main()

