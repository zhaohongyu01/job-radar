import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  filterJobs,
  defaultFilters,
  validatePersonal,
  externalUrl,
  locationMatch,
  personalFor,
  isDomestic,
  parseSalaryRange,
  getDeadlineCountdown,
  normalizeCompanyName,
  normalizeTitleCore,
  mergeDuplicateOpportunities,
} from '../lib/jobs.ts';
import type { Job } from '../lib/jobs.ts';
const job = {
  id: '0123456789abcdef0123',
  title: '财务',
  company: '某单位',
  body: '经济学',
  cities: ['济南'],
  possible_cities: [],
  province_possible: false,
  types: ['校招'],
  graduation_years: ['2027'],
  education: '本科',
  sectors: ['国企'],
  directions: ['财务 / 经济'],
  deadline: null,
  published_at: '2026-09-01',
  first_seen_at: '2026-09-02T00:00:00Z',
  updated_at: '2026-09-02T00:00:00Z',
} as unknown as Job;
void test('mixed city and province keeps the province scope without inventing exact locations', () => {
  const mixed = { ...job, cities: ['北京'], location_evidence: ['工作地点：北京、山东省'] };
  assert.equal(locationMatch(mixed, '济南'), 'possible');
  assert.equal(locationMatch({ ...mixed, location_evidence: ['工作地点：北京、山东省青岛市'] }, '济南'), 'none');
});
void test('lazy full text index retains matches outside the listing excerpt', () => {
  const indexed = { ...job, body: undefined, search_text: '岗位要求：税收学专业', excerpt: '招聘公告' };
  assert.equal(filterJobs([indexed], { ...defaultFilters, query: '税收学' }, {}, null).length, 1);
});
void test('repost folding preserves personal records and supports clearing them', () => {
  const folded={...job, duplicate_ids:['old-copy']};
  const personal={'old-copy':{saved:true}};
  assert.equal(filterJobs([folded],{...defaultFilters,view:'saved'},personal,null).length,1);
  assert.equal(personalFor(folded,personal).saved,true);
  assert.equal(personalFor(folded,{...personal,[folded.id]:{saved:false}}).saved,false);
});
void test('third-party metadata can be excluded without losing primary sources', () => {
  const secondary={...job,provenance:'第三方线索'};
  assert.equal(filterJobs([secondary],{...defaultFilters,provenance:'高校 / 政府'}, {}, null).length,0);
  assert.equal(filterJobs([job],{...defaultFilters,provenance:'高校 / 政府'}, {}, null).length,1);
});
void test('newest publication comes first; unknown date last', () => {
  const newer = { ...job, id: 'newer', published_at: '2026-09-09' };
  const undated = { ...job, id: 'undated', published_at: null };
  assert.deepEqual(
    filterJobs([job, undated, newer], defaultFilters, {}, null).map(
      (j) => j.id,
    ),
    ['newer', job.id, 'undated'],
  );
});
void test('city scope is independent of unknown qualifications', () => {
  const unknown = { ...job, cities: [], location_evidence: [], types: [] };
  assert.equal(filterJobs([unknown], defaultFilters, {}, null).length, 0);
  assert.equal(
    filterJobs(
      [unknown],
      { ...defaultFilters, locationScope: 'unknown' },
      {},
      null,
    ).length,
    1,
  );
  const regional = {
    ...unknown,
    location_evidence: ['工作地点：山东省分行辖属各分支机构'],
  };
  assert.equal(locationMatch(regional, '济南'), 'possible');
  assert.equal(locationMatch(regional, '青岛'), 'possible');
  assert.equal(locationMatch(regional, '广州'), 'none');
  assert.equal(
    filterJobs(
      [regional],
      { ...defaultFilters, locationScope: 'possible' },
      {},
      null,
    ).length,
    1,
  );
});
void test('headquarters and unrelated city mentions never imply recruitment location', () => {
  const elsewhere = {
    ...job,
    cities: ['北京'],
    possible_cities: ['济南'],
    province_possible: true,
    location_evidence: ['工作地点：北京'],
  };
  assert.equal(locationMatch(elsewhere, '济南'), 'none');
  assert.equal(
    locationMatch({ ...elsewhere, cities: [], location_evidence: [] }, '济南'),
    'unknown',
  );
});
void test('real snapshot: Guangdong excluded from every Jinan scope; bank remains unconfirmed', () => {
  const { jobs } = JSON.parse(
    readFileSync(new URL('../public/jobs.json', import.meta.url), 'utf8'),
  ) as { jobs: Job[] };
  const tor = jobs.find((j) => j.title === '图拉斯 2027校园招聘')!;
  const bank = jobs.find(
    (j) => j.title === '中国工商银行股份有限公司威海分行招聘',
  )!;
  assert.ok(tor);
  assert.ok(bank);
  assert.equal(locationMatch(tor, '济南'), 'none');
  assert.equal(locationMatch(tor, '广州'), 'possible');
  assert.equal(locationMatch(bank, '济南'), 'possible');
  for (const locationScope of ['exact', 'possible', 'unknown'] as const) {
    assert.equal(
      filterJobs([tor], { ...defaultFilters, locationScope }, {}, null).length,
      0,
    );
  }
  const matched = filterJobs(jobs, defaultFilters, {}, null);
  assert.ok(matched.length > 0);
  assert.ok(matched.every((j) => j.cities.includes('济南')));
});
void test('default shows opportunities without requesting personal qualifications', () =>
  assert.equal(filterJobs([job], defaultFilters, {}, null).length, 1));
void test('province inside a specific address does not imply other cities', () => {
  for (const address of ['山东威海', '山东省青岛市崂山区国际创新园', '山东 威海']) {
    assert.equal(locationMatch({ ...job, cities: ['威海','青岛'], location_evidence: [`工作地点：${address}`] }, '济南'), 'none');
  }
  assert.equal(locationMatch({ ...job, cities: ['北京','南京'], location_evidence: ['北京市 / 山东省 / 江苏省', '工作地点\n北京、南京'] }, '济南'), 'none');
  assert.equal(locationMatch({ ...job, cities: [], location_evidence: ['山东省 / 广东省'] }, '济南'), 'possible');
});
void test('specific cities override a generic national label', () => {
  const mixed = {
    ...job,
    cities: ['上海'],
    location_evidence: ['工作地点：上海、全国、海外'],
    domestic_status: 'mixed' as const,
  };
  assert.equal(locationMatch(mixed, '济南'), 'none');
  assert.equal(locationMatch(mixed, '上海'), 'exact');
});
void test('overseas-only records are excluded from domestic results', () => {
  const overseas = {
    ...job,
    cities: [],
    domestic_status: 'overseas' as const,
    location_evidence: ['工作地点：国外'],
  };
  const mixed = { ...overseas, id: 'mixed', domestic_status: 'mixed' as const, cities: ['上海'] };
  assert.equal(filterJobs([overseas], defaultFilters, {}, null).length, 0);
  assert.equal(filterJobs([mixed], { ...defaultFilters, city: '全部城市' }, {}, null).length, 1);
  assert.equal(isDomestic({ ...overseas, domestic_status: undefined }), false);
});
void test('campus cohort and social switch respect classification', () => {
  assert.equal(
    filterJobs(
      [job],
      { ...defaultFilters, type: '校招', year: '2026' },
      {},
      null,
    ).length,
    0,
  );
  assert.equal(
    filterJobs([job], { ...defaultFilters, type: '社招' }, {}, null).length,
    0,
  );
});
void test('unknown eligibility remains visible when requested', () => {
  const unknown = { ...job, types: [], graduation_years: [] };
  assert.equal(
    filterJobs([unknown], { ...defaultFilters, type: '校招' }, {}, null).length,
    1,
  );
  assert.equal(
    filterJobs(
      [unknown],
      { ...defaultFilters, type: '校招', includeUncertain: false },
      {},
      null,
    ).length,
    0,
  );
});
void test('expired announcement is not shown as open', () => {
  assert.equal(
    filterJobs(
      [{ ...job, deadline: '2026-01-01T00:00:00+08:00' }],
      defaultFilters,
      {},
      null,
      Date.parse('2026-09-09'),
    ).length,
    0,
  );
});
void test('hidden opportunities remain recoverable', () => {
  const personal = { [job.id]: { hidden: true } };
  assert.equal(filterJobs([job], defaultFilters, personal, null).length, 0);
  assert.equal(
    filterJobs([job], { ...defaultFilters, view: 'hidden' }, personal, null)
      .length,
    1,
  );
});
void test('import rejects malicious or invalid properties', () => {
  assert.throws(() =>
    validatePersonal(JSON.parse('{"__proto__":{"saved":true}}')),
  );
  assert.throws(() => validatePersonal({ [job.id]: { saved: 'yes' } }));
  assert.deepEqual(validatePersonal({ [job.id]: { saved: true } })[job.id], {
    saved: true,
    applied: false,
    hidden: false,
  });
});
void test('unsafe application URL never renders as executable link', () => {
  assert.equal(externalUrl('javascript:alert(1)'), undefined);
  assert.equal(
    externalUrl('https://example.com/apply'),
    'https://example.com/apply',
  );
});
void test('multi-keyword space-separated query matches all terms', () => {
  const sample = {
    ...job,
    title: '资深制程研发工程师',
    company: '泉意光罩光电科技（济南）有限公司',
    directions: ['技术 / 研发'],
    body: '',
    excerpt: '面向2027应届毕业生，专业要求光学、材料',
    cities: ['济南'],
  };
  assert.equal(filterJobs([sample], { ...defaultFilters, query: '研发' }, {}, null).length, 1);
  assert.equal(filterJobs([sample], { ...defaultFilters, query: '研发 泉意' }, {}, null).length, 1);
  assert.equal(filterJobs([sample], { ...defaultFilters, query: '研发 2027 济南' }, {}, null).length, 1);
  assert.equal(filterJobs([sample], { ...defaultFilters, query: '研发 审计' }, {}, null).length, 0);
});

void test('parseSalaryRange extracts accurate monthly ranges and rejects invalid strings', () => {
  const job1 = { ...job, title: '软件工程师\n6000-8000元' };
  assert.deepEqual(parseSalaryRange(job1), { min: 6000, max: 8000, raw: '6000-8000元' });

  const job2 = { ...job, title: '算法科学家\n20000元以上' };
  assert.deepEqual(parseSalaryRange(job2), { min: 20000, max: Number.POSITIVE_INFINITY, raw: '20000元以上' });

  const job3 = { ...job, title: '前端开发（8k-15k）' };
  assert.deepEqual(parseSalaryRange(job3), { min: 8000, max: 15000, raw: '（8k-15k）' });

  const job4 = { ...job, title: '架构师 15~18W/年' };
  assert.deepEqual(parseSalaryRange(job4), { min: 12500, max: 15000, raw: '15~18W/年' });

  const jobExcerpt = { ...job, title: '管培生', excerpt: '薪资待遇：8000-12000元/月，五险一金' };
  assert.deepEqual(parseSalaryRange(jobExcerpt), { min: 8000, max: 12000, raw: '8000-12000元' });

  const jobNegotiable = { ...job, title: '行长助理', excerpt: '薪资待遇：面议' };
  assert.equal(parseSalaryRange(jobNegotiable), null);

  const jobDate = { ...job, title: '校园招聘2026-09' };
  assert.equal(parseSalaryRange(jobDate), null);
});

void test('getDeadlineCountdown computes correct urgency and days left', () => {
  const base = Date.parse('2026-09-14T12:00:00+08:00');
  
  // Past deadline
  const expired = getDeadlineCountdown('2026-09-13T12:00:00+08:00', base);
  assert.equal(expired?.urgency, 'expired');
  assert.equal(expired?.text, '已截止');

  // Same day
  const today = getDeadlineCountdown('2026-09-14T23:59:59+08:00', base);
  assert.equal(today?.urgency, 'urgent');
  assert.equal(today?.text, '今日截止');

  // 1 day left
  const oneDay = getDeadlineCountdown('2026-09-15T18:00:00+08:00', base);
  assert.equal(oneDay?.urgency, 'urgent');
  assert.equal(oneDay?.text, '剩 1 天截止');

  // 5 days left
  const warning = getDeadlineCountdown('2026-09-19T12:00:00+08:00', base);
  assert.equal(warning?.urgency, 'warning');
  assert.equal(warning?.text, '剩 5 天截止');

  // 20 days left
  const normal = getDeadlineCountdown('2026-10-04T12:00:00+08:00', base);
  assert.equal(normal?.urgency, 'normal');
  assert.equal(normal?.text, '剩 20 天');
});

void test('filterJobs filters by salary expectation accurately', () => {
  const lowPay = { ...job, id: 'low', title: '文员 4000-5000元' };
  const midPay = { ...job, id: 'mid', title: '会计 7000-9000元' };
  const highPay = { ...job, id: 'high', title: '算法 18000-25000元' };
  const unstated = { ...job, id: 'unknown', title: '行政专员' };

  const all = [lowPay, midPay, highPay, unstated];

  const atLeast8k = filterJobs(all, { ...defaultFilters, salary: '8K以上' }, {}, null);
  assert.deepEqual(atLeast8k.map((j) => j.id), ['high', 'mid']);

  const atLeast15k = filterJobs(all, { ...defaultFilters, salary: '15K以上' }, {}, null);
  assert.deepEqual(atLeast15k.map((j) => j.id), ['high']);

  const allSalaries = filterJobs(all, { ...defaultFilters, salary: '全部' }, {}, null);
  assert.equal(allSalaries.length, 4);
});

void test('filterJobs multi-mode sorting operates correctly', () => {
  const baseTime = Date.parse('2026-09-14T12:00:00+08:00');
  const jobSoon = { ...job, id: 'soon', title: '急招\n6000-8000元', deadline: '2026-09-16T00:00:00+08:00', published_at: '2026-09-01' };
  const jobLater = { ...job, id: 'later', title: '常招\n20000元以上', deadline: '2026-09-30T00:00:00+08:00', published_at: '2026-09-10' };
  const jobNoDeadline = { ...job, id: 'nodeadline', title: '国企\n10000-15000元', deadline: null, published_at: '2026-09-12' };

  // Sort by deadline_asc: upcoming deadline first
  const deadlineSorted = filterJobs([jobLater, jobNoDeadline, jobSoon], { ...defaultFilters, sort: 'deadline_asc' }, {}, null, baseTime);
  assert.deepEqual(deadlineSorted.map((j) => j.id), ['soon', 'later', 'nodeadline']);

  // Sort by salary_desc: highest salary first
  const salarySorted = filterJobs([jobSoon, jobLater, jobNoDeadline], { ...defaultFilters, sort: 'salary_desc' }, {}, null, baseTime);
  assert.deepEqual(salarySorted.map((j) => j.id), ['later', 'nodeadline', 'soon']);
});

void test('normalizeCompanyName strips common legal suffixes', () => {
  assert.equal(normalizeCompanyName('中国石油天然气股份有限公司'), '中国石油天然气');
  assert.equal(normalizeCompanyName('浪潮集团有限公司'), '浪潮');
  assert.equal(normalizeCompanyName('海尔智家股份有限公司'), '海尔智家');
  assert.equal(normalizeCompanyName(undefined), '');
});

void test('normalizeTitleCore removes bracket prefixes and notice noise', () => {
  assert.equal(normalizeTitleCore('【央企直聘】中国石化2027年度校园招聘公告'), '中国石化2027年度');
  assert.equal(normalizeTitleCore('浪潮集团2027届校园招聘简章'), '浪潮集团2027届');
  assert.equal(normalizeTitleCore('青岛海尔软件开发工程师招聘'), '青岛海尔软件开发工程师');
});

void test('mergeDuplicateOpportunities merges multi-channel postings of same company and cohort', () => {
  const jobSdu: Job = {
    ...job,
    id: 'sdu-101',
    source_id: 'sdu',
    source: 'sdu',
    source_name: '山东大学就业网',
    source_url: 'https://job.sdu.edu.cn/101',
    company: '中国石化集团有限公司',
    title: '【央企直聘】中国石化2027届校园招聘公告',
    kind: '招聘公告',
    published_at: '2026-09-12',
    cities: ['济南'],
  };

  const jobUpc: Job = {
    ...job,
    id: 'upc-202',
    source_id: 'upc',
    source: 'upc',
    source_name: '中国石油大学（华东）就业指导中心',
    source_url: 'https://career.upc.edu.cn/202',
    application_url: 'https://job.sinopec.com/apply',
    company: '中国石化股份有限公司',
    title: '中国石化2027届高校毕业生校园招聘简章',
    kind: '招聘公告',
    published_at: '2026-09-13',
    cities: ['青岛'],
  };

  const jobDifferent: Job = {
    ...job,
    id: 'ytu-303',
    source_id: 'ytu',
    source: 'ytu',
    source_name: '烟台大学就业网',
    source_url: 'https://job.ytu.edu.cn/303',
    company: '烟台万华化学集团股份有限公司',
    title: '万华化学2027届校园招聘',
    kind: '招聘公告',
    published_at: '2026-09-14',
    cities: ['烟台'],
  };

  const merged = mergeDuplicateOpportunities([jobSdu, jobUpc, jobDifferent]);
  assert.equal(merged.length, 2);

  const sinopecJob = merged.find((j) => j.company.includes('中国石化'));
  assert.ok(sinopecJob);
  assert.ok(sinopecJob.cities.includes('济南'));
  assert.ok(sinopecJob.cities.includes('青岛'));
  assert.equal(sinopecJob.application_url, 'https://job.sinopec.com/apply');
  assert.equal(sinopecJob.source || sinopecJob.source_id, 'sdu');
  assert.equal(sinopecJob.duplicate_sources?.length, 1);
  assert.equal(sinopecJob.duplicate_sources[0].source, 'upc');
});

void test('mergeDuplicateOpportunities does not incorrectly merge different specific positions', () => {
  const posA: Job = {
    ...job,
    id: 'pos-1',
    source_id: 'sdu',
    source: 'sdu',
    company: '歌尔股份有限公司',
    title: '声学算法工程师',
    kind: '具体岗位',
    cities: ['潍坊'],
  };
  const posB: Job = {
    ...job,
    id: 'pos-2',
    source_id: 'upc',
    source: 'upc',
    company: '歌尔股份有限公司',
    title: '嵌入式软件工程师',
    kind: '具体岗位',
    cities: ['潍坊'],
  };

  const merged = mergeDuplicateOpportunities([posA, posB]);
  assert.equal(merged.length, 2);
});


