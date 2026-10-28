import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restoreBrowsing, parseUrlState, formatUrlQuery } from '../lib/browsing.ts';
import { defaultFilters, filterJobs, isUnread, mergePersonal, personalFor, validatePersonal, selectedWorkCities, UNKNOWN_SECTOR } from '../lib/jobs.ts';
import type { Job } from '../lib/jobs.ts';

const job = {
  id: '0123456789abcdef0123', title: '财务', company: '某单位', kind: '具体岗位',
  cities: ['济南'], types: ['校招'], graduation_years: ['2027'], education: '本科',
  sectors: [], directions: [], deadline: null, published_at: '2026-09-01',
  updated_at: '2026-09-01T00:00:00.000Z', first_seen_at: '2026-09-01T00:00:00.000Z',
} as unknown as Job;

void test('read status survives a backup round trip; updates become unread', () => {
  const records = validatePersonal(JSON.parse(JSON.stringify({ [job.id]: { saved: true, readAt: '2026-09-02T00:00:00.000Z' } })));
  assert.equal(isUnread(job, records), false);
  assert.equal(isUnread({ ...job, updated_at: '2026-09-03T00:00:00.000Z' }, records), true);
  assert.equal(filterJobs([job], { ...defaultFilters, onlyUnread: true }, records, null).length, 0);
  assert.equal(filterJobs([job], defaultFilters, records, null).length, 1);
  const unread = validatePersonal({ [job.id]: { ...records[job.id], readAt: null } });
  assert.equal(isUnread(job, unread), true);
  assert.equal(unread[job.id].saved, true);
});
void test('legacy records and folded sources retain expected reading state', () => {
  assert.equal(isUnread(job, validatePersonal({ [job.id]: { saved: true } })), true);
  const folded = { ...job, duplicate_ids: ['old-copy'] };
  const records = { 'old-copy': { saved: true, readAt: '2026-09-02T00:00:00.000Z' } };
  assert.equal(isUnread(folded, records), false);
  assert.equal(personalFor(folded, records).saved, true);
  assert.equal(isUnread(folded, { ...records, [job.id]: { readAt: null } }), true);
  assert.throws(() => validatePersonal({ [job.id]: { readAt: 'not-a-date' } }));
  assert.throws(() => validatePersonal({ [job.id]: { readAt: true } }));
  const existing = { [job.id]: { saved: true, readAt: '2026-09-02T00:00:00.000Z' } };
  assert.equal(isUnread(job, mergePersonal(existing, validatePersonal({ [job.id]: { saved: false } }))), false);
  assert.equal(isUnread(job, mergePersonal(existing, validatePersonal({ [job.id]: { readAt: null } }))), true);
});
void test('browsing preferences restore all filters without letting malformed fields through', () => {
  const filters = { ...defaultFilters, city: '青岛', type: '社招', sector: '保险', query: '审计', onlyUnread: true, salary: '10K以上', sort: 'deadline_asc' as const };
  assert.deepEqual(restoreBrowsing({ filters, viewMode: 'table' }), { filters, viewMode: 'table', groupCompanies: false });
  assert.equal(restoreBrowsing({ groupCompanies: true }).groupCompanies, true);
  assert.deepEqual(restoreBrowsing(null).filters, defaultFilters);
  const restored = restoreBrowsing({ filters: { type: 'bad', onlyUnread: 'true', city: [], year: 'bad', salary: 'invalid', sort: 'invalid', query: 'x'.repeat(500), __proto__: { view: 'hidden' } }, viewMode: 'invalid' });
  assert.equal(restored.filters.type, '全部');
  assert.equal(restored.filters.onlyUnread, false);
  assert.equal(restored.filters.city, '济南');
  assert.equal(restored.filters.salary, '全部');
  assert.equal(restored.filters.sort, 'newest');
  assert.equal(restored.filters.query.length, 200);
  assert.equal(restored.viewMode, 'cards');
  assert.equal(restored.filters.view, 'all');
});

void test('URL search params can be parsed and formatted cleanly', () => {
  const parsed = parseUrlState('?job=job123456&city=青岛&q=算法工程师&type=校招&year=2027&sector=国企&view=saved');
  assert.equal(parsed.jobId, 'job123456');
  assert.equal(parsed.filters?.city, '青岛');
  assert.equal(parsed.filters?.query, '算法工程师');
  assert.equal(parsed.filters?.type, '校招');
  assert.equal(parsed.filters?.year, '2027');
  assert.equal(parsed.filters?.sector, '国企');
  assert.equal(parsed.filters?.view, 'saved');

  const multiCities = parseUrlState('?cities=北京,上海,深圳');
  assert.deepEqual(multiCities.filters?.workCities, ['北京', '上海', '深圳']);

  const query = formatUrlQuery({
    ...defaultFilters,
    city: '青岛',
    query: '前端开发',
    type: '校招',
    year: '2027',
  }, 'job_abc123');
  assert.ok(query.includes('job=job_abc123'));
  assert.ok(query.includes('city=%E9%9D%92%E5%B2%9B'));
  assert.ok(query.includes('q=%E5%89%8D%E7%AB%AF%E5%BC%80%E5%8F%91'));
  assert.ok(query.includes('type=%E6%A0%A1%E6%8B%9B'));
  assert.equal(parseUrlState(query).filters?.year, '2027');

  // The marker makes a shared default independent from the recipient's saved filters.
  assert.equal(formatUrlQuery(defaultFilters, null), '?f=1');
});

void test('shared links restore complete conditions and never inherit recipient filters', () => {
  const recipient = { ...defaultFilters, city: '北京', workCities: ['北京'], salary: '20K以上', major: '会计' };
  const shared = parseUrlState('?city=青岛').filters!;
  const restored = restoreBrowsing({ filters: shared }).filters;
  assert.deepEqual(selectedWorkCities(restored), ['青岛']);
  assert.equal(restored.salary, '全部');
  assert.equal(restored.major, '');
  assert.notDeepEqual(restored, recipient);
  assert.deepEqual(parseUrlState('?job=abcdefgh').filters, defaultFilters);
  assert.deepEqual(parseUrlState(''), {});
  assert.deepEqual(parseUrlState('?utm_source=friend'), {});
});

void test('every browsing condition survives URL round trips including explicit defaults and all cities', () => {
  const filters = { ...defaultFilters, city: '全部城市', workCities: ['北京', '上海'], type: '社招', year: '全部',
    sector: UNKNOWN_SECTOR, direction: '技术 / 研发', query: '财务 审计', education: '硕士', major: '会计',
    includeUncertain: false, locationScope: 'possible' as const, showExpired: true, view: 'saved', onlyNew: true,
    onlyUnread: true, provenance: '高校 / 政府', kind: '具体岗位', salary: '20K以上', sort: 'salary_desc' as const,
    changeType: '截止延期' as const, radarFocus: 'urgent' as const, includeRelatedTalks: true,
    employmentType: 'internship' as const, validity: 'confirmed_open' as const };
  assert.deepEqual(parseUrlState(formatUrlQuery(filters, job.id)), { filters, jobId: job.id });
  const all = { ...defaultFilters, city: '全部城市', workCities: [] };
  assert.deepEqual(parseUrlState(formatUrlQuery(all)).filters, all);
  assert.deepEqual(parseUrlState(formatUrlQuery(defaultFilters)).filters, defaultFilters);
  assert.notEqual(formatUrlQuery(all), formatUrlQuery(defaultFilters));
});

void test('city aliases and legacy sectors migrate without accepting invalid URL conditions', () => {
  const restored = restoreBrowsing({ filters: { ...defaultFilters, city: '济南', workCities: ['北京市', '北京', '上海市'], sector: '综合' } }).filters;
  assert.deepEqual(restored.workCities, ['北京', '上海']);
  assert.equal(restored.city, '全部城市');
  assert.equal(restored.sector, UNKNOWN_SECTOR);
  const url = parseUrlState('?cities=北京市,上海市,不存在的城市&sector=综合&salary=bad&showExpired=oops&major=金融');
  assert.deepEqual(url.filters?.workCities, ['北京', '上海']);
  assert.equal(url.filters?.sector, UNKNOWN_SECTOR);
  assert.equal(url.filters?.salary, '全部');
  assert.equal(url.filters?.showExpired, false);
  assert.equal(url.filters?.major, '金融');
  assert.equal(parseUrlState('?job=<script>').jobId, undefined);
});
