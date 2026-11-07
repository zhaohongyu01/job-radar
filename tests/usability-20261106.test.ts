import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cardChangeAlert, countByLocationScope, countMatchingJobs, deadlineChangeKind, defaultFilters, getLifecycleStage,
} from '../lib/jobs.ts';
import type { Filters, Job } from '../lib/jobs.ts';
import { groupJobs } from '../lib/grouping.ts';
import { formatUrlQuery, parseUrlState, restoreBrowsing, restoreCardDensity } from '../lib/browsing.ts';
import { parseAnnouncementSections } from '../lib/card-summary.ts';
import { talkEventsForCity } from '../lib/talk-events.ts';
import { upcomingTalks } from '../lib/workspace.ts';

const now = Date.parse('2026-11-06T10:00:00+08:00');
const base = {
  id: 'a1b2c3d4e5f6a7b8c9d0', company: '山东示例科技有限公司', title: '山东示例科技有限公司 · 软件工程师', types: ['校招'],
  graduation_years: [], published_at: '2026-11-03', first_seen_at: '2026-11-03T08:00:00+08:00', updated_at: '2026-11-03T08:00:00+08:00',
  cities: ['济南'], location_evidence: ['工作地点：济南'], sectors: [], directions: [], education: '', deadline: '2026-12-31T23:59:59+08:00',
  domestic_status: 'domestic', kind: '具体岗位', excerpt: '', source_id: 'example', source_name: '示例', source_url: 'https://example.com/1',
} as unknown as Job;
const change = (label: string, detail: string, type = 'deadline_extended', date = '2026-11-04') =>
  ({ ...base, recent_change: { type, label, detail, date } }) as Job;

void test('a first-known or earlier deadline is not presented as an extension', () => {
  const clarified = change('明确截止时间', '明确报名截止时间为 2026-12-31T23:59:59+08:00；岗位需求变动为 0 个职位，新增专业：软件工程');
  const earlier = change('截止调整', '报名截止时间调整为 2026-11-20（原截止时间：2026-11-30）');
  const later = change('截止延期', '报名截止时间延长至 2026-12-31（原截止时间：2026-11-30）');
  assert.equal(deadlineChangeKind(clarified.recent_change), 'clarified');
  assert.equal(deadlineChangeKind(earlier.recent_change), 'adjusted');
  assert.equal(deadlineChangeKind(later.recent_change), 'extended');
  assert.notEqual(getLifecycleStage(clarified, now).stage, 'extended');
  assert.notEqual(getLifecycleStage(earlier, now).stage, 'extended');
  assert.equal(getLifecycleStage(later, now).stage, 'extended');
  assert.equal(cardChangeAlert(clarified, now), null);
  assert.deepEqual(cardChangeAlert(earlier, now), { text: '报名截止时间调整为 2026-11-20（原截止时间：2026-11-30）', tone: 'warning' });
  assert.equal(cardChangeAlert(later, now)?.tone, 'info');
});

void test('card reminders skip text refinements, empty position counts and stale changes', () => {
  assert.equal(cardChangeAlert(change('内容更新', '公告正文补充薪酬福利与待遇说明', 'content_updated'), now), null);
  assert.equal(cardChangeAlert(change('岗位表更新', '岗位需求变动为 0 个职位，新增专业：财务会计', 'positions_updated'), now), null);
  assert.equal(cardChangeAlert(change('岗位表更新', '岗位需求变动为 3 个职位', 'positions_updated'), now)?.text, '岗位需求变动为 3 个职位');
  assert.equal(cardChangeAlert(change('截止调整', '报名截止时间调整为 2026-09-20', 'deadline_extended', '2026-09-01'), now), null);
});

void test('single-pass location counts equal per-scope counts', () => {
  const jobs = [
    base,
    { ...base, id: 'b1b2c3d4e5f6a7b8c9d0', cities: ['山东'], location_evidence: ['山东省内'] },
    { ...base, id: 'c1b2c3d4e5f6a7b8c9d0', cities: [], location_evidence: [] },
    { ...base, id: 'd1b2c3d4e5f6a7b8c9d0', cities: ['青岛'], location_evidence: ['工作地点：青岛'] },
  ] as Job[];
  for (const filters of [defaultFilters, { ...defaultFilters, workCities: ['济南', '青岛'], city: '全部城市' }] as Filters[]) {
    const counts = countByLocationScope(jobs, filters, {}, null, now);
    for (const scope of ['exact', 'possible', 'unknown'] as const)
      assert.equal(counts[scope], countMatchingJobs(jobs, { ...filters, locationScope: scope }, {}, null, now), scope);
  }
});

void test('records without a cohort group only with equally unstated records of the same employer', () => {
  const jobs = [base, { ...base, id: 'b' }, { ...base, id: 'c', graduation_years: ['2027'] }, { ...base, id: 'd', types: ['社招'] }] as Job[];
  const groups = groupJobs(jobs);
  assert.deepEqual(groups.map((g) => g.jobs.map((j) => j.id)), [[base.id, 'b'], ['c'], ['d']]);
  assert.equal(groups[0].label, '届别未明确 · 校招');
  assert.equal(groupJobs(jobs, false).length, jobs.length);
});

void test('page number survives a shared URL and multi-city talk scope', () => {
  const query = formatUrlQuery(defaultFilters, null, null, 3);
  assert.equal(parseUrlState(query).page, 3);
  assert.equal(parseUrlState(formatUrlQuery(defaultFilters)).page, undefined);
  const job = { ...base, talk_events: [
    { id: 'x', date: '2026-11-10', city: '济南', school: '山东大学', venue: 'A' },
    { id: 'y', date: '2026-11-11', city: '青岛', school: '中国海洋大学', venue: 'B' },
    { id: 'z', date: '2026-11-12', city: '北京', school: '北京大学', venue: 'C' },
  ] } as unknown as Job;
  assert.deepEqual(talkEventsForCity(job, ['济南', '青岛'], now).map((e) => e.id), ['x', 'y']);
  assert.deepEqual(talkEventsForCity(job, [], now).map((e) => e.id), ['x', 'y', 'z']);
  assert.deepEqual(talkEventsForCity(job, '济南', now).map((e) => e.id), ['x']);
});

void test('a preset restores identically and agenda counts follow the selected city list', () => {
  const preset = { city: '济南', year: '2027', type: '校招', locationScope: 'exact' };
  assert.equal(restoreBrowsing({ filters: preset }, false).filters.includeRelatedTalks, false);
  assert.equal(restoreBrowsing({ filters: preset }).filters.includeRelatedTalks, true, 'legacy saved browsing keeps its migration');
  const job = { ...base, talk_events: [
    { id: 'x', date: '2026-11-10', city: '济南', school: '山东大学', venue: 'A' },
    { id: 'y', date: '2026-11-11', city: '青岛', school: '中国海洋大学', venue: 'B' },
    { id: 'z', date: '2026-11-12', city: '北京', school: '北京大学', venue: 'C' },
  ] } as unknown as Job;
  assert.equal(upcomingTalks([job], {}, ['济南', '青岛'], now).length, 2);
  assert.equal(upcomingTalks([job], {}, '全部城市', now).length, 3);
  assert.equal(upcomingTalks([job], {}, '北京', now).length, 1);
});

void test('card density preference and structured announcement section parsing', () => {
  assert.equal(restoreCardDensity('compact'), 'compact');
  assert.equal(restoreCardDensity('standard'), 'standard');
  assert.equal(restoreCardDensity('invalid'), 'standard');
  assert.equal(restoreCardDensity(null), 'standard');

  assert.deepEqual(parseAnnouncementSections('FULL_BODY_SUCCESS'), [{ id: 'sec-0', content: 'FULL_BODY_SUCCESS' }]);
  const multiSec = [
    '一、单位简介',
    '示例集团是国有大型骨干企业。',
    '二、招聘岗位',
    '本次招聘软件研发岗 10 人。',
    '三、报名条件',
    '2027 届硕士研究生及以上学历。',
  ].join('\n');
  const parsed = parseAnnouncementSections(multiSec);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].heading, '一、单位简介');
  assert.equal(parsed[1].heading, '二、招聘岗位');
  assert.equal(parsed[2].heading, '三、报名条件');
});
