import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeExamStageLabel,
  DEFAULT_EXAM_FILTERS,
  DEFAULT_EXAM_PROFILE,
  evaluateExamPositionEligibility,
  filterExams,
  flattenAndFilterExamPositions,
  isExamProfileActive,
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
