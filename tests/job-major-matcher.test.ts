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

await test('broad mega-umbrellas on single-role JDs and insurance sales roles do not pollute specific major filters', () => {
  const hisenseHr = fixtureJob({
    title: '海信集团 · 人力资源管理(J44684)',
    company: '海信集团',
    kind: '具体岗位',
    majors: ['经管类'],
  });
  const hisenseProductStrategy = fixtureJob({
    title: '海信集团 · 产品策略(J44685)',
    company: '海信集团',
    kind: '具体岗位',
    majors: ['经管类'],
  });
  const hisenseFinanceWithMarketingDept = fixtureJob({
    title: '海信集团 · 全国营销中心-财务管理(J44699)',
    company: '海信集团',
    kind: '具体岗位',
    majors: ['经管类'],
  });
  const multiRoleCampusNotice = fixtureJob({
    title: '某大型控股集团2027校园招聘公告',
    company: '某大型控股集团',
    kind: '招聘公告',
    majors: ['经管类', '理工类'],
  });
  const insuranceSales = fixtureJob({
    title: '人保财险-湖南分公司-商团客户经理岗',
    company: '中国人民财产保险股份有限公司',
    kind: '具体岗位',
    sectors: ['保险'],
    majors: undefined,
  });
  const bankTeller = fixtureJob({
    title: '齐鲁银行 · 综合柜员',
    company: '齐鲁银行',
    kind: '具体岗位',
    sectors: ['银行'],
    majors: undefined,
  });
  const foreignTradeSalesArts = fixtureJob({
    title: '某外贸公司 · 国际贸易销售',
    company: '某外贸公司',
    kind: '具体岗位',
    majors: ['文科'],
  });

  assert.equal(extractRolePortionFromJobTitle(hisenseHr), '人力资源管理');
  assert.equal(extractRolePortionFromJobTitle(hisenseFinanceWithMarketingDept), '财务管理');
  assert.equal(extractRolePortionFromJobTitle(insuranceSales), '商团客户经理岗');

  for (const major of ['资产评估', '会计', '经济学', '金融']) {
    assert.equal(jobMatchesMajor(hisenseHr, major), false, `HR with 经管类 should not match ${major}`);
    assert.equal(jobMatchesMajor(hisenseProductStrategy, major), false, `产品策略 with 经管类 should not match ${major}`);
    assert.equal(jobMatchesMajor(insuranceSales, major), false, `insurance sales without majors should not match ${major}`);
    assert.equal(jobMatchesMajor(multiRoleCampusNotice, major), true, `multi-role 招聘公告 with 经管类 should match ${major}`);
    assert.equal(jobMatchesMajor(bankTeller, major), true, `bank 综合柜员 should match ${major}`);
  }

  assert.equal(jobMatchesMajor(hisenseHr, '管理'), true);
  assert.equal(jobMatchesMajor(hisenseHr, '人力资源'), true);
  assert.equal(jobMatchesMajor(hisenseHr, '会计 人力资源'), true);
  assert.equal(jobMatchesMajor(hisenseProductStrategy, '管理'), true);

  assert.equal(jobMatchesMajor(hisenseFinanceWithMarketingDept, '资产评估'), true);
  assert.equal(jobMatchesMajor(hisenseFinanceWithMarketingDept, '会计'), true);
  assert.equal(
    jobMatchesMajor({ ...hisenseFinanceWithMarketingDept, majors: undefined }, '市场营销'),
    false,
  );

  assert.equal(jobMatchesMajor(foreignTradeSalesArts, '汉语言'), false);
  assert.equal(jobMatchesMajor(foreignTradeSalesArts, '英语'), true);

  // Compound-word substring trap guards: 物资管理 != 资管, 设备保全 != 财产保全, 外国语言文学类 != 汉语言文学类
  const materialMgmt = fixtureJob({
    title: '中建某局 · 物资管理',
    company: '中建某局',
    kind: '招聘公告',
    majors: ['材料', '物流'],
  });
  assert.equal(jobMatchesMajor(materialMgmt, '资产评估'), false);
  assert.equal(jobMatchesMajor(materialMgmt, '金融'), false);
  assert.equal(jobMatchesMajor(materialMgmt, '物流'), true);

  assert.equal(
    jobMatchesMajor(fixtureJob({ title: '某工厂 · 设备保全员', company: '某工厂' }), '法学'),
    false,
  );
  assert.equal(
    jobMatchesMajor(fixtureJob({ title: '某银行 · 资产保全岗', company: '某银行' }), '法学'),
    true,
  );
  assert.equal(
    jobMatchesMajor(fixtureJob({ title: '某建设公司 · 工程预结算员', company: '某建设公司' }), '会计'),
    false,
  );
  assert.equal(
    jobMatchesMajor(
      fixtureJob({ title: '某外贸企业 · 国际贸易销售', company: '某外贸企业', majors: ['外国语言文学类'] }),
      '汉语言',
    ),
    false,
  );
  assert.equal(
    jobMatchesMajor(
      fixtureJob({ title: '某中学 · 教师招聘', company: '某中学', majors: ['文学类'] }),
      '汉语言',
    ),
    true,
  );
});

await test('P1 major precision: per-language isolation, HR 招聘 guard, MOE codes, professional master suffixes, 临床医学, and short-stem guard', () => {
  // 1. Per-language isolation: 日语 must NOT match 英语/俄语 jobs, while 外语类/小语种 umbrella matches upward
  const englishJob = fixtureJob({ title: '某外贸企业 · 英语翻译', company: '某外贸企业', majors: ['英语', '商务英语'] });
  const japaneseJob = fixtureJob({ title: '某日企 · 日语担当', company: '某日企', majors: ['日语'] });
  const russianRoleOnly = fixtureJob({ title: '某能源企业 · 俄语商务经理', company: '某能源企业' });
  const umbrellaForeignJob = fixtureJob({ title: '某跨境电商 · 海外管培生', company: '某跨境电商', majors: ['外语类', '小语种'] });

  assert.equal(jobMatchesMajor(japaneseJob, '日语'), true);
  assert.equal(jobMatchesMajor(englishJob, '日语'), false);
  assert.equal(jobMatchesMajor(russianRoleOnly, '日语'), false);
  assert.equal(jobMatchesMajor(japaneseJob, '英语'), false);
  assert.equal(jobMatchesMajor(umbrellaForeignJob, '日语'), true);
  assert.equal(jobMatchesMajor(umbrellaForeignJob, '俄语'), true);

  // 2. HR bare "招聘" guard: generic recruitment titles must NOT trigger HR role fallback
  const genericCampus = fixtureJob({ title: '某智能装备有限公司2027校园招聘', company: '某智能装备有限公司' });
  const realHrRecruiter = fixtureJob({ title: '某智能装备有限公司 · 招聘专员', company: '某智能装备有限公司' });
  assert.equal(jobMatchesMajor(genericCampus, '人力资源管理'), false);
  assert.equal(jobMatchesMajor(realHrRecruiter, '人力资源管理'), true);

  // 3. MOE 4-6 digit discipline codes & professional master's suffixes
  const moeCodedJob = fixtureJob({
    title: '某研究所2027公开招聘',
    company: '某研究所',
    majors: ['0812计算机科学与技术', '020204金融学'],
  });
  assert.equal(jobMatchesMajor(moeCodedJob, '081200计算机科学与技术'), true);
  assert.equal(jobMatchesMajor(moeCodedJob, '金融硕士'), true);

  const mpaccTarget = fixtureJob({ title: '某国企 · 财务审计岗', company: '某国企', majors: ['会计学', '审计学'] });
  const eieTarget = fixtureJob({ title: '某通信公司 · 硬件研发岗', company: '某通信公司', majors: ['通信工程', '电子信息工程'] });
  assert.equal(jobMatchesMajor(mpaccTarget, '会计硕士'), true);
  assert.equal(jobMatchesMajor(eieTarget, '电子信息硕士'), true);

  // 4. 临床医学 profile & <2-char stem guard ("化学" / "理学" must not strip "学" into 1-char "化" / "理")
  const hospitalSurgeon = fixtureJob({
    title: '某三甲医院 · 外科医师',
    company: '某三甲医院',
    majors: ['临床医学', '外科学'],
  });
  assert.equal(jobMatchesMajor(hospitalSurgeon, '临床医学'), true);
  assert.equal(jobMatchesMajor(englishJob, '临床医学'), false);

  const unrelatedCultureRole = fixtureJob({ title: '某传媒公司 · 企业文化专员', company: '某传媒公司' });
  const unrelatedAdminRole = fixtureJob({ title: '某制造公司 · 总经理助理', company: '某制造公司' });
  assert.equal(jobMatchesMajor(unrelatedCultureRole, '化学'), false);
  assert.equal(jobMatchesMajor(unrelatedAdminRole, '理学'), false);
});

await test('finance major recalls financial institution notices & corporate treasury/FP&A roles, and supports includeUnstatedMajor', () => {
  // 1. Licensed financial institution general notices without extracted majors match 金融 & 经济学
  const cmbCampusNotice = fixtureJob({
    id: 'a1a1a1a1a1a1a1a1a1a1',
    kind: '招聘公告',
    title: '招商银行（多地）分行2027冬季校园招聘',
    company: '招商银行',
    sectors: ['银行'],
    majors: undefined,
  });
  const securitiesNotice = fixtureJob({
    id: 'b2b2b2b2b2b2b2b2b2b2',
    kind: '招聘公告',
    title: '中泰证券2027届秋招招聘',
    company: '中泰证券',
    majors: undefined,
  });
  const insuranceGeneralNotice = fixtureJob({
    id: 'c3c3c3c3c3c3c3c3c3c3',
    kind: '招聘公告',
    title: '中国人寿山东省分公司2027校园招聘公告',
    company: '中国人寿山东省分公司',
    sectors: ['保险'],
    majors: undefined,
  });
  const bankItSpecialNotice = fixtureJob({
    id: 'd4d4d4d4d4d4d4d4d4d4',
    kind: '招聘公告',
    title: '招商银行信用卡中心 · 软件研发专项招聘',
    company: '招商银行信用卡中心',
    sectors: ['银行'],
    majors: undefined,
  });
  const bankExplicitCsNotice = fixtureJob({
    id: 'e5e5e5e5e5e5e5e5e5e5',
    kind: '招聘公告',
    title: '某银行金融科技子公司2027校园招聘公告',
    company: '某银行金融科技子公司',
    sectors: ['银行'],
    majors: ['计算机科学与技术', '软件工程'],
  });

  assert.equal(jobMatchesMajor(cmbCampusNotice, '金融'), true);
  assert.equal(jobMatchesMajor(cmbCampusNotice, '经济学'), true);
  assert.equal(jobMatchesMajor(securitiesNotice, '金融'), true);
  assert.equal(jobMatchesMajor(insuranceGeneralNotice, '金融'), true);
  // Off-track IT role in notice title or explicit CS majors must still be blocked
  assert.equal(jobMatchesMajor(bankItSpecialNotice, '金融'), false);
  assert.equal(jobMatchesMajor(bankExplicitCsNotice, '金融'), false);

  // 2. Corporate treasury / financial analysis / finance MT roles match 金融
  const treasuryRole = fixtureJob({ title: '某集团 · 资金管理岗', company: '某集团', kind: '具体岗位' });
  const fpaRole = fixtureJob({ title: '某实业公司 · 财务分析专员', company: '某实业公司', kind: '具体岗位' });
  const financeMtNotice = fixtureJob({
    title: '济南优然牧业有限责任公司招聘',
    company: '济南优然牧业有限责任公司',
    kind: '招聘公告',
    sample_positions: ['人事行政管培生', '财务管培生'],
  });
  const cashierRole = fixtureJob({ title: '某电力公司 · 出纳', company: '某电力公司', kind: '具体岗位', majors: ['财务会计'] });

  assert.equal(jobMatchesMajor(treasuryRole, '金融'), true);
  assert.equal(jobMatchesMajor(fpaRole, '金融'), true);
  assert.equal(jobMatchesMajor(financeMtNotice, '金融'), true);
  assert.equal(jobMatchesMajor(cashierRole, '金融'), false);

  // 3. includeUnstatedMajor recalls general 招聘公告 without majors while blocking blank 具体岗位 & off-track notices
  const soeGeneralNotice = fixtureJob({
    id: 'f6f6f6f6f6f6f6f6f6f6',
    kind: '招聘公告',
    title: '山东海洋集团有限公司2027届校园招聘公告',
    company: '山东海洋集团',
    majors: undefined,
  });
  const blankWelderRole = fixtureJob({
    id: '07070707070707070707',
    kind: '具体岗位',
    title: '某机械厂 · 焊工',
    company: '某机械厂',
    majors: undefined,
  });
  const stemNotice = fixtureJob({
    id: '08080808080808080808',
    kind: '招聘公告',
    title: '山推工程机械股份有限公司招聘',
    company: '山推工程机械股份有限公司',
    majors: ['机械工程', '电气工程'],
  });

  assert.equal(
    filterJobs([soeGeneralNotice, blankWelderRole, stemNotice], { ...allCitiesFilter, major: '金融' }, {}, null, now).length,
    0,
  );
  const withUnstated = filterJobs(
    [soeGeneralNotice, blankWelderRole, stemNotice, bankItSpecialNotice],
    { ...allCitiesFilter, major: '金融', includeUnstatedMajor: true },
    {},
    null,
    now,
  );
  assert.deepEqual(
    withUnstated.map((j) => j.id),
    ['f6f6f6f6f6f6f6f6f6f6'],
  );

  // URL / storage round-trip & 17-item countActiveFilters contract
  const custom = { ...defaultFilters, major: '金融', includeUnlimitedMajor: true, includeUnstatedMajor: true };
  const query = formatUrlQuery(custom);
  assert.ok(query.includes('includeUnstatedMajor=1'));
  const parsed = parseUrlState(query);
  assert.equal(parsed.filters?.includeUnstatedMajor, true);
  assert.equal(restoreBrowsing({ filters: custom }).filters.includeUnstatedMajor, true);
  assert.equal(resetFilters(custom).includeUnstatedMajor, false);
  assert.equal(countActiveFilters(custom), 2); // default 济南 + major
});

await test('nonprofit/charitable foundations never match finance or economics as financial institutions, while licensed fund companies still match', () => {
  const publicFoundation = fixtureJob({
    id: 'f001f001f001f001f001',
    kind: '招聘公告',
    title: '某公益基金会 2027 校园招聘',
    company: '某公益基金会',
    sectors: ['企业 / 其他'],
    majors: undefined,
  });
  const emptyCompanyFoundation = fixtureJob({
    id: 'f002f002f002f002f002',
    kind: '招聘公告',
    title: '北京立德未来助学公益基金会招聘',
    company: '',
    sectors: ['企业 / 其他'],
    majors: undefined,
  });
  const eduFoundationRole = fixtureJob({
    id: 'f003f003f003f003f003',
    kind: '具体岗位',
    title: '某大学教育发展基金会 · 基金会项目专员',
    company: '某大学教育发展基金会',
    sectors: ['企业 / 其他'],
    majors: undefined,
  });
  const huaxiaFund = fixtureJob({
    id: 'f004f004f004f004f004',
    kind: '招聘公告',
    title: '华夏基金管理有限公司 2027 校园招聘',
    company: '华夏基金管理有限公司',
    sectors: ['企业 / 其他'],
    majors: undefined,
  });

  for (const major of ['金融', '经济学']) {
    assert.equal(jobMatchesMajor(publicFoundation, major), false, `public foundation must not match ${major}`);
    assert.equal(jobMatchesMajor(emptyCompanyFoundation, major), false, `title-only foundation must not match ${major}`);
    assert.equal(jobMatchesMajor(eduFoundationRole, major), false, `foundation project role must not match ${major}`);
    assert.equal(jobMatchesMajor(huaxiaFund, major), true, `licensed fund manager must match ${major}`);
  }
});
