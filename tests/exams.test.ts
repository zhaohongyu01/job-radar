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
  filterExams,
  flattenAndFilterExamPositions,
  formatExamUrl,
  isExamProfileActive,
  isTerminalTrackStatus,
  loadExamDetailShard,
  parseExamUrl,
  validateExamPersonal,
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
    { ...DEFAULT_EXAM_FILTERS, noticeRole: '仅看招考简章' },
    DEFAULT_EXAM_PROFILE,
    {},
  );
  assert.equal(onlyJianzhang.length, 1);
  assert.equal(onlyJianzhang[0].id, 'exam-1');

  const allNotices = filterExams(
    [mainExam, progressNotice],
    DEFAULT_EXAM_FILTERS,
    DEFAULT_EXAM_PROFILE,
    {},
  );
  assert.equal(allNotices.length, 2);
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
