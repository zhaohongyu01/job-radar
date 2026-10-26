import contextlib
import datetime as dt
import io
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import collect as c
import ci_collect as ci
from campus_talks import (sdu_calendar, sdu_recruitment_body, bysjy_calendar,
                         sdnu_graduate_list, sdnu_graduate_event)
from audit_freshness import university_coverage


def event_item(number=1, date=None, venue='主校区就业报告厅'):
    return {'url': f'https://school.gxjy.sdei.edu.cn/ujn/school/TblCareerFairReviewRecord/detail/{number}',
        'title': f'企业{number}宣讲会', 'published_at': None, 'kind': '招聘公告',
        'structured': {'fairDate': date or (dt.datetime.now(c.TZ) + dt.timedelta(days=1)).date().isoformat(),
            'fairStartTime': '14:00', 'fairEndTime': '16:00', 'schoolName': '济南大学', 'fairAddress': venue}}


class CampusCalendarTests(unittest.TestCase):
    def setUp(self):
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        self.enterContext(contextlib.redirect_stderr(io.StringIO()))
        self.enterContext(patch.dict(c.os.environ, {'GITHUB_STEP_SUMMARY': ''}))
        self.source = next(s for s in c.SOURCES if s['id'] == 'ujn-talks')

    def args(self, directory, **overrides):
        return SimpleNamespace(**dict(dict(data_dir=directory, public_dir=directory, sources='ujn-talks',
            pages=5, days=30, refresh_hours=72, nankai_area=0, target_city='', offerjack_pages=1,
            probe_budget=10, state_only=True, head_only=True), **overrides))

    def test_sdu_weekly_calendar_keeps_full_dates_and_empty_days(self):
        html = '''<input id="weekI" value="0"><li class="xjhli"></li><li class="xjhli">
            <a onclick="viewXjhxx('abc123')">某企业宣讲会</a>
            <a onclick="viewXjhxx('abc123')" title="中心校区海尔报告厅">中心校区…</a>
            <a onclick="viewXjhxx('abc123')">2026-12-31 14：30—16：00</a></li>'''
        item, = sdu_calendar(html)
        job = c.calendar_record(item, next(s for s in c.SOURCES if s['id'] == 'sdu-talks'))
        self.assertEqual(job['talk_event']['date'], '2026-12-31')
        self.assertEqual(job['talk_event']['start_time'], '14:30')
        self.assertEqual(job['talk_event']['city'], '济南')
        self.assertIsNone(item['published_at'])
        with self.assertRaises(ValueError):
            sdu_calendar('<h1>统一登录</h1>')

    def test_sdu_campuses_online_and_cancellation(self):
        item = event_item()
        item['structured']['schoolName'] = '山东大学'
        for venue, city in [('中心校区海尔报告厅', '济南'), ('千佛山校区报告厅', '济南'), ('佛山市报告厅', '佛山'), ('青岛校区N3', '青岛'),
                            ('威海校区报告厅', '威海'), ('线上宣讲（济南）', None), ('某报告厅', None)]:
            item['structured']['fairAddress'] = venue
            self.assertEqual(c.calendar_record(item, self.source)['talk_event']['city'], city)
        self.assertEqual(c.calendar_record(dict(item, title='已取消 某企业'), self.source)['talk_event']['status'], 'cancelled')

    def test_sdu_recruitment_section_excludes_event_and_employer_address(self):
        html = '<div class="ggName">甲公司</div><div class="bd_one">企业信息 北京</div>' \
            '<div class="bd_one">宣讲信息 济南 举办日期2026-10-24</div>' \
            '<div class="bd_one">招聘信息 工作地点：青岛</div>'
        body, company = sdu_recruitment_body(html)
        self.assertEqual(company, '甲公司')
        self.assertIn('青岛', body)
        self.assertNotIn('济南', body)
        self.assertNotIn('北京', body)

    def test_sdnu_graduate_article_requires_explicit_year_and_keeps_event_city_separate(self):
        source = next(s for s in c.SOURCES if s['id'] == 'sdnu-graduate-talks')
        listing = '<li class="he_cntzriboli"><a href="info/1031/97951.htm"><h4 class="he_title2">10-21</h4>' \
            '<span class="he_title6">2026</span><h4 class="he_title5">通州区教委校园宣讲会</h4></a></li>'
        item, = sdnu_graduate_list(listing, source['url'])
        article = '<div id="vsb_content"><p>宣讲时间：10 月27日（周二）上午9:00-11:00</p>' \
            '<p>咨询时间：10月27日下午14:00-16:00</p><p>地点：山东师范大学长清湖校区英华楼一楼东厅</p>' \
            '<p>拟于20 26 年 10 月 27 日召开校园宣讲会。单位位于北京。</p></div>'
        event_item = sdnu_graduate_event(article, item)
        job = c.calendar_record(event_item, source)
        self.assertEqual(job['talk_event']['date'], '2026-10-27')
        self.assertEqual(job['talk_event']['start_time'], '09:00')
        self.assertEqual(job['talk_event']['end_time'], '11:00')
        self.assertEqual(job['talk_event']['city'], '济南')
        self.assertEqual(job['cities'], [])
        with self.assertRaises(ValueError):
            sdnu_graduate_event(article.replace('20 26 年 10 月 27 日', ''), item)

    def test_official_calendar_publishes_no_job_eligibility(self):
        row = c.calendar_record(dict(event_item(), title='济南市某医院2027届宣讲会'), self.source)
        self.assertTrue(c.publishable_job(row))
        self.assertEqual(row['detail_verification'], 'pending')
        public = c.public_record(row)
        for field in ('cities', 'graduation_years', 'positions', 'types'):
            self.assertEqual(public[field], [])
        for field in ('deadline', 'published_at', 'application_url'):
            self.assertIsNone(public[field])
        self.assertFalse(c.publishable_job(dict(row, kind='具体岗位', event_verification=None)))
        failed = dict(row, kind='招聘公告', detail_verification='failed', body='旧的岗位条件',
                      company='旧企业', cities=['青岛'], types=['校招'])
        self.assertTrue(c.publishable_job(failed))
        projected = c.public_record(failed)
        self.assertEqual(projected['kind'], '宣讲会')
        self.assertEqual(projected['cities'], [])
        self.assertEqual(failed['body'], '旧的岗位条件')

    def test_list_refresh_preserves_verified_recruitment_and_cache_age(self):
        item = event_item()
        old = dict(c.calendar_record(item, self.source), kind='招聘公告', detail_verification='verified',
            company='甲公司', cities=['青岛'], last_verified_at='2026-09-01T12:00:00+08:00')
        self.assertIsNone(c.calendar_record(item, self.source, old))
        changed = dict(item, structured=dict(item['structured'], fairAddress='主校区新报告厅'))
        updated = c.calendar_record(changed, self.source, old)
        self.assertEqual(updated['cities'], ['青岛'])
        self.assertEqual(updated['detail_verified_at'], old['last_verified_at'])
        self.assertEqual(updated['talk_event']['venue'], '主校区新报告厅')
        self.assertNotEqual(c.compute_job_fingerprint(updated), c.compute_job_fingerprint(old))
        cancelled = c.calendar_record(dict(item, title='已取消：甲公司'), self.source, old)
        self.assertEqual(c.public_record(cancelled)['talk_event']['status'], 'cancelled')

    def test_head_pass_saves_all_list_events_without_detail_requests_and_roundtrips(self):
        found = [event_item(i) for i in range(40)]
        with TemporaryDirectory() as tmp:
            with patch.object(c, 'sdei_list', side_effect=lambda source, page: (found[(page-1)*20:page*20], 20)), \
                    patch.object(c, 'fetch', side_effect=AssertionError('Detail requested during calendar head pass')):
                c.run(self.args(tmp))
            state = json.loads((Path(tmp) / 'state.json').read_text(encoding='utf-8'))
            self.assertEqual(len(state['jobs']), 40)
            self.assertEqual(len(state['pending'][self.source['id']]), 40)
            self.assertEqual(state['sources'][self.source['id']]['pages'], 2)
            snapshot = c.export_snapshot(state, Path(tmp))
            self.assertEqual(len(snapshot['jobs']), 40)
            restored = ci.snapshot_state(snapshot, lambda url: json.loads((Path(tmp) / url.lstrip('/')).read_text(encoding='utf-8')))
            self.assertEqual(len(restored['jobs']), 40)
            self.assertTrue(all(c.publishable_job(job) for job in restored['jobs'].values()))
            self.assertTrue(all(job['detail_verification'] == 'pending' for job in restored['jobs'].values()))

    def test_public_inline_recruitment_is_parsed_and_reused_without_a_detail_request(self):
        item = event_item()
        structured = dict(item['structured'], id='inline1', fairName='甲公司2027校园招聘', companyName='甲公司',
            fairDetail='<div><p>招聘简章：2027届本科毕业生。工作地点：青岛。</p><p>简历投递：请核对原公告。</p>'
                + '<p>招聘岗位：工程师，专业要求详见招聘简章。公司介绍及招聘条件。</p>' * 5 + '</div>')
        response = json.dumps({'rows': [structured], 'total': 1})
        with TemporaryDirectory() as tmp:
            with patch.object(c, 'fetch', return_value=response) as fetch:
                c.run(self.args(tmp, head_only=False))
                self.assertEqual(fetch.call_count, 1)  # only the public list, no event detail GET
                self.assertIn('list', fetch.call_args.args[0].lower())
            state = json.loads((Path(tmp) / 'state.json').read_text(encoding='utf-8'))
            job, = state['jobs'].values()
            self.assertEqual(job['detail_verification'], 'verified')
            self.assertEqual(job['cities'], ['青岛'])
            self.assertEqual(job['talk_event']['city'], '济南')
            self.assertEqual(state['pending'][self.source['id']], [])
            with patch.object(c, 'fetch', return_value=response) as fetch:
                c.run(self.args(tmp, head_only=False))
                self.assertEqual(fetch.call_count, 1)
            updated = json.loads((Path(tmp) / 'state.json').read_text(encoding='utf-8'))
            self.assertEqual(updated['sources'][self.source['id']]['cached'], 1)
            self.assertEqual(updated['jobs'][job['id']]['detail_verified_at'], job['detail_verified_at'])

    def test_cancelled_event_replaces_existing_calendar_and_past_details_are_not_fetched(self):
        item = event_item()
        past = event_item(2, (dt.datetime.now(c.TZ) - dt.timedelta(days=2)).date().isoformat())
        with TemporaryDirectory() as tmp:
            old, _ = c.merge({}, [c.calendar_record(item, self.source)], dt.datetime.now(c.TZ).isoformat())
            c.atomic_json(Path(tmp) / 'state.json', {'jobs': old, 'sources': {}, 'pending': {}})
            with patch.object(c, 'sdei_list', return_value=([dict(item, title='已取消：企业宣讲'), past], 1)), \
                    patch.object(c, 'fetch', side_effect=AssertionError('Ended event detail fetched')):
                c.run(self.args(tmp, head_only=False))
            state = json.loads((Path(tmp) / 'state.json').read_text(encoding='utf-8'))
            snapshot = c.export_snapshot(state, Path(tmp))
            self.assertEqual(state['pending'][self.source['id']], [])
            self.assertEqual(len(snapshot['jobs']), 2)  # keep a cancellation tombstone for saved calendars
            cancelled = [j for j in snapshot['jobs'] if j['talk_event']['status'] == 'cancelled']
            self.assertEqual(len(cancelled), 1)
            self.assertEqual(cancelled[0]['talk_event']['date'], item['structured']['fairDate'])

    def test_bysjy_calendar_uses_venue_not_employer_city(self):
        source = next(s for s in c.SOURCES if s['id'] == 'sdjzu-talks')
        row = {'career_talk_id': '123', 'meet_name': '甲企业', 'meet_day': '2026-10-26',
            'meet_time': '14:00', 'meet_end_time': '15:00', 'address': '博文楼109室',
            'city_name': '南京市', 'job_city': '全国', 'is_yun': '0', 'career_state': '0'}
        item, = bysjy_calendar({'code': 1, 'data': [row]}, source)
        job = c.calendar_record(item, source)
        self.assertEqual(job['talk_event']['city'], '济南')
        self.assertEqual(job['cities'], [])
        row['career_state'] = '1'
        self.assertEqual(c.calendar_record(bysjy_calendar({'code': 1, 'data': [row]}, source)[0], source)['talk_event']['status'], 'cancelled')
        with self.assertRaises(ValueError):
            bysjy_calendar({'code': 0, 'msg': 'error'}, source)

    def test_timeout_recovers_calendar_without_claiming_detail_verified(self):
        item = event_item()
        stamp = dt.datetime.now(c.TZ).isoformat(timespec='seconds')
        prior = {'jobs': {}, 'sources': {}, 'pending': {}, 'last_run_at': '2026-01-01T00:00:00+08:00'}
        with TemporaryDirectory() as tmp:
            path = Path(tmp)
            c.atomic_json(path / 'state.json', prior)
            c.atomic_json(path / 'checkpoint.json', {'run_at': stamp, 'source': self.source, 'pending': [item]})
            job = c.calendar_record(item, self.source)
            (path / 'progress.jsonl').write_text(json.dumps({'job': job, 'url': item['url'], 'verified': False})+'\n', encoding='utf-8')
            state = ci.recover_source(path, self.source, prior, stamp, -1, True)
            self.assertTrue(c.publishable_job(state['jobs'][job['id']]))
            self.assertEqual(state['jobs'][job['id']]['detail_verification'], 'pending')
            self.assertEqual(len(state['pending'][self.source['id']]), 1)
            self.assertEqual(state['sources'][self.source['id']]['status'], 'partial')

    def test_sdu_head_scan_crosses_empty_weeks_without_unbounded_pagination(self):
        with TemporaryDirectory() as tmp:
            with patch.object(c, 'fetch', return_value='<input id="weekI" value="0">') as fetch:
                c.run(self.args(tmp, sources='sdu-talks'))
            self.assertEqual(fetch.call_count, 5)
            self.assertIn('weekI=4', fetch.call_args.args[0])

    def test_cloud_calendars_are_scheduled_once_not_duplicated_as_other_feeds(self):
        stamp = dt.datetime.now(c.TZ).isoformat(timespec='seconds')
        with TemporaryDirectory() as tmp:
            path = Path(tmp)
            c.atomic_json(path / 'state.json', {'jobs': {}, 'sources': {}, 'pending': {}, 'last_run_at': stamp})
            calls = []
            def worker(source, prior, args, budget):
                calls.append(source['id'])
                return dict(prior, sources={source['id']: dict(source, status='ok', pages=1, errors=[], last_attempt_at=stamp)})
            args = SimpleNamespace(data_dir=path, sources='sdu-talks,sdjzu-talks,sdjt-talks', source_pack='',
                freshness_first=False, shard_budget=180, source_budget=30, deep_scan=False)
            with patch.object(ci, 'run_source', side_effect=worker):
                ci.collect(args)
            self.assertCountEqual(calls, ['sdu-talks', 'sdjzu-talks', 'sdjt-talks'])

    def test_coverage_distinguishes_missing_channel_from_empty_calendar(self):
        definitions = [{'id': 'a', 'university': '甲大学'},
            {'id': 'b-talks', 'university': '乙大学', 'channel': 'talks'}]
        rows = university_coverage({'sources': [{'id': 'a', 'status': 'ok'}]}, {}, definitions)
        self.assertEqual(rows[0]['calendar_sources'], [])
        self.assertEqual(rows[1]['calendar_sources'][0]['status'], 'not_collected')


if __name__ == '__main__':
    unittest.main()
