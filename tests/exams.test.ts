import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearExamDetailShardCache,
  computeExamNextStep,
  computeExamStageLabel,
  DEFAULT_EXAM_FILTERS,
  DEFAULT_EXAM_PROFILE,
  deriveExamStage,
  evaluateExamPositionEligibility,
  EXAM_STAGE_OPTIONS,
  examPersonalConflicts,
  filterExams,
  flattenAndFilterExamPositions,
  formatExamUrl,
  isExamOpenForRegistration,
  isExamProfileActive,
  isTerminalTrackStatus,
  loadExamDetailShard,
  loadExamPositionsAsset,
  mergeExamPersonal,
  mergeExamProfile,
  parseExamUrl,
  validateExamPersonal,
  validateExamProfile,
  type ExamAnnouncement,
  type ExamPositionRow,
  type ExamUserProfile,
} from '../lib/exams.ts';

function makePosition(overrides: Partial<ExamPositionRow> = {}): ExamPositionRow {
  return {
    row_id: 'pos-1',
    exam_id: 'exam-1',
    department: '山东省大数据局',
    employer: '山东省数据应用中心',
    position_name: '信息技术岗A',
    position_code: '20260101',
    position_category: '综合类',
    bianzhi: '事业编',
    recruit_count: 2,
    city: '济南',
    education: '硕士研究生及以上',
    degree: '硕士及以上学位',
    majors: ['计算机科学与技术', '软件工程', '人工智能'],
    major_raw: '计算机科学与技术、软件工程、人工智能',
    political_status: '中共党员',
    fresh_grad_rule: '限2026届当年应届毕业生',
    age_limit: '35周岁以下',
    hukou_rule: '不限',
    exam_ratio: '1:3',
    exam_subjects: '公基 + 综合写作',
    other_conditions: '',
    ...overrides,
  };
}

function makeExam(overrides: Partial<ExamAnnouncement> = {}): ExamAnnouncement {
  const pos1 = makePosition();
  const pos2 = makePosition({
    row_id: 'pos-2',
    position_code: '20260102',
    position_name: '综合文秘岗',
    bianzhi: '事业编',
    recruit_count: 3,
    education: '本科及以上',
    degree: '学士',
    majors: ['不限专业'],
    major_raw: '不限专业',
    political_status: '不限',
    fresh_grad_rule: '不限',
  });
  return {
    id: 'exam-1',
    title: '2026年山东省省直事业单位公开招聘工作人员简章',
    organizer: '山东省人力资源和社会保障厅',
    region_level: '省级',
    province: '山东',
    cities: ['济南'],
    bianzhi_types: ['事业编'],
    exam_category: '事业单位统考',
    stage: 'registering',
    notice_role: '招考简章',
    total_positions: 2,
    total_headcount: 5,
    schedule: {
      reg_start: '2026-11-09',
      reg_end: '2026-11-15',
      audit_end: '2026-11-16',
      payment_end: '2026-11-17',
      admit_card_start: '2026-11-25',
      written_exam_date: '2026-11-29',
      interview_date: null,
      raw_evidence: ['报名时间：2026年11月9日9:00—11月15日16:00'],
    },
    exam_subjects: ['公基', '综合写作'],
    exam_ratio: '1:3',
    age_limit: '35周岁以下',
    service_years: null,
    hukou_summary: '不限户籍',
    fresh_grad_summary: '应往届均可',
    political_summary: '多数不限',
    education_min: '本科及以上',
    degree_summary: '学士及以上学位',
    has_unlimited_major: true,
    majors: ['计算机科学与技术', '软件工程', '不限专业'],
    registration_url: 'https://hrss.shandong.gov.cn/rsks/',
    registration_method: '网上报名系统',
    contact_phones: ['0531-81234567'],
    emails: [],
    source_id: 'sd-rsks-sydw',
    source_name: '山东省人事考试信息网·事业单位',
    source_url: 'https://hrss.shandong.gov.cn/rsks/notice-1.html',
    published_at: '2026-11-08',
    last_verified_at: '2026-11-09',
    excerpt: '2026年山东省省直事业单位公开招聘工作人员简章摘要',
    body: '2026年山东省省直事业单位公开招聘工作人员简章正文',
    positions: [pos1, pos2],
    attachments: [],
    links: [],
    related_notices: [],
    ...overrides,
  };
}

void test('evaluateExamPositionEligibility checks education, major, political status, and grad identity', () => {
  const posStrict = makePosition();
  const undergradMasses: ExamUserProfile = {
    ...DEFAULT_EXAM_PROFILE,
    education: '本科',
    hasDegree: true,
    majorQuery: '汉语言文学',
    politicalStatus: '群众',
    gradIdentity: '在职/社会人员',
    onlyMatchProfile: true,
  };

  const res1 = evaluateExamPositionEligibility(posStrict, undergradMasses);
  assert.equal(res1.matched, false);
  assert.ok(res1.conflicts.some((c) => c.includes('学历')));
  assert.ok(res1.conflicts.some((c) => c.includes('中共党员')));
  assert.ok(res1.conflicts.some((c) => c.includes('当年应届')));
  assert.ok(res1.conflicts.some((c) => c.includes('专业')));

  const masterPartyCs: ExamUserProfile = {
    ...DEFAULT_EXAM_PROFILE,
    education: '硕士研究生',
    hasDegree: true,
    majorQuery: '计算机',
    politicalStatus: '中共党员',
    gradIdentity: '当年应届',
    onlyMatchProfile: true,
  };
  const res2 = evaluateExamPositionEligibility(posStrict, masterPartyCs);
  assert.equal(res2.matched, true);
  assert.equal(res2.conflicts.length, 0);
  assert.equal(isExamProfileActive(masterPartyCs), true);
});

void test('filterExams filters by noticeRole, bianzhi, city, and profile matching', () => {
  const mainExam = makeExam();
  const progressNotice = makeExam({
    id: 'exam-progress',
    title: '2026年山东省省直事业单位公开招聘进入面试资格审查公告',
    notice_role: '资格复审/面试',
    stage: 'interview_review',
  });

  const onlyJianzhang = filterExams(
    [mainExam, progressNotice],
    { ...DEFAULT_EXAM_FILTERS, stage: '全部', noticeRole: '仅看招考简章' },
    DEFAULT_EXAM_PROFILE,
    {},
  );
  assert.equal(onlyJianzhang.length, 1);
  assert.equal(onlyJianzhang[0].id, 'exam-1');

  const allStagesNotices = filterExams(
    [mainExam, progressNotice],
    { ...DEFAULT_EXAM_FILTERS, stage: '全部' },
    DEFAULT_EXAM_PROFILE,
    {},
  );
  assert.equal(allStagesNotices.length, 2);

  // Default stage ('可报名/进行中', UI label '可报名') excludes interview/review notices
  const defaultOpenOnly = filterExams(
    [mainExam, progressNotice],
    DEFAULT_EXAM_FILTERS,
    DEFAULT_EXAM_PROFILE,
    {},
  );
  assert.deepEqual(defaultOpenOnly.map((e) => e.id), ['exam-1']);
});

void test('flattenAndFilterExamPositions flattens and filters position rows by profile', () => {
  const exam = makeExam();
  const profile: ExamUserProfile = {
    ...DEFAULT_EXAM_PROFILE,
    education: '本科',
    hasDegree: true,
    majorQuery: '会计',
    politicalStatus: '群众',
    gradIdentity: '在职/社会人员',
    onlyMatchProfile: false,
  };
  const rowsAll = flattenAndFilterExamPositions([exam], DEFAULT_EXAM_FILTERS, profile);
  assert.equal(rowsAll.length, 2);

  const rowsMatchedOnly = flattenAndFilterExamPositions(
    [exam],
    DEFAULT_EXAM_FILTERS,
    { ...profile, onlyMatchProfile: true },
  );
  assert.equal(rowsMatchedOnly.length, 1);
  assert.equal(rowsMatchedOnly[0].position_name, '综合文秘岗');
  assert.equal(computeExamStageLabel('registering').label, '正在报名');
});

void test('evaluateExamPositionEligibility returns unknown when major or education is unknown', () => {
  const posEmptyMajor = makePosition({
    education: '本科及以上',
    degree: '学士',
    majors: [],
    major_raw: '',
    political_status: '不限',
    fresh_grad_rule: '不限',
  });
  const profile: ExamUserProfile = {
    ...DEFAULT_EXAM_PROFILE,
    education: '本科',
    majorQuery: '计算机',
  };
  const resMajor = evaluateExamPositionEligibility(posEmptyMajor, profile);
  assert.equal(resMajor.status, 'unknown');
  assert.equal(resMajor.matched, false);
  assert.ok(resMajor.unknowns.some((u) => u.includes('专业')));

  const posAmbigEdu = makePosition({
    education: '大学及以上',
    degree: '不限',
    majors: ['不限专业'],
    major_raw: '不限专业',
    political_status: '不限',
    fresh_grad_rule: '不限',
  });
  const resEdu = evaluateExamPositionEligibility(posAmbigEdu, {
    ...DEFAULT_EXAM_PROFILE,
    education: '专科',
  });
  assert.equal(resEdu.status, 'unknown');
  assert.ok(resEdu.unknowns.some((u) => u.includes('学历')));
});

void test('evaluateExamPositionEligibility checks hukou city and birthYear age limits', () => {
  const posLiaocheng = makePosition({
    education: '本科及以上',
    degree: '不限',
    majors: ['不限专业'],
    major_raw: '不限专业',
    political_status: '不限',
    fresh_grad_rule: '不限',
    hukou_rule: '限聊城市户籍',
    age_limit: '35周岁及以下',
  });

  const resLiaocheng = evaluateExamPositionEligibility(posLiaocheng, {
    ...DEFAULT_EXAM_PROFILE,
    hukouCity: '聊城',
  });
  assert.equal(resLiaocheng.status, 'eligible');

  const resJinan = evaluateExamPositionEligibility(posLiaocheng, {
    ...DEFAULT_EXAM_PROFILE,
    hukouCity: '济南',
  });
  assert.equal(resJinan.status, 'ineligible');

  const resOutProvince = evaluateExamPositionEligibility(posLiaocheng, {
    ...DEFAULT_EXAM_PROFILE,
    hukouCity: '省外',
  });
  assert.equal(resOutProvince.status, 'ineligible');

  const currentYear = new Date().getFullYear();
  const resOverAge = evaluateExamPositionEligibility(posLiaocheng, {
    ...DEFAULT_EXAM_PROFILE,
    birthYear: currentYear - 38,
  });
  assert.equal(resOverAge.status, 'ineligible');
  assert.ok(resOverAge.conflicts.some((c) => c.includes('年龄')));
});

void test('onlyMatchProfile keeps unknown position rows while hiding ineligible rows', () => {
  const posUnknown = makePosition({
    row_id: 'pos-unknown',
    position_name: '未知专业岗',
    education: '本科及以上',
    degree: '不限',
    majors: [],
    major_raw: '',
    political_status: '不限',
    fresh_grad_rule: '不限',
  });
  const posIneligible = makePosition({
    row_id: 'pos-ineligible',
    position_name: '严格限制岗',
    education: '博士研究生',
  });
  const exam = makeExam({ positions: [posUnknown, posIneligible] });
  const profile: ExamUserProfile = {
    ...DEFAULT_EXAM_PROFILE,
    education: '本科',
    majorQuery: '计算机',
    onlyMatchProfile: true,
  };

  const rows = flattenAndFilterExamPositions([exam], DEFAULT_EXAM_FILTERS, profile);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].row_id, 'pos-unknown');
  assert.equal(rows[0].eligibility?.status, 'unknown');

  const exams = filterExams([exam], DEFAULT_EXAM_FILTERS, profile, {});
  assert.equal(exams.length, 1);
});

void test('deriveExamStage covers upcoming, registering, closing_soon, rolling, expired rolling, admit_exam, ended, and unknown', () => {
  const base = makeExam();

  // 1. upcoming
  assert.equal(deriveExamStage(base, '2026-11-05'), 'upcoming');
  // 2. registering (>3 days before reg_end)
  assert.equal(deriveExamStage(base, '2026-11-10'), 'registering');
  // 3. closing_soon (<=3 days before reg_end)
  assert.equal(deriveExamStage(base, '2026-11-13'), 'closing_soon');
  // 4. admit_exam (after reg_end, before written_exam_date)
  assert.equal(deriveExamStage(base, '2026-11-20'), 'admit_exam');
  // 5. ended (after written_exam_date)
  assert.equal(deriveExamStage(base, '2026-12-05'), 'ended');

  // 6. rolling active
  const rollingExam = makeExam({
    schedule: { reg_mode: 'rolling', rolling_until: '2026-12-31' },
  });
  assert.equal(deriveExamStage(rollingExam, '2026-11-10'), 'rolling');
  assert.equal(computeExamStageLabel('rolling').label, '长期招聘');

  // 7. rolling expired
  assert.equal(deriveExamStage(rollingExam, '2027-01-02'), 'ended');

  // 8. unknown (no schedule dates, recently published)
  const unknownExam = makeExam({
    published_at: '2026-11-01',
    schedule: {},
  });
  assert.equal(deriveExamStage(unknownExam, '2026-11-10'), 'unknown');
  assert.equal(computeExamStageLabel('unknown').label, '时间待确认');
});


void test('parseExamUrl and formatExamUrl round-trip filters, examId, and omit defaults', () => {
  const defaultQs = formatExamUrl({ filters: DEFAULT_EXAM_FILTERS, examId: null, page: 1 });
  assert.equal(defaultQs, '');

  const parsedDefault = parseExamUrl(defaultQs);
  assert.equal(parsedDefault.filters, undefined);
  assert.equal(parsedDefault.examId, null);
  assert.equal(parsedDefault.page, 1);

  const customFilters = {
    ...DEFAULT_EXAM_FILTERS,
    view: 'positions' as const,
    query: '计算机 选调',
    cities: ['济南', '青岛'],
    stage: '正在报名',
    category: '事业单位统考',
  };
  const customQs = formatExamUrl({ filters: customFilters, examId: 'sd-2026-001', page: 3 });
  assert.ok(customQs.startsWith('?'));

  const roundTrip = parseExamUrl(customQs);
  assert.equal(roundTrip.examId, 'sd-2026-001');
  assert.equal(roundTrip.page, 3);
  assert.deepEqual(roundTrip.filters, {
    view: 'positions',
    query: '计算机 选调',
    cities: ['济南', '青岛'],
    stage: '正在报名',
    category: '事业单位统考',
  });
});

void test('validateExamPersonal accepts terminal statuses and targetRowId, and computeExamNextStep computes days left', () => {
  const store = validateExamPersonal({
    'exam-1': {
      saved: true,
      status: 'failed_audit',
      targetRowId: 'row-abc-123',
      targetPositionCode: '省数据中心 · 信息技术岗（20260101）',
    },
    'exam-2': {
      status: 'audited',
    },
  });
  assert.equal(store['exam-1'].status, 'failed_audit');
  assert.equal(store['exam-1'].targetRowId, 'row-abc-123');
  assert.equal(isTerminalTrackStatus(store['exam-1'].status), true);
  assert.equal(isTerminalTrackStatus(store['exam-2'].status), false);

  const exam = makeExam();
  assert.equal(computeExamNextStep(exam, 'failed_audit', '2026-11-10'), null);
  const nextAudited = computeExamNextStep(exam, 'audited', '2026-11-10');
  assert.deepEqual(nextAudited, {
    label: '缴费确认',
    date: '2026-11-17',
    daysLeft: 7,
  });
});

await test('loadExamDetailShard caches Promise by URL, validates path, and allows retry after cache clear', async () => {
  const previous = globalThis.fetch;
  const validUrl = '/exam-assets/detail-0a-0123456789abcdef0123.json';
  let calls = 0;
  try {
    clearExamDetailShardCache();
    await assert.rejects(loadExamDetailShard('https://evil.example/detail.json'), /Invalid exam detail shard path/);

    globalThis.fetch = async () => {
      calls++;
      return Response.json({
        schema_version: 1,
        exams: {
          '0a123': { body: '招考正文', attachments: [{ title: '岗位表.xlsx', url: 'https://gov.cn/1.xlsx' }] },
        },
      });
    };

    const [first, second] = await Promise.all([
      loadExamDetailShard(validUrl),
      loadExamDetailShard(validUrl),
    ]);
    assert.equal(calls, 1);
    assert.equal(first, second);
    assert.equal(first.exams['0a123']?.body, '招考正文');

    clearExamDetailShardCache(validUrl);
    await loadExamDetailShard(validUrl);
    assert.equal(calls, 2);
  } finally {
    clearExamDetailShardCache();
    globalThis.fetch = previous;
  }
});

void test('evaluateExamPositionEligibility supports MOE major categories, aliases, and sibling-major review', () => {
  const baseRow = (majorRaw: string) =>
    makePosition({
      education: '本科及以上',
      degree: '学士',
      majors: [majorRaw],
      major_raw: majorRaw,
      political_status: '不限',
      fresh_grad_rule: '不限',
    });

  const seProfile: ExamUserProfile = {
    ...DEFAULT_EXAM_PROFILE,
    majorCategory: '计算机类',
    majorQuery: '软件工程',
  };

  // 1. 软件工程对计算机类：命中
  const resCsCategory = evaluateExamPositionEligibility(baseRow('计算机类'), seProfile);
  assert.equal(resCsCategory.status, 'eligible');
  assert.equal(resCsCategory.matched, true);
  assert.ok(resCsCategory.reasons.some((r) => r.includes('计算机类')));

  // 未显式选大类时，输入标准专业名“软件工程”也能推断所属计算机类
  const resInferredCategory = evaluateExamPositionEligibility(baseRow('计算机类'), {
    ...DEFAULT_EXAM_PROFILE,
    majorQuery: '软件工程',
  });
  assert.equal(resInferredCategory.status, 'eligible');
  assert.equal(resInferredCategory.matched, true);

  // 2. 会计学对“会计、审计”：命中
  const accProfile: ExamUserProfile = {
    ...DEFAULT_EXAM_PROFILE,
    majorCategory: '工商管理类',
    majorQuery: '会计学',
  };
  const resAccounting = evaluateExamPositionEligibility(baseRow('会计、审计'), accProfile);
  assert.equal(resAccounting.status, 'eligible');
  assert.equal(resAccounting.matched, true);
  assert.ok(resAccounting.reasons.some((r) => r.includes('专业匹配')));

  // 3. 软件工程对“汉语言文学”：不符
  const resMismatch = evaluateExamPositionEligibility(baseRow('汉语言文学'), seProfile);
  assert.equal(resMismatch.status, 'ineligible');
  assert.equal(resMismatch.matched, false);
  assert.ok(resMismatch.conflicts.some((c) => c.includes('专业要求')));

  // 4. 同类其他专业只作为参考，记入 reasons 标注“同类专业（需核实）”，不直接判为 eligible
  const resSibling = evaluateExamPositionEligibility(baseRow('物联网工程、网络工程'), seProfile);
  assert.equal(resSibling.status, 'unknown');
  assert.equal(resSibling.matched, false);
  assert.ok(resSibling.reasons.includes('同类专业（需核实）'));
  assert.ok(resSibling.unknowns.includes('同类专业（需核实）'));

  // 5. 短词边界保护：法学类 + 知识产权不应把“书法学”误判为同类专业
  const resCalligraphy = evaluateExamPositionEligibility(baseRow('书法学'), {
    ...DEFAULT_EXAM_PROFILE,
    majorCategory: '法学类',
    majorQuery: '知识产权',
  });
  assert.equal(resCalligraphy.status, 'ineligible');

  // 6. validateExamProfile 保留合法专业大类并过滤非法值
  assert.equal(validateExamProfile({ majorCategory: '计算机类' }).majorCategory, '计算机类');
  assert.equal(validateExamProfile({ majorCategory: '不存在的大类' }).majorCategory, '');
});

void test('parseExamUrl and formatExamUrl round-trip extended filters (bianzhi, subject, noticeRole, unlim, fresh, sort)', () => {
  const fullFilters = {
    ...DEFAULT_EXAM_FILTERS,
    view: 'positions' as const,
    query: '信息技术',
    cities: ['济南', '烟台'],
    stage: '正在报名',
    category: '事业单位',
    bianzhi: '事业编',
    subject: '职测',
    noticeRole: '仅看招考简章',
    unlimitedMajorOnly: true,
    freshGradOnly: true,
    sort: 'headcount' as const,
  };
  const qs = formatExamUrl({ filters: fullFilters, examId: 'ex-99', page: 2 });
  const parsed = parseExamUrl(qs);
  assert.equal(parsed.examId, 'ex-99');
  assert.equal(parsed.page, 2);
  assert.deepEqual(parsed.filters, {
    view: 'positions',
    query: '信息技术',
    cities: ['济南', '烟台'],
    stage: '正在报名',
    category: '事业单位',
    bianzhi: '事业编',
    subject: '职测',
    noticeRole: '仅看招考简章',
    unlimitedMajorOnly: true,
    freshGradOnly: true,
    sort: 'headcount',
  });
});

void test('mergeExamPersonal, examPersonalConflicts, and mergeExamProfile preserve local data and resolve timestamps', () => {
  const local = {
    'only-local': { saved: true, updatedAt: '2026-11-10T01:00:00Z' },
    'newer-local': { saved: true, status: 'paid' as const, updatedAt: '2026-11-10T05:00:00Z', readAt: '2026-11-09T00:00:00Z' },
    'newer-imported': { saved: true, status: 'registered' as const, updatedAt: '2026-11-10T02:00:00Z' },
    'tie-conflict': { saved: true, notes: '本机备注', updatedAt: '2026-11-10T03:00:00Z' },
  };
  const imported = {
    'only-imported': { saved: true, savedPositionIds: ['row-1'], updatedAt: '2026-11-10T01:00:00Z' },
    'newer-local': { saved: true, status: 'registered' as const, updatedAt: '2026-11-10T01:00:00Z' },
    'newer-imported': { saved: true, status: 'interview' as const, updatedAt: '2026-11-10T06:00:00Z' },
    'tie-conflict': { saved: true, notes: '备份备注', updatedAt: '2026-11-10T03:00:00Z' },
  };

  assert.deepEqual(examPersonalConflicts(local, imported), ['tie-conflict']);

  const keepLocal = mergeExamPersonal(local, imported, false);
  assert.equal(keepLocal['only-local']?.saved, true);
  assert.deepEqual(keepLocal['only-imported']?.savedPositionIds, ['row-1']);
  assert.equal(keepLocal['newer-local']?.status, 'paid');
  assert.equal(keepLocal['newer-local']?.readAt, '2026-11-09T00:00:00Z');
  assert.equal(keepLocal['newer-imported']?.status, 'interview');
  assert.equal(keepLocal['tie-conflict']?.notes, '本机备注');

  const preferBackup = mergeExamPersonal(local, imported, true);
  assert.equal(preferBackup['tie-conflict']?.notes, '备份备注');

  const activeLocalProfile: ExamUserProfile = { ...DEFAULT_EXAM_PROFILE, education: '本科' };
  const activeImportedProfile: ExamUserProfile = { ...DEFAULT_EXAM_PROFILE, education: '硕士研究生' };
  assert.equal(mergeExamProfile(DEFAULT_EXAM_PROFILE, activeImportedProfile, false)?.education, '硕士研究生');
  assert.equal(mergeExamProfile(activeLocalProfile, activeImportedProfile, false)?.education, '本科');
  assert.equal(mergeExamProfile(activeLocalProfile, activeImportedProfile, true)?.education, '硕士研究生');
});

void test('P1.3 strict city filtering (菏泽 vs 山东省直 vs 全国) and graduate age relaxation eligibility', () => {
  const hezeExam = makeExam({
    id: 'ex-heze',
    title: '2026年菏泽市事业单位公开招聘简章',
    region_level: '市级',
    province: '山东',
    cities: ['菏泽'],
    positions: [makePosition({ row_id: 'pos-hz', exam_id: 'ex-heze', city: '菏泽' })],
  });
  const provincialNoCityExam = makeExam({
    id: 'ex-sd-prov',
    title: '山东省2027年度选拔录用选调生公告',
    region_level: '省级',
    province: '山东',
    cities: [],
    positions: [makePosition({ row_id: 'pos-prov', exam_id: 'ex-sd-prov', city: '' })],
  });
  const nationalNoCityExam = makeExam({
    id: 'ex-national',
    title: '中央机关及其直属机构2027年度考试录用公务员公告',
    region_level: '国家级',
    province: '全国',
    cities: [],
    positions: [makePosition({ row_id: 'pos-nat', exam_id: 'ex-national', city: '' })],
  });
  const pool = [hezeExam, provincialNoCityExam, nationalNoCityExam];

  // Selecting 菏泽 must NOT dump cities=[] provincial/national notices into results
  const hezeFiltered = filterExams(pool, { ...DEFAULT_EXAM_FILTERS, cities: ['菏泽'] }, DEFAULT_EXAM_PROFILE, {});
  assert.deepEqual(hezeFiltered.map((e) => e.id), ['ex-heze']);
  const hezePos = flattenAndFilterExamPositions(pool, { ...DEFAULT_EXAM_FILTERS, cities: ['菏泽'] }, DEFAULT_EXAM_PROFILE);
  assert.deepEqual(hezePos.map((p) => p.row_id), ['pos-hz']);

  // Selecting 山东省直 matches 省级 Shandong notices; 全国 matches 国家级 notices
  const sdProvFiltered = filterExams(pool, { ...DEFAULT_EXAM_FILTERS, cities: ['山东省直'] }, DEFAULT_EXAM_PROFILE, {});
  assert.deepEqual(sdProvFiltered.map((e) => e.id), ['ex-sd-prov']);
  const nationalFiltered = filterExams(pool, { ...DEFAULT_EXAM_FILTERS, cities: ['全国'] }, DEFAULT_EXAM_PROFILE, {});
  assert.deepEqual(nationalFiltered.map((e) => e.id), ['ex-national']);

  // Graduate / fresh-grad age relaxation clause ("35周岁以下，2027年应届硕士、博士研究生放宽到40周岁以下")
  const currentYear = new Date().getFullYear();
  const posRelaxedAge = makePosition({
    education: '本科及以上',
    degree: '不限',
    majors: ['不限专业'],
    major_raw: '不限专业',
    political_status: '不限',
    fresh_grad_rule: '不限',
    age_limit: '18周岁以上、35周岁以下（应届硕士、博士研究生放宽到40周岁以下）',
  });

  const master38 = evaluateExamPositionEligibility(posRelaxedAge, {
    ...DEFAULT_EXAM_PROFILE,
    education: '硕士研究生',
    birthYear: currentYear - 38,
  });
  assert.equal(master38.status, 'eligible');

  const undergradSocial38 = evaluateExamPositionEligibility(posRelaxedAge, {
    ...DEFAULT_EXAM_PROFILE,
    education: '本科',
    gradIdentity: '在职/社会人员',
    birthYear: currentYear - 38,
  });
  assert.equal(undergradSocial38.status, 'ineligible');

  const unstatedEdu38 = evaluateExamPositionEligibility(posRelaxedAge, {
    ...DEFAULT_EXAM_PROFILE,
    education: '全部',
    birthYear: currentYear - 38,
  });
  assert.equal(unstatedEdu38.status, 'unknown');
});

void test('P1-1 open registration filter excludes closed provincial exams and follow-up notices while routing stages accurately', () => {
  const today = '2026-11-25';

  // Closed registration (Nov 6-9), today Nov 25 in payment_confirm / admit_exam / interview_review
  const closedInPayment = makeExam({
    id: 'sd-prov-payment',
    title: '2027年度山东省级机关及其直属机构考试录用公务员公告（缴费期）',
    exam_category: '公务员省考',
    notice_role: '招考简章',
    stage: 'registering',
    schedule: {
      reg_start: '2026-11-06',
      reg_end: '2026-11-09',
      audit_end: '2026-11-10',
      payment_end: '2026-11-26',
      written_exam_date: '2026-12-08',
    },
  });
  const closedInAdmit = makeExam({
    id: 'sd-prov-admit',
    title: '2027年度山东省考招录简章（准考证/笔试期）',
    exam_category: '公务员省考',
    notice_role: '招考简章',
    stage: 'registering',
    schedule: {
      reg_start: '2026-11-06',
      reg_end: '2026-11-09',
      payment_end: '2026-11-12',
      admit_card_start: '2026-12-02',
      written_exam_date: '2026-12-08',
    },
  });
  const closedInInterview = makeExam({
    id: 'sd-prov-interview',
    title: '2027年度选调生招录简章（待面试期）',
    exam_category: '选调生招录',
    notice_role: '招考简章',
    stage: 'registering',
    schedule: {
      reg_start: '2026-11-06',
      reg_end: '2026-11-09',
      written_exam_date: '2026-11-16',
      interview_date: '2026-12-12',
    },
  });

  // Follow-up notices carrying stale open stages in raw snapshot
  const scoreNotice = makeExam({
    id: 'notice-score',
    title: '2026年事业单位公开招聘笔试成绩及进入面试范围人员公告',
    notice_role: '成绩/进面',
    stage: 'registering',
    published_at: '2026-11-20',
    schedule: {},
  });
  const reviewNotice = makeExam({
    id: 'notice-review',
    title: '2026年事业单位公开招聘现场资格复审通知',
    notice_role: '资格复审/面试',
    stage: 'closing_soon',
    published_at: '2026-11-21',
    schedule: {},
  });
  const publicityNotice = makeExam({
    id: 'notice-publicity',
    title: '2026年公开招聘拟聘用人员公示',
    notice_role: '体检/递补/公示',
    stage: 'rolling',
    published_at: '2026-11-22',
    schedule: {},
  });
  const admitCardNotice = makeExam({
    id: 'notice-admit',
    title: '2026年公开招聘笔试准考证打印通知',
    notice_role: '准考证/笔试',
    stage: 'upcoming',
    published_at: '2026-11-23',
    schedule: {},
  });
  const supplementPastReg = makeExam({
    id: 'notice-supp-closed',
    title: '关于核减部分岗位计划的补充公告',
    notice_role: '补充公告',
    stage: 'registering',
    published_at: '2026-11-15',
    schedule: {
      reg_start: '2026-11-06',
      reg_end: '2026-11-09',
      written_exam_date: '2026-12-08',
    },
  });

  // Genuinely open registrations + upcoming
  const activeRegistering = makeExam({
    id: 'open-registering',
    title: '2026年济南市事业单位公开招聘简章',
    notice_role: '招考简章',
    schedule: { reg_start: '2026-11-20', reg_end: '2026-12-02' },
  });
  const activeClosingSoon = makeExam({
    id: 'open-closing',
    title: '2026年青岛市教师公开招聘简章',
    notice_role: '招考简章',
    schedule: { reg_start: '2026-11-18', reg_end: '2026-11-27' },
  });
  const activeRolling = makeExam({
    id: 'open-rolling',
    title: '2026年高校高层次人才长期招聘公告',
    notice_role: '招考简章',
    schedule: { reg_mode: 'rolling', rolling_until: '2026-12-31' },
  });
  const upcomingExam = makeExam({
    id: 'future-upcoming',
    title: '2026年烟台市医疗卫生公开招聘简章',
    notice_role: '招考简章',
    schedule: { reg_start: '2026-11-29', reg_end: '2026-12-05' },
  });

  const rawPool = [
    closedInPayment,
    closedInAdmit,
    closedInInterview,
    scoreNotice,
    reviewNotice,
    publicityNotice,
    admitCardNotice,
    supplementPastReg,
    activeRegistering,
    activeClosingSoon,
    activeRolling,
    upcomingExam,
  ];
  const derivedPool = rawPool.map((e) => ({ ...e, stage: deriveExamStage(e, today) }));
  const byId = Object.fromEntries(derivedPool.map((e) => [e.id, e]));

  assert.equal(byId['sd-prov-payment'].stage, 'payment_confirm');
  assert.equal(byId['sd-prov-admit'].stage, 'admit_exam');
  assert.equal(byId['sd-prov-interview'].stage, 'interview_review');
  assert.equal(byId['notice-score'].stage, 'interview_review');
  assert.equal(byId['notice-review'].stage, 'interview_review');
  assert.equal(byId['notice-publicity'].stage, 'publicity');
  assert.equal(byId['notice-admit'].stage, 'admit_exam');
  assert.equal(byId['notice-supp-closed'].stage, 'admit_exam');

  // '可报名/进行中' (UI label '可报名') keeps ONLY registering, closing_soon, rolling
  const openFiltered = filterExams(derivedPool, DEFAULT_EXAM_FILTERS, DEFAULT_EXAM_PROFILE, {});
  assert.deepEqual(
    openFiltered.map((e) => e.id).sort(),
    ['open-closing', 'open-registering', 'open-rolling'],
  );
  assert.deepEqual(
    derivedPool.filter((e) => isExamOpenForRegistration(e)).map((e) => e.id).sort(),
    ['open-closing', 'open-registering', 'open-rolling'],
  );

  // '即将开始' keeps upcoming
  const upcomingFiltered = filterExams(
    derivedPool,
    { ...DEFAULT_EXAM_FILTERS, stage: '即将开始' },
    DEFAULT_EXAM_PROFILE,
    {},
  );
  assert.deepEqual(upcomingFiltered.map((e) => e.id), ['future-upcoming']);

  // '考务跟进（笔面试/资审）' (UI label '考试进行中') includes closed-reg active exams & follow-up notices
  const followUpFiltered = filterExams(
    derivedPool,
    { ...DEFAULT_EXAM_FILTERS, stage: '考务跟进（笔面试/资审）' },
    DEFAULT_EXAM_PROFILE,
    {},
  );
  assert.deepEqual(
    followUpFiltered.map((e) => e.id).sort(),
    [
      'notice-admit',
      'notice-publicity',
      'notice-review',
      'notice-score',
      'notice-supp-closed',
      'sd-prov-admit',
      'sd-prov-interview',
      'sd-prov-payment',
    ],
  );

  // Stage label mapping alignment
  const stageMap = Object.fromEntries(EXAM_STAGE_OPTIONS);
  assert.equal(stageMap['可报名/进行中'], '可报名');
  assert.equal(stageMap['考务跟进（笔面试/资审）'], '考试进行中');
});

await test('P1-2 loadExamPositionsAsset evicts failed request from cache so retry succeeds', async () => {
  const previous = globalThis.fetch;
  const validPosUrl = '/exam-assets/positions-0123456789abcdef0123.json';
  let calls = 0;
  try {
    clearExamDetailShardCache();
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) {
        return new Response('Bad Gateway', { status: 502 });
      }
      return Response.json({
        schema_version: 1,
        positions_by_exam: {
          'exam-1': [makePosition()],
        },
      });
    };

    await assert.rejects(loadExamPositionsAsset(validPosUrl), /HTTP 502/);
    assert.equal(calls, 1);

    const recovered = await loadExamPositionsAsset(validPosUrl);
    assert.equal(calls, 2);
    assert.equal(recovered.positions_by_exam['exam-1']?.length, 1);
  } finally {
    clearExamDetailShardCache();
    globalThis.fetch = previous;
  }
});
