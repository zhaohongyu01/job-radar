import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractProseMajorsFromText,
  extractProseSamplePositions,
  extractRolePortionFromJobTitle,
  jobMatchesMajor,
  positionMatchesMajor,
  resolveJobMajorProfile,
} from '../lib/job-major-matcher.ts';
import { countActiveFilters, defaultFilters, filterJobs, mergeDuplicateOpportunities, resetFilters } from '../lib/jobs.ts';
import { formatUrlQuery, parseUrlState, restoreBrowsing } from '../lib/browsing.ts';
import { projectBrowsingJobs, validateBrowsingJob } from '../lib/browse-index.ts';
import { fixtureJob } from './fixtures/job.ts';

const now = Date.parse('2026-11-12T09:00:00+08:00');
const allCitiesFilter = { ...defaultFilters, city: '全部城市', workCities: [] as string[], year: '全部' };

await test('extractProseMajorsFromText extracts labelled, multiline, related and unlimited majors without duty noise', () => {
  const labelled = extractProseMajorsFromText(
    '任职资格：1、全日制本科及以上学历；2、专业要求：会计学、财务管理、审计学、资产评估等相关专业；3、熟悉国家财经法律法规。',
  );
  assert.deepEqual(labelled, ['会计学', '财务管理', '审计学', '资产评估']);

  const multiline = extractProseMajorsFromText(
    '【专业要求】\n1) 机械类：机械设计制造及其自动化、车辆工程等相关专业\n2) 电气类：电气工程及其自动化、计算机科学与技术\n岗位职责：\n负责产品结构设计与法律法规合规审查。',
  );
  assert.ok(multiline.includes('机械类'));
  assert.ok(multiline.includes('机械设计制造及其自动化'));
  assert.ok(multiline.includes('车辆工程'));
  assert.ok(multiline.includes('电气工程及其自动化'));
  assert.ok(multiline.includes('计算机科学与技术'));
  assert.ok(!multiline.some((m) => m.includes('法律法规') || m.includes('其自动化') && m === '其自动化'));

  const unlimitedWithPreferred = extractProseMajorsFromText(
    '岗位要求：本科及以上学历，专业要求：不限（法学、知识产权相关专业优先）。具备良好的沟通能力及相关专业知识，通过注册会计师等专业资格考试者佳。',
  );
  assert.deepEqual(unlimitedWithPreferred, ['专业不限', '法学', '知识产权']);

  const pureDutyNoise = extractProseMajorsFromText(
    '岗位职责：1. 严格遵守国家法律法规及公司财务管理制度；2. 负责固定资产盘点管理，提升项目经济效益；3. 具备扎实的专业知识与专业技能。',
  );
  assert.deepEqual(pureDutyNoise, []);
});

await test('extractRolePortionFromJobTitle strips company names so company industry words do not cause false role hits', () => {
  assert.equal(
    extractRolePortionFromJobTitle({
      title: '青岛数能电气工程有限公司-招聘信息',
      company: '青岛数能电气工程有限公司',
    }),
    '',
  );
  assert.equal(
    extractRolePortionFromJobTitle({
      title: '海南省人力资源开发局（海南省就业局）2027校园招聘公告',
      company: '海南省人力资源开发局（海南省就业局）',
    }),
    '',
  );
  assert.equal(
    extractRolePortionFromJobTitle({
      title: '上海浦东发展银行股份有限公司青岛分行 · 管理培训生（通用方向）',
      company: '上海浦东发展银行股份有限公司青岛分行',
    }),
    '管理培训生（通用方向）',
  );
});

await test('3-tier asymmetric matching works accurately for 资产评估, 会计, 经济学, 管理 and 法学', () => {
  // 1. 资产评估: matches direct, sibling 财会/审计/税务/投资, upward 财经类/经管类/工商管理类, and role fallback
  assert.equal(
    jobMatchesMajor(fixtureJob({ title: '某集团招聘', company: '某集团', majors: ['财经类'] }), '资产评估'),
    true,
  );
  assert.equal(
    jobMatchesMajor(fixtureJob({ title: '某集团招聘', company: '某集团', majors: ['工商管理类'] }), '资产评估'),
    true,
  );
  assert.equal(
    jobMatchesMajor(fixtureJob({ title: '某事务所 · 审计助理', company: '某事务所', majors: ['会计学', '财务管理', '审计学'] }), '资产评估'),
    true,
  );
  assert.equal(
    jobMatchesMajor(fixtureJob({ title: '某银行招聘', company: '某银行', majors: ['经济', '金融', '财会', '管理'] }), '资产评估'),
    true,
  );
  assert.equal(
    jobMatchesMajor(fixtureJob({ title: '某评估公司 · 资产评估项目助理', company: '某评估公司' }), '资产评估'),
    true,
  );
  // Asymmetric guardrails for 资产评估: must NOT match 人力资源管理, 经济学+法学 only, or 土木+工程造价
  assert.equal(
    jobMatchesMajor(fixtureJob({ title: '某公司 · 人事专员', company: '某公司', majors: ['人力资源管理'] }), '资产评估'),
    false,
  );
  assert.equal(
    jobMatchesMajor(fixtureJob({ title: '某机构招聘', company: '某机构', majors: ['经济学', '法学'] }), '资产评估'),
    false,
  );
  assert.equal(
    jobMatchesMajor(fixtureJob({ title: '某建筑局招聘', company: '某建筑局', majors: ['土木工程', '工程造价'] }), '资产评估'),
    false,
  );
  // Explicit unrelated major blocks role-word fallback
  assert.equal(
    jobMatchesMajor(fixtureJob({ title: '某装备厂 · 资产管理工程师', company: '某装备厂', majors: ['机械工程'] }), '资产评估'),
    false,
  );

  // 2. 经济学: matches 理论/应用经济/财政税收/金融/国贸 + 经济金融类 + 银行客户经理, blocks 制造厂销售客户经理
  assert.equal(
    jobMatchesMajor(fixtureJob({ title: '某国企招聘', company: '某国企', majors: ['国际经济与贸易', '财政学'] }), '经济学'),
    true,
  );
  assert.equal(
    jobMatchesMajor(fixtureJob({ title: '齐鲁银行 · 客户经理', company: '齐鲁银行', sectors: ['银行'] }), '经济学'),
    true,
  );
  assert.equal(
    jobMatchesMajor(fixtureJob({ title: '某重工机械有限公司 · 客户经理', company: '某重工机械有限公司', sectors: ['企业 / 其他'] }), '经济学'),
    false,
  );

  // 3. 管理: matches management sub-majors and 管培/HR/行政/运营/供应链, blocks 仓库管理员 / 设备管理工程师 / 人力资源局空标题
  assert.equal(
    jobMatchesMajor(fixtureJob({ title: '某集团招聘', company: '某集团', majors: ['工商管理', '物流管理'] }), '管理'),
    true,
  );
  assert.equal(
    jobMatchesMajor(fixtureJob({ title: '某快消 · 2027届管理培训生', company: '某快消' }), '管理'),
    true,
  );
  assert.equal(
    jobMatchesMajor(fixtureJob({ title: '某工厂 · 仓库管理员', company: '某工厂' }), '管理'),
    false,
  );
  assert.equal(
    jobMatchesMajor(fixtureJob({ title: '某工厂 · 设备管理工程师', company: '某工厂' }), '管理'),
    false,
  );
  assert.equal(
    jobMatchesMajor(fixtureJob({ title: '海南省人力资源开发局招聘', company: '海南省人力资源开发局' }), '管理'),
    false,
  );

  // 4. 法学: matches 知识产权/纪检监察/法律合规/法务专员, blocks compliance duty prose
  assert.equal(
    jobMatchesMajor(fixtureJob({ title: '某科技公司 · 知识产权专员', company: '某科技公司' }), '法学'),
    true,
  );
  assert.equal(
    jobMatchesMajor(
      fixtureJob({
        title: '某公司 · 质量体系专员',
        company: '某公司',
        excerpt: '岗位职责：确保产品符合国家相关法律法规要求。',
      }),
      '法学',
    ),
    false,
  );

  assert.ok(resolveJobMajorProfile('资产评估').summaryHint.includes('资产评估'));
});

await test('filterJobs decouples major from includeUncertain, supports includeUnlimitedMajor, and preserves same-position row alignment', () => {
  const blankUnrelated = fixtureJob({ id: '11111111111111111111', title: '某机械厂 · 焊工', company: '某机械厂' });
  const unlimitedGeneric = fixtureJob({
    id: '22222222222222222222',
    title: '某连锁 · 门店储备店长',
    company: '某连锁',
    majors: ['专业不限'],
  });
  const unlimitedTargetRole = fixtureJob({
    id: '33333333333333333333',
    title: '某律所 · 法务助理',
    company: '某律所',
    majors: ['专业不限'],
  });
  const multiRowJob = fixtureJob({
    id: '44444444444444444444',
    title: '某集团2027校招',
    company: '某集团',
    cities: ['北京', '济南'],
    position_matches: [
      { name: '研发岗', city: '北京', majors: ['计算机科学与技术'], education: '本科', cohort: '2027' },
      { name: '财务审计岗', city: '济南', majors: ['财经类'], education: '本科', cohort: '2027' },
    ],
  });

  // Even with includeUncertain: true, blank unrelated jobs are NEVER dumped into active major filter
  const lawStrict = filterJobs(
    [blankUnrelated, unlimitedGeneric, unlimitedTargetRole],
    { ...allCitiesFilter, major: '法学', includeUncertain: true, includeUnlimitedMajor: false },
    {},
    null,
    now,
  );
  assert.deepEqual(
    lawStrict.map((j) => j.id),
    ['33333333333333333333'],
  );

  // Turning on includeUnlimitedMajor brings in explicit 专业不限 positions while still excluding blank unrelated jobs
  const lawWithUnlimited = filterJobs(
    [blankUnrelated, unlimitedGeneric, unlimitedTargetRole],
    { ...allCitiesFilter, major: '法学', includeUncertain: true, includeUnlimitedMajor: true },
    {},
    null,
    now,
  );
  assert.deepEqual(
    lawWithUnlimited.map((j) => j.id),
    ['22222222222222222222', '33333333333333333333'],
  );

  // Same-position row alignment: 北京 only has 计算机科学与技术, 济南 has 财经类 (eligible for 资产评估)
  assert.equal(
    filterJobs([multiRowJob], { ...allCitiesFilter, workCities: ['北京'], major: '资产评估' }, {}, null, now).length,
    0,
  );
  assert.equal(
    filterJobs([multiRowJob], { ...allCitiesFilter, workCities: ['济南'], major: '资产评估' }, {}, null, now).length,
    1,
  );
  assert.equal(positionMatchesMajor(multiRowJob.position_matches![0], '资产评估'), false);
  assert.equal(positionMatchesMajor(multiRowJob.position_matches![1], '资产评估'), true);
});

await test('browsing URL/storage state round-trips includeUnlimitedMajor and preserves 17-item active filter count', () => {
  const custom = { ...defaultFilters, major: '资产评估', includeUnlimitedMajor: true };
  const query = formatUrlQuery(custom);
  assert.ok(query.includes('includeUnlimitedMajor=1'));
  const parsed = parseUrlState(query);
  assert.equal(parsed.filters?.major, '资产评估');
  assert.equal(parsed.filters?.includeUnlimitedMajor, true);

  const restored = restoreBrowsing({ filters: custom }).filters;
  assert.equal(restored.includeUnlimitedMajor, true);

  const reset = resetFilters(custom);
  assert.equal(reset.major, '');
  assert.equal(reset.includeUnlimitedMajor, false);
  assert.equal(countActiveFilters(defaultFilters), 1);
});

await test('projectBrowsingJobs enriches prose majors and sample_positions from fullText while remaining idempotent', () => {
  const raw = fixtureJob({
    id: '55555555555555555555',
    kind: '招聘公告',
    title: '鲁信某投资公司2027校园招聘公告',
    company: '鲁信某投资公司',
    excerpt: '面向2027届应届毕业生公开招聘。',
  });
  const fullText = {
    [raw.id]: '招聘岗位：资产评估岗、财务管理岗、法务合规岗\n专业要求：资产评估、会计学、财务管理、法学等相关专业。',
  };
  const { jobs } = projectBrowsingJobs([raw], fullText);
  assert.equal(jobs.length, 1);
  validateBrowsingJob(jobs[0]);
  assert.deepEqual(jobs[0].majors, ['资产评估', '会计学', '财务管理', '法学']);
  assert.deepEqual(jobs[0].sample_positions, ['资产评估岗', '财务管理岗', '法务合规岗']);
  assert.deepEqual(mergeDuplicateOpportunities(jobs), jobs);
  assert.deepEqual(extractProseSamplePositions(fullText[raw.id]), ['资产评估岗', '财务管理岗', '法务合规岗']);
});
