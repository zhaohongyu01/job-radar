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
  getLifecycleStage,
  generateJobTimeline,
  isExpired,
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

void test('locationMatch handles province branch and expanded detailLocation labels', () => {
  const provBranchJob: Job = {
    ...job,
    cities: [],
    location_evidence: ['工作地点：山东省各分支机构（标题/单位明确机构）'],
  };
  assert.equal(locationMatch(provBranchJob, '济南'), 'possible');
  assert.equal(locationMatch(provBranchJob, '青岛'), 'possible');
  assert.equal(locationMatch(provBranchJob, '广州'), 'none');

  const orgJob: Job = {
    ...job,
    cities: [],
    location_evidence: ['招聘机构：济南市分行、淄博市分行'],
  };
  assert.equal(locationMatch(orgJob, '济南'), 'exact');
  assert.equal(locationMatch(orgJob, '淄博'), 'exact');
  assert.equal(locationMatch(orgJob, '青岛'), 'none');

  const locJob: Job = {
    ...job,
    cities: [],
    location_evidence: ['意向工作地：青岛市'],
  };
  assert.equal(locationMatch(locJob, '青岛'), 'exact');
  assert.equal(locationMatch(locJob, '济南'), 'none');

  const empLocJob: Job = {
    ...job,
    cities: [],
    location_evidence: ['用人单位所在地：青岛市'],
  };
  assert.equal(locationMatch(empLocJob, '青岛'), 'unknown');
});

void test('personalFor preserves duplicate saved status when master has readAt', () => {
  const masterJob: Job = { ...job, id: 'master-1', duplicate_ids: ['dup-1'] };
  const personal = {
    'dup-1': { saved: true },
    'master-1': { readAt: '2026-09-14T10:00:00.000Z' },
  };
  const status = personalFor(masterJob, personal);
  assert.equal(status.saved, true, '副记录的收藏状态不能被主记录的已读状态抹掉');
  assert.equal(status.readAt, '2026-09-14T10:00:00.000Z');
});

void test('parseSalaryRange converts annual salary in text and salary_desc sorts correctly', () => {
  const annualJob: Job = {
    ...job,
    title: '某央企科技管培生',
    excerpt: '薪资待遇：80000-120000元/年，提供五险一金',
  };
  const parsed = parseSalaryRange(annualJob);
  assert.ok(parsed);
  assert.equal(parsed.min, Math.round(80000 / 12));
  assert.equal(parsed.max, Math.round(120000 / 12));

  // Sorting test: 30k-40k/月 should rank above 6000元以上
  const jobHighSalary: Job = { ...job, id: 'high-1', title: '高薪架构师（30k-40k）' };
  const jobAboveSalary: Job = { ...job, id: 'above-1', title: '初级助理 6000元以上' };
  const sorted = filterJobs([jobAboveSalary, jobHighSalary], { ...defaultFilters, sort: 'salary_desc' }, {}, null);
  assert.equal(sorted[0].id, 'high-1', '30k-40k 应当排在 6000元以上 前面');
});

void test('mergeDuplicateOpportunities keeps supplemental recruitment separate from regular campus recruitment', () => {
  const regJob: Job = {
    ...job,
    id: 'reg-a',
    title: '字节跳动2027届秋季校园招聘',
    company: '北京字节跳动科技有限公司',
    kind: '招聘公告',
    types: ['校招'],
    graduation_years: ['2027'],
  };
  const suppJob: Job = {
    ...job,
    id: 'supp-a',
    title: '字节跳动2027届秋招补录公告',
    company: '北京字节跳动科技有限公司',
    kind: '招聘公告',
    types: ['校招'],
    graduation_years: ['2027'],
  };
  const merged = mergeDuplicateOpportunities([regJob, suppJob]);
  assert.equal(merged.length, 2, '秋招补录公告不应与原秋招公告合并');
});

void test('filterJobs matches queries against specific position names and majors from position tables', () => {
  const noticeJob: Job = {
    ...job,
    id: 'pos-job-1',
    title: '某大型国有企业2027校园招聘公告',
    company: '大型国企集团',
    positions: [
      {
        name: '集成电路EDA算法开发工程师',
        majors: ['微电子科学与工程', '集成电路设计'],
        education: '硕士研究生',
        city: '济南',
        count: '5人',
      },
      {
        name: '审计风控专员',
        majors: ['审计学', '财务管理'],
        education: '本科及以上',
        city: '青岛',
        count: '2人',
      },
    ],
    position_count: 2,
    sample_positions: ['集成电路EDA算法开发工程师', '审计风控专员'],
    majors: ['微电子科学与工程', '集成电路设计', '审计学', '财务管理'],
  };

  // Search by specific major inside position table
  const resultsByMajor = filterJobs([noticeJob], { ...defaultFilters, city: '全部城市', query: '微电子' }, {}, null);
  assert.equal(resultsByMajor.length, 1, '应根据岗位表中的需求专业命中公告');

  // Search by specific position title inside position table
  const resultsByPos = filterJobs([noticeJob], { ...defaultFilters, city: '全部城市', query: 'EDA算法' }, {}, null);
  assert.equal(resultsByPos.length, 1, '应根据岗位表中的具体职位名称命中公告');

  // Unrelated keyword should not match
  const resultsUnrelated = filterJobs([noticeJob], { ...defaultFilters, city: '全部城市', query: '临床医学' }, {}, null);
  assert.equal(resultsUnrelated.length, 0, '不包含的专业不应命中');
});

void test('mergeDuplicateOpportunities merges positions and majors across channels', () => {
  const jobChan1: Job = {
    ...job,
    id: 'chan-1',
    title: '海尔智家2027届校园招聘',
    company: '海尔智家股份有限公司',
    kind: '招聘公告',
    types: ['校招'],
    graduation_years: ['2027'],
    positions: [
      { name: '嵌入式软件工程师', majors: ['电子信息', '计算机'], city: '青岛' },
    ],
    position_count: 1,
    majors: ['电子信息', '计算机'],
  };
  const jobChan2: Job = {
    ...job,
    id: 'chan-2',
    title: '海尔智家2027届校园招聘简章',
    company: '海尔智家股份有限公司',
    kind: '招聘公告',
    types: ['校招'],
    graduation_years: ['2027'],
    positions: [
      { name: '海外电商运营', majors: ['国际经济与贸易', '英语'], city: '青岛' },
    ],
    position_count: 1,
    majors: ['国际经济与贸易', '英语'],
  };

  const merged = mergeDuplicateOpportunities([jobChan1, jobChan2]);
  assert.equal(merged.length, 1, '同企业同批次应合并');
  assert.equal(merged[0].position_count, 2, '两渠道不同的岗位明细应合并保留');
  assert.equal(merged[0].positions?.length, 2);
  assert.ok(merged[0].majors?.includes('电子信息'));
  assert.ok(merged[0].majors?.includes('国际经济与贸易'));
});

void test('getLifecycleStage computes accurate stage labels and badges', () => {
  const now = Date.parse('2026-09-14T10:00:00+08:00');

  // 1. Expired
  const expJob: Job = { ...job, deadline: '2026-09-10' };
  assert.equal(getLifecycleStage(expJob, now).stage, 'expired');
  assert.equal(getLifecycleStage(expJob, now).badge, '已截止');

  // 2. Expiring soon (within 3 days)
  const soonJob: Job = { ...job, deadline: '2026-09-16' };
  assert.equal(getLifecycleStage(soonJob, now).stage, 'expiring_soon');
  assert.ok(getLifecycleStage(soonJob, now).badge.includes('剩 2 天截止'));

  // 3. Extended deadline
  const extJob: Job = {
    ...job,
    title: '关于延长2027年秋季校园招聘报名时间的通知',
    deadline: '2026-10-15',
  };
  assert.equal(getLifecycleStage(extJob, now).stage, 'extended');
  assert.equal(getLifecycleStage(extJob, now).badge, '🔔 截止延期');

  // 4. Supplemental
  const suppJob: Job = {
    ...job,
    title: '某国企2027校招春季补录公告',
    deadline: '2026-10-30',
  };
  assert.equal(getLifecycleStage(suppJob, now).stage, 'supplemental');
  assert.equal(getLifecycleStage(suppJob, now).badge, '🔥 补录招募');

  // 5. Selection stage
  const selJob: Job = {
    ...job,
    title: '某科技公司2027校招笔试面试考核安排通知',
    deadline: '2026-10-30',
  };
  assert.equal(getLifecycleStage(selJob, now).stage, 'selection');
  assert.equal(getLifecycleStage(selJob, now).badge, '📢 考核阶段');

  // 6. Regular accepting
  const normalJob: Job = {
    ...job,
    title: '某科技公司2027秋季校园招聘启事',
    deadline: '2026-10-30',
  };
  assert.equal(getLifecycleStage(normalJob, now).stage, 'accepting');
  assert.equal(getLifecycleStage(normalJob, now).badge, '✨ 网申中');
});

void test('generateJobTimeline synthesizes chronological events and current status', () => {
  const testJob: Job = {
    ...job,
    source_name: '山东大学就业网',
    published_at: '2026-09-01',
    deadline: '2026-09-25',
    position_count: 5,
    duplicate_sources: [
      {
        source_name: '南开大学就业网',
        url: 'https://nankai.example/job',
        title: '南开大学就业网',
        published_at: '2026-09-08',
      },
    ],
    recent_change: {
      type: 'deadline_extended',
      label: '截止延期',
      date: '2026-09-10',
      detail: '报名截止时间延长至 2026-09-25',
    },
  };

  const timeline = generateJobTimeline(testJob, Date.parse('2026-09-14T10:00:00+08:00'));
  assert.ok(timeline.length >= 4, '应生成包含首发、跨渠道发布、变更及当前状态的时间线');

  const types = timeline.map((e) => e.type);
  assert.ok(types.includes('published'), '应包含首次发布');
  assert.ok(types.includes('source_repost'), '应包含跨校发布');
  assert.ok(types.includes('deadline_extended'), '应包含截止延期');

  const lastNode = timeline[timeline.length - 1];
  assert.equal(lastNode.date, '当前状态');
  assert.ok(lastNode.detail.includes('还剩'));
});

void test('filterJobs filters opportunities by changeType', () => {
  const now = Date.parse('2026-09-14T10:00:00+08:00');

  const normalJob: Job = {
    ...job,
    id: 'norm-1',
    title: '浪潮集团2027校园招聘启事',
    published_at: '2026-09-01',
    deadline: '2026-10-30',
  };
  const extendedJob: Job = {
    ...job,
    id: 'ext-1',
    title: '海信集团2027校招报名延期公告',
    deadline: '2026-10-15',
    recent_change: {
      type: 'deadline_extended',
      label: '截止延期',
      date: '2026-09-10',
      detail: '报名时间延长至10-15',
    },
  };
  const suppJob: Job = {
    ...job,
    id: 'supp-1',
    title: '重汽集团2027秋招补录公告',
    deadline: '2026-10-20',
  };

  const jobsList = [normalJob, extendedJob, suppJob];

  // 1. 全部
  const all = filterJobs(jobsList, { ...defaultFilters, city: '全部城市', changeType: '全部' }, {}, null, now);
  assert.equal(all.length, 3);

  // 2. 有变更
  const changed = filterJobs(jobsList, { ...defaultFilters, city: '全部城市', changeType: '有变更' }, {}, null, now);
  assert.equal(changed.length, 2);
  assert.ok(changed.some((j) => j.id === 'ext-1'));
  assert.ok(changed.some((j) => j.id === 'supp-1'));

  // 3. 截止延期
  const extOnly = filterJobs(jobsList, { ...defaultFilters, city: '全部城市', changeType: '截止延期' }, {}, null, now);
  assert.equal(extOnly.length, 1);
  assert.equal(extOnly[0].id, 'ext-1');

  // 4. 补录招募
  const suppOnly = filterJobs(jobsList, { ...defaultFilters, city: '全部城市', changeType: '补录招募' }, {}, null, now);
  assert.equal(suppOnly.length, 1);
  assert.equal(suppOnly[0].id, 'supp-1');
});

void test('mergeDuplicateOpportunities and generateJobTimeline strictly produce only one 首次发布', () => {
  const jobSdu: Job = {
    ...job,
    id: 'sdu-goertek',
    company: '歌尔股份有限公司',
    title: '歌尔股份2027全球校园招聘启事',
    source_name: '山东大学就业信息网',
    source_url: 'https://job.sdu.edu.cn/detail/1',
    published_at: '2026-09-07',
    timeline: [
      {
        date: '2026-09-07',
        type: 'published',
        title: '首次发布',
        detail: '来源于 山东大学就业信息网',
        source: '山东大学就业信息网',
      },
    ],
  };

  const jobUpc: Job = {
    ...job,
    id: 'upc-goertek',
    company: '歌尔股份有限公司',
    title: '歌尔股份2027全球校园招聘启事',
    source_name: '中国石油大学（华东）就业网',
    source_url: 'https://job.upc.edu.cn/detail/2',
    published_at: '2026-09-14',
    timeline: [
      {
        date: '2026-09-14',
        type: 'published',
        title: '首次发布',
        detail: '来源于 中国石油大学（华东）就业网',
        source: '中国石油大学（华东）就业网',
      },
    ],
  };

  const merged = mergeDuplicateOpportunities([jobSdu, jobUpc]);
  assert.equal(merged.length, 1);
  // Published_at must remain the earliest publication date across channels
  assert.equal(merged[0].published_at, '2026-09-07');

  const timeline = generateJobTimeline(merged[0], Date.parse('2026-09-14T10:00:00+08:00'));
  const firstPubEvents = timeline.filter((e) => e.title === '首次发布');
  assert.equal(firstPubEvents.length, 1, '时间线中必须有且仅有一次首次发布');
  assert.equal(firstPubEvents[0].date, '2026-09-07');
  assert.equal(firstPubEvents[0].source, '山东大学就业信息网');

  const repostEvents = timeline.filter((e) => e.title === '跨渠道发布');
  assert.ok(repostEvents.length >= 1, '跨校重复发布必须显示为跨渠道发布');
  assert.equal(repostEvents[0].date, '2026-09-14');
  assert.ok(repostEvents[0].detail.includes('中国石油大学'));
});

void test('long-term recruitment with null deadline remains active and visible even when published > 60 days ago', () => {
  const now = Date.parse('2026-09-14T10:00:00+08:00');
  const longTermJob: Job = {
    ...job,
    id: 'long-term-1',
    title: '某央企研究院长期招募青年科学家及博士后公告',
    published_at: '2026-07-01',
    last_verified_at: '2026-09-14T09:00:00+08:00',
    deadline: null,
    body: '长期招聘，招满为止，目前持续接受简历投递。',
  };

  assert.equal(isExpired(longTermJob, now), false);

  const stage = getLifecycleStage(longTermJob, now);
  assert.notEqual(stage.stage, 'expired');
  assert.ok(stage.label.includes('长期招募中') || stage.badge.includes('长期') || stage.badge.includes('进行中'));

  const filtered = filterJobs([longTermJob], { ...defaultFilters, city: '全部城市' }, {}, null, now);
  assert.equal(filtered.length, 1);
});

void test('radar change filter and filterJobs 有变更 both respect 30-day window and exclude 岗位表就绪', () => {
  const now = Date.parse('2026-09-14T10:00:00+08:00');

  const oldChangeJob: Job = {
    ...job,
    id: 'old-change',
    recent_change: {
      type: 'content_updated',
      label: '正文更新',
      date: '2026-01-10',
      detail: '更新了联系人电话',
    },
  };

  const initialTableJob: Job = {
    ...job,
    id: 'initial-table',
    recent_change: {
      type: 'positions_updated',
      label: '岗位表就绪',
      date: '2026-09-10',
      detail: '提取到 5 个岗位',
    },
  };

  const freshChangeJob: Job = {
    ...job,
    id: 'fresh-change',
    recent_change: {
      type: 'deadline_extended',
      label: '截止延期',
      date: '2026-09-12',
      detail: '截止日期延至10月底',
    },
  };

  const byChangeType = filterJobs(
    [oldChangeJob, initialTableJob, freshChangeJob],
    { ...defaultFilters, city: '全部城市', changeType: '有变更' },
    {},
    null,
    now,
  );
  assert.equal(byChangeType.length, 1);
  assert.equal(byChangeType[0].id, 'fresh-change');

  const byRadarChange = filterJobs(
    [oldChangeJob, initialTableJob, freshChangeJob],
    { ...defaultFilters, city: '全部城市', radarFocus: 'change' },
    {},
    null,
    now,
  );
  assert.equal(byRadarChange.length, 1);
  assert.equal(byRadarChange[0].id, 'fresh-change');
});

