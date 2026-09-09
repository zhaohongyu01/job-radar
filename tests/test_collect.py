import importlib.util
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('collect',ROOT/'scripts/collect.py')
c=importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)

class CollectionTests(unittest.TestCase):
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
