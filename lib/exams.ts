export type WorkspaceMode = 'jobs' | 'exams';

export type BianzhiCategory =
  | '公务员（行政编）'
  | '参公管理'
  | '事业编'
  | '控制总量 / 备案制'
  | '选调生'
  | '教师编'
  | '医疗卫生编'
  | '军队文职'
  | '三支一扶 / 基层项目'
  | '高层次 / 紧缺人才';

export type ExamCategory =
  | '公务员国考'
  | '公务员省考'
  | '选调生招录'
  | '事业单位统考'
  | '事业单位单招'
  | '教师公开招聘'
  | '医疗卫生招聘'
  | '高校 / 科研院所'
  | '人才引进 / 优才'
  | '军队文职招考'
  | '三支一扶 / 基层';

export type ExamStage =
  | 'upcoming'         // 即将开始报名
  | 'registering'      // 正在报名
  | 'closing_soon'     // 报名即将截止（<=3天）
  | 'rolling'          // 长期招聘
  | 'payment_confirm'  // 资格初审 / 缴费确认期
  | 'admit_exam'       // 准考证打印 / 笔试期
  | 'interview_review' // 笔试成绩 / 资格复审 / 面试
  | 'publicity'        // 体检考察 / 拟录用公示
  | 'unknown'          // 时间待确认
  | 'ended';           // 已截止 / 考务归档

export type ExamTrackStatus =
  | 'none'
  | 'comparing'    // 选岗对比中
  | 'registered'   // 已报名待初审
  | 'audited'      // 初审通过待缴费
  | 'paid'         // 已缴费待笔试
  | 'written_done' // 笔试已考待出分
  | 'interview'    // 进面 / 资格复审
  | 'admitted';    // 体检考察 / 拟录用

export const EXAM_TRACK_STAGES: {
  key: Exclude<ExamTrackStatus, 'none'>;
  label: string;
  shortLabel: string;
  hint: string;
}[] = [
  { key: 'comparing', label: '选岗对比中', shortLabel: '选岗期', hint: '正在对比招录人数、限制条件与报录比' },
  { key: 'registered', label: '已报名待初审', shortLabel: '待初审', hint: '已提交报名信息，等待招录机关资格初审' },
  { key: 'audited', label: '初审通过待缴费', shortLabel: '待缴费', hint: '初审已过，务必在缴费截止前完成网上确认与缴费' },
  { key: 'paid', label: '已缴费待笔试', shortLabel: '待笔试', hint: '报名成功，按时打印准考证并参加笔试' },
  { key: 'written_done', label: '笔试完待成绩', shortLabel: '待成绩', hint: '等待笔试成绩查询及进面资格线公布' },
  { key: 'interview', label: '进面 / 资格复审', shortLabel: '进面复审', hint: '准备现场资格审查材料与结构化/专业面试' },
  { key: 'admitted', label: '体检考察 / 拟录用', shortLabel: '体检公示', hint: '进入体检、政审考察及拟录用公示阶段' },
];

export interface ExamSchedule {
  reg_start?: string | null;
  reg_end?: string | null;
  audit_end?: string | null;
  payment_end?: string | null;
  admit_card_start?: string | null;
  written_exam_date?: string | null;
  interview_date?: string | null;
  reg_mode?: 'window' | 'rolling';
  rolling_until?: string | null;
  raw_evidence?: string[];
}

export interface ExamPositionRow {
  row_id: string;
  exam_id: string;
  exam_title?: string;
  department: string;          // 主管部门 / 招录机关
  employer: string;            // 用人单位 / 招聘单位
  position_name: string;       // 岗位名称
  position_code?: string;      // 岗位代码
  position_category?: string;  // 岗位类别（如综合类A、医疗类E、教师岗）
  bianzhi: BianzhiCategory;    // 编制性质
  recruit_count: number | null; // 招录人数
  city: string;                // 工作地点
  education: string;           // 学历要求
  degree?: string;             // 学位要求
  majors: string[];            // 专业列表
  major_raw: string;           // 专业要求原文
  political_status: string;    // 政治面貌要求
  fresh_grad_rule: string;     // 应届/基层经历要求
  age_limit?: string;          // 年龄限制
  hukou_rule?: string;         // 户籍/生源地要求
  exam_ratio?: string;         // 开考比例（如 1:3）
  exam_subjects?: string;      // 笔试科目
  other_conditions?: string;   // 其他条件与备注
  contact_phone?: string;      // 咨询电话
  source_file?: string;        // 来源附件名
  source_url?: string;         // 来源附件地址
  source?: 'table' | 'attachment' | 'prose';
}

export interface ExamRelatedNotice {
  id: string;
  title: string;
  published_at: string | null;
  notice_type: '报名统计' | '补充更正' | '准考证/笔试' | '成绩/进面' | '资格复审/面试' | '体检/递补/公示';
  url: string;
  source_name?: string;
}

export interface ExamAnnouncement {
  id: string;
  title: string;
  organizer: string;
  region_level: '国家级' | '省级' | '市级' | '区县级' | '高校/医院单招';
  province: string;
  cities: string[];
  bianzhi_types: BianzhiCategory[];
  exam_category: ExamCategory;
  stage: ExamStage;
  notice_role: '招考简章' | '报名统计' | '准考证/笔试' | '成绩/进面' | '资格复审/面试' | '体检/递补/公示' | '补充公告';
  total_positions: number | null;
  total_headcount: number | null;
  positions_status?: 'parsed' | 'prose' | 'attachment_only' | 'none';
  schedule: ExamSchedule;
  exam_subjects: string[];
  exam_ratio?: string | null;
  age_limit?: string | null;
  service_years?: string | null;
  hukou_summary: string;
  fresh_grad_summary: string;
  political_summary: string;
  education_min: string;
  degree_summary: string;
  has_unlimited_major: boolean;
  majors: string[];
  registration_url: string | null;
  registration_method: string;
  contact_phones?: string[];
  emails?: string[];
  source_id: string;
  source_name: string;
  source_url: string;
  published_at: string | null;
  last_verified_at: string;
  excerpt: string;
  body?: string;
  positions?: ExamPositionRow[];
  attachments?: { title: string; url: string; parse_status?: string }[];
  links?: { title: string; url: string }[];
  related_notices?: ExamRelatedNotice[];
}

export interface ExamSnapshot {
  schema_version: 1;
  generated_at: string;
  last_success_at: string;
  total_exams: number;
  total_positions: number;
  total_headcount: number;
  total_exams_with_positions?: number;
  cities: string[];
  detail_shards?: Record<string, string>;
  exams: ExamAnnouncement[];
  sources: {
    id: string;
    name: string;
    url: string;
    city?: string;
    level?: string;
    status: string;
    count?: number;
    last_success_at?: string | null;
    errors?: string[];
  }[];
}

export const SHANDONG_16 = [
  '济南', '青岛', '烟台', '潍坊', '临沂', '济宁', '淄博', '威海',
  '泰安', '东营', '日照', '德州', '聊城', '滨州', '菏泽', '枣庄',
] as const;

export interface ExamUserProfile {
  education: '全部' | '专科' | '本科' | '硕士研究生' | '博士研究生';
  hasDegree: boolean;
  majorQuery: string;
  politicalStatus: '不限' | '群众' | '共青团员' | '中共党员';
  gradIdentity: '不限' | '当年应届' | '择业期应届' | '在职/社会人员';
  grassrootsYears: number;
  hukouCity: string;
  birthYear: number | null;
  onlyMatchProfile: boolean;
}

export interface ExamFilters {
  query: string;
  cities: string[];
  category: string;
  bianzhi: string;
  subject: string;
  stage: string;
  noticeRole: string;
  unlimitedMajorOnly: boolean;
  view: 'announcements' | 'positions' | 'saved' | 'tracker';
  sort: 'smart' | 'published' | 'reg_end' | 'headcount';
}

export const EXAM_PERSONAL_STORAGE = 'job-radar-exam-personal-v1';
export const EXAM_PROFILE_STORAGE = 'job-radar-exam-profile-v1';
export const EXAM_FILTERS_STORAGE = 'job-radar-exam-filters-v1';

export interface ExamPersonalRecord {
  saved?: boolean;
  hidden?: boolean;
  status?: ExamTrackStatus;
  savedPositionIds?: string[];
  targetPositionCode?: string;
  targetRowId?: string;
  regNumber?: string;
  writtenScore?: string;
  interviewDate?: string;
  notes?: string;
  readAt?: string;
  updatedAt?: string;
}

export type ExamPersonalStore = Record<string, ExamPersonalRecord>;

export const DEFAULT_EXAM_PROFILE: ExamUserProfile = {
  education: '全部',
  hasDegree: true,
  majorQuery: '',
  politicalStatus: '不限',
  gradIdentity: '不限',
  grassrootsYears: 0,
  hukouCity: '全部',
  birthYear: null,
  onlyMatchProfile: false,
};

const TRACK_KEYS = new Set<string>(['none', ...EXAM_TRACK_STAGES.map((s) => s.key)]);
const PROFILE_EDU = new Set<ExamUserProfile['education']>(['全部', '专科', '本科', '硕士研究生', '博士研究生']);
const PROFILE_POL = new Set<ExamUserProfile['politicalStatus']>(['不限', '群众', '共青团员', '中共党员']);
const PROFILE_GRAD = new Set<ExamUserProfile['gradIdentity']>(['不限', '当年应届', '择业期应届', '在职/社会人员']);

export function validateExamPersonal(input: unknown): ExamPersonalStore {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('考编记录格式不正确');
  const out: ExamPersonalStore = {};
  for (const [id, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!/^[\w-]{1,80}$/.test(id) || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('考编记录不正确');
    const r = raw as Record<string, unknown>;
    const rec: ExamPersonalRecord = {};
    for (const k of ['saved', 'hidden'] as const) {
      if (r[k] !== undefined) {
        if (typeof r[k] !== 'boolean') throw Error('考编记录不正确');
        rec[k] = r[k] as boolean;
      }
    }
    if (r.status !== undefined) {
      if (typeof r.status !== 'string' || !TRACK_KEYS.has(r.status)) throw Error('报考进度不正确');
      rec.status = r.status as ExamTrackStatus;
    }
    if (r.savedPositionIds !== undefined) {
      if (!Array.isArray(r.savedPositionIds) || r.savedPositionIds.length > 200 || !r.savedPositionIds.every((x) => typeof x === 'string' && x.length <= 120)) {
        throw Error('候选岗位不正确');
      }
      rec.savedPositionIds = r.savedPositionIds as string[];
    }
    for (const k of ['targetPositionCode', 'targetRowId', 'regNumber', 'writtenScore', 'interviewDate', 'readAt', 'updatedAt'] as const) {
      if (r[k] !== undefined) {
        if (typeof r[k] !== 'string' || (r[k] as string).length > 200) throw Error('考编记录字段不正确');
        (rec as Record<string, unknown>)[k] = r[k];
      }
    }
    if (r.notes !== undefined) {
      if (typeof r.notes !== 'string' || r.notes.length > 2000) throw Error('考编备注过长');
      rec.notes = r.notes;
    }
    out[id] = rec;
  }
  return out;
}

export function validateExamProfile(input: unknown): ExamUserProfile {
  const out: ExamUserProfile = { ...DEFAULT_EXAM_PROFILE };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  const r = input as Record<string, unknown>;
  if (typeof r.education === 'string' && PROFILE_EDU.has(r.education as ExamUserProfile['education'])) {
    out.education = r.education as ExamUserProfile['education'];
  }
  if (typeof r.hasDegree === 'boolean') out.hasDegree = r.hasDegree;
  if (typeof r.majorQuery === 'string') out.majorQuery = r.majorQuery.slice(0, 200);
  if (typeof r.politicalStatus === 'string' && PROFILE_POL.has(r.politicalStatus as ExamUserProfile['politicalStatus'])) {
    out.politicalStatus = r.politicalStatus as ExamUserProfile['politicalStatus'];
  }
  if (typeof r.gradIdentity === 'string' && PROFILE_GRAD.has(r.gradIdentity as ExamUserProfile['gradIdentity'])) {
    out.gradIdentity = r.gradIdentity as ExamUserProfile['gradIdentity'];
  }
  if (typeof r.grassrootsYears === 'number' && Number.isFinite(r.grassrootsYears) && r.grassrootsYears >= 0 && r.grassrootsYears <= 30) {
    out.grassrootsYears = Math.floor(r.grassrootsYears);
  }
  if (typeof r.hukouCity === 'string' && r.hukouCity.length > 0 && r.hukouCity.length <= 40) {
    out.hukouCity = r.hukouCity;
  }
  if (typeof r.birthYear === 'number' && Number.isFinite(r.birthYear) && r.birthYear >= 1950 && r.birthYear <= 2015) {
    out.birthYear = Math.floor(r.birthYear);
  }
  if (typeof r.onlyMatchProfile === 'boolean') out.onlyMatchProfile = r.onlyMatchProfile;
  return out;
}

export const DEFAULT_EXAM_FILTERS: ExamFilters = {
  query: '',
  cities: ['全部'],
  category: '全部',
  bianzhi: '全部',
  subject: '全部',
  stage: '全部',
  noticeRole: '全部',
  unlimitedMajorOnly: false,
  view: 'announcements',
  sort: 'smart',
};

const EDU_RANK: Record<string, number> = {
  '不限': 0,
  '中专': 1,
  '高中': 1,
  '专科': 2,
  '大专': 2,
  '高职': 2,
  '本科': 3,
  '大学本科': 3,
  '硕士': 4,
  '硕士研究生': 4,
  '研究生': 4,
  '博士': 5,
  '博士研究生': 5,
};

const isUnknownText = (s?: string | null) => !s || /详见|见附件|见公告|见原|未明确|待定|另行/.test(s);

export function parseRequiredMinEduRank(eduText: string): number {
  if (isUnknownText(eduText)) return -1;
  if (/不限/.test(eduText)) return 0;
  if (/大学及以上|^大学$/.test(eduText)) return -1;
  if (/专科|大专|高职/.test(eduText)) return 2;
  if (/本科/.test(eduText)) return 3;
  if (/硕士|研究生/.test(eduText) && !/博士/.test(eduText)) return 4;
  if (/博士/.test(eduText)) return 5;
  if (/中专|高中/.test(eduText)) return 1;
  return -1;
}

export function parseRequiredMaxEduRank(eduText: string): number {
  if (!eduText) return 5;
  if (/仅限专科|只限专科/.test(eduText)) return 2;
  if (/仅限本科|只限本科/.test(eduText) && !/及以上|以上|研究生/.test(eduText)) return 3;
  if (/仅限硕士|只限硕士/.test(eduText) && !/及以上|以上|博士/.test(eduText)) return 4;
  return 5;
}

export type EligibilityStatus = 'eligible' | 'ineligible' | 'unknown';

export interface PositionEligibilityResult {
  status: EligibilityStatus;
  matched: boolean;
  reasons: string[];
  conflicts: string[];
  unknowns: string[];
}

export function evaluateExamPositionEligibility(
  row: ExamPositionRow,
  profile: ExamUserProfile,
): PositionEligibilityResult {
  const reasons: string[] = [];
  const conflicts: string[] = [];
  const unknowns: string[] = [];

  // 1. 学历层次校验
  if (profile.education !== '全部') {
    const userRank = EDU_RANK[profile.education] ?? 3;
    const minRank = parseRequiredMinEduRank(row.education);
    const maxRank = parseRequiredMaxEduRank(row.education);
    if (minRank === -1) {
      unknowns.push('学历要求未提取');
    } else if (userRank < minRank) {
      conflicts.push(`学历需「${row.education}」`);
    } else if (userRank > maxRank) {
      conflicts.push(`学历限制「${row.education}」`);
    } else if (minRank > 0) {
      reasons.push(`学历符合（${row.education}）`);
    } else {
      reasons.push('学历不限');
    }
  }

  // 2. 学位要求校验
  if (!profile.hasDegree) {
    if (isUnknownText(row.degree)) {
      unknowns.push('学位要求未提取');
    } else if (/学士|硕士|博士/.test(row.degree!) && !/不限|无要求/.test(row.degree!)) {
      conflicts.push(`需取得「${row.degree}」`);
    }
  }

  // 3. 政治面貌校验
  if (profile.politicalStatus !== '不限') {
    const reqPol = row.political_status || '';
    if (isUnknownText(reqPol)) {
      unknowns.push('政治面貌要求未提取');
    } else if (/中共党员/.test(reqPol) && !/共青团员/.test(reqPol)) {
      if (profile.politicalStatus !== '中共党员') {
        conflicts.push('要求中共党员');
      } else {
        reasons.push('党员身份匹配');
      }
    } else if (/中共党员.*共青团员|共青团员.*中共党员/.test(reqPol)) {
      if (profile.politicalStatus === '群众') {
        conflicts.push('要求中共党员或共青团员');
      } else {
        reasons.push('政治面貌符合');
      }
    } else if (/不限/.test(reqPol)) {
      reasons.push('政治面貌不限');
    }
  }

  // 4. 应届身份校验
  if (profile.gradIdentity !== '不限') {
    const rule = row.fresh_grad_rule || '';
    if (isUnknownText(rule)) {
      unknowns.push('应届要求未提取');
    } else if (/当年应届|20\d{2}届|仅限应届/.test(rule) && !/择业期/.test(rule)) {
      if (profile.gradIdentity !== '当年应届') {
        conflicts.push(`限当年应届生（${rule}）`);
      } else {
        reasons.push('应届身份符合');
      }
    } else if (/应届|高校毕业生/.test(rule) && !/应往届均可|不限/.test(rule)) {
      if (profile.gradIdentity === '在职/社会人员') {
        conflicts.push('限应届高校毕业生');
      } else {
        reasons.push('应届/择业期符合');
      }
    } else if (/不限|应往届均可/.test(rule)) {
      reasons.push('应往届不限');
    }
  }

  // 5. 基层工作经历年限校验
  const otherText = `${row.fresh_grad_rule || ''} ${row.other_conditions || ''}`;
  const yearsMatch = otherText.match(/(\d+|一|二|两|三|五)\s*年(?:及)?以上基层工作经历/);
  if (yearsMatch) {
    const cnMap: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 五: 5 };
    const reqYears = cnMap[yearsMatch[1]] ?? (Number(yearsMatch[1]) || 0);
    if (profile.grassrootsYears < reqYears) {
      conflicts.push(`需 ${reqYears} 年以上基层工作经历`);
    } else {
      reasons.push(`满足 ${reqYears} 年基层经历`);
    }
  }

  // 6. 户籍限制校验
  if (profile.hukouCity && profile.hukouCity !== '全部') {
    const rule = row.hukou_rule || '';
    if (isUnknownText(rule)) unknowns.push('户籍要求未提取');
    else if (/不限/.test(rule)) reasons.push('户籍不限');
    else if (profile.hukouCity === '省外') {
      if (/山东|本省|省内|本市|本县|本区/.test(rule) || SHANDONG_16.some((c) => rule.includes(c))) {
        conflicts.push(`户籍要求：${rule}`);
      }
    } else if (rule.includes(profile.hukouCity) || /山东省|本省|省内/.test(rule)) {
      reasons.push('户籍符合');
    } else if (SHANDONG_16.some((c) => rule.includes(c)) || /本市|本县|本区/.test(rule)) {
      conflicts.push(`户籍要求：${rule}`);
    } else {
      unknowns.push(`户籍要求需核实：${rule}`);
    }
  }

  // 7. 专业匹配校验
  const queryTerms = profile.majorQuery
    .split(/[\s,，、;/；]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (queryTerms.length > 0) {
    const rawStr = row.major_raw || row.majors.join(' ') || '';
    if (isUnknownText(rawStr)) {
      unknowns.push('专业要求未提取');
    } else {
      const rawMajor = rawStr.toLowerCase();
      const isUnlimited = /不限|无限制|全部专业|所有专业/.test(rawMajor);
      if (isUnlimited) {
        reasons.push('不限专业');
      } else {
        const hit = queryTerms.find((term) => rawMajor.includes(term) || row.position_name.toLowerCase().includes(term));
        if (hit) {
          reasons.push(`专业匹配「${hit}」`);
        } else {
          conflicts.push(`专业要求：${row.major_raw || row.majors.join('、')}`);
        }
      }
    }
  } else if (/不限|无限制/.test(row.major_raw || '')) {
    reasons.push('不限专业');
  }

  // 8. 年龄限制校验
  if (profile.birthYear !== null && profile.birthYear !== undefined) {
    const ageText = row.age_limit || '';
    const ageMatch = ageText.match(/(\d{2})\s*周岁(?:及)?以下/);
    if (ageMatch) {
      const maxAge = Number(ageMatch[1]);
      const curYear = new Date().getFullYear();
      const userAge = curYear - profile.birthYear;
      if (userAge > maxAge) {
        conflicts.push(`年龄上限 ${maxAge} 周岁`);
      } else {
        reasons.push(`年龄符合（≤${maxAge}周岁）`);
      }
    } else {
      unknowns.push('年龄要求未提取');
    }
  }

  const status: EligibilityStatus = conflicts.length ? 'ineligible' : unknowns.length ? 'unknown' : 'eligible';
  return {
    status,
    matched: status === 'eligible',
    reasons,
    conflicts,
    unknowns,
  };
}

export function isExamProfileActive(profile: ExamUserProfile): boolean {
  return (
    profile.onlyMatchProfile ||
    profile.education !== '全部' ||
    Boolean(profile.majorQuery.trim()) ||
    profile.politicalStatus !== '不限' ||
    profile.gradIdentity !== '不限' ||
    profile.hukouCity !== '全部' ||
    (profile.birthYear !== null && profile.birthYear !== undefined)
  );
}

export function computeExamStageLabel(stage: ExamStage): {
  label: string;
  tone: 'active' | 'urgent' | 'upcoming' | 'progress' | 'muted';
} {
  switch (stage) {
    case 'closing_soon':
      return { label: '报名即将截止', tone: 'urgent' };
    case 'registering':
      return { label: '正在报名', tone: 'active' };
    case 'upcoming':
      return { label: '即将开始报名', tone: 'upcoming' };
    case 'rolling':
      return { label: '长期招聘', tone: 'upcoming' };
    case 'payment_confirm':
      return { label: '初审 / 缴费确认期', tone: 'urgent' };
    case 'admit_exam':
      return { label: '准考证 / 笔试阶段', tone: 'progress' };
    case 'interview_review':
      return { label: '成绩 / 资审 / 面试', tone: 'progress' };
    case 'publicity':
      return { label: '体检 / 考察 / 公示', tone: 'muted' };
    case 'unknown':
      return { label: '时间待确认', tone: 'muted' };
    case 'ended':
    default:
      return { label: '报名已结束', tone: 'muted' };
  }
}

const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

export function deriveExamStage(exam: ExamAnnouncement, today: string): ExamStage {
  if (exam.notice_role !== '招考简章') {
    if (exam.published_at && dayDiff(today, exam.published_at.slice(0, 10)) > 45) return 'ended';
    return exam.stage === 'ended' ? 'ended' : exam.stage;
  }
  const s = exam.schedule || {};
  if (s.reg_mode === 'rolling') return s.rolling_until && today > s.rolling_until ? 'ended' : 'rolling';
  if (s.reg_start && today < s.reg_start) return 'upcoming';
  if (s.reg_end) {
    if (today <= s.reg_end) return dayDiff(s.reg_end, today) <= 3 ? 'closing_soon' : 'registering';
    if (s.written_exam_date && today <= s.written_exam_date) return 'admit_exam';
    if (s.interview_date && today <= s.interview_date) return 'interview_review';
    return 'ended';
  }
  if (exam.published_at && dayDiff(today, exam.published_at.slice(0, 10)) > 60) return 'ended';
  return 'unknown';
}

export function filterExams(
  exams: ExamAnnouncement[],
  filters: ExamFilters,
  profile: ExamUserProfile,
  personal: ExamPersonalStore,
): ExamAnnouncement[] {
  const queryTerms = filters.query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  const selectedCities = filters.cities.filter((c) => c && c !== '全部');

  const result = exams.filter((exam) => {
    const rec = personal[exam.id];

    // View filter
    if (filters.view === 'saved') {
      if (!rec?.saved && (!rec?.savedPositionIds || rec.savedPositionIds.length === 0)) return false;
    } else if (filters.view === 'tracker') {
      if (!rec || (!rec.status || rec.status === 'none')) return false;
    } else {
      if (rec?.hidden) return false;
    }

    // City filter
    if (selectedCities.length > 0) {
      const cityHit =
        selectedCities.some((c) => exam.cities.includes(c)) ||
        (exam.region_level === '国家级' && exam.cities.length === 0) ||
        (exam.region_level === '省级' && exam.province === '山东' && exam.cities.length === 0);
      if (!cityHit) return false;
    }

    // Category filter
    if (filters.category !== '全部' && exam.exam_category !== filters.category) {
      return false;
    }

    // Bianzhi filter
    if (filters.bianzhi !== '全部' && !exam.bianzhi_types.includes(filters.bianzhi as BianzhiCategory)) {
      return false;
    }

    // Subject filter
    if (filters.subject !== '全部') {
      const subjText = exam.exam_subjects.join(' ');
      if (!subjText.includes(filters.subject)) return false;
    }

    // Stage filter
    if (filters.stage !== '全部') {
      if (filters.stage === '可报名/进行中') {
        if (!['upcoming', 'registering', 'closing_soon', 'rolling'].includes(exam.stage)) return false;
      } else if (filters.stage === '正在报名' && !['registering', 'closing_soon'].includes(exam.stage)) {
        return false;
      } else if (filters.stage === '即将开始' && exam.stage !== 'upcoming') {
        return false;
      } else if (filters.stage === '长期招聘' && exam.stage !== 'rolling') {
        return false;
      } else if (filters.stage === '时间待确认' && exam.stage !== 'unknown') {
        return false;
      } else if (filters.stage === '考务跟进（笔面试/资审）' && !['payment_confirm', 'admit_exam', 'interview_review', 'publicity'].includes(exam.stage)) {
        return false;
      } else if (filters.stage === '报名已结束' && exam.stage !== 'ended') {
        return false;
      }
    }

    // Notice role filter
    if (filters.noticeRole !== '全部') {
      if (filters.noticeRole === '仅看招考简章' && exam.notice_role !== '招考简章') return false;
      if (filters.noticeRole === '考务进展通知' && exam.notice_role === '招考简章') return false;
    }

    // Unlimited major filter
    if (filters.unlimitedMajorOnly && !exam.has_unlimited_major) {
      return false;
    }

    // Query search
    if (queryTerms.length > 0) {
      const hay = [
        exam.title,
        exam.organizer,
        exam.exam_category,
        exam.bianzhi_types.join(' '),
        exam.cities.join(' '),
        exam.exam_subjects.join(' '),
        exam.majors.join(' '),
        exam.excerpt,
        ...(exam.positions || []).map((p) => `${p.department} ${p.employer} ${p.position_name} ${p.position_code || ''} ${p.major_raw}`),
      ]
        .join(' ')
        .toLowerCase();
      if (!queryTerms.every((t) => hay.includes(t))) return false;
    }

    // Profile filter: hide only when all extracted positions are explicitly ineligible
    if (profile.onlyMatchProfile) {
      if (exam.positions && exam.positions.length > 0) {
        const anyPossible = exam.positions.some(
          (row) => evaluateExamPositionEligibility(row, profile).status !== 'ineligible',
        );
        if (!anyPossible) return false;
      }
    }

    return true;
  });

  // Sort
  const stagePriority: Record<ExamStage, number> = {
    closing_soon: 1,
    registering: 2,
    upcoming: 3,
    rolling: 4,
    payment_confirm: 5,
    admit_exam: 6,
    interview_review: 7,
    publicity: 8,
    unknown: 9,
    ended: 10,
  };

  return [...result].sort((a, b) => {
    if (filters.sort === 'published') {
      return (b.published_at || '').localeCompare(a.published_at || '');
    }
    if (filters.sort === 'reg_end') {
      const aEnd = a.schedule.reg_end || '9999-99-99';
      const bEnd = b.schedule.reg_end || '9999-99-99';
      if (aEnd !== bEnd) return aEnd.localeCompare(bEnd);
      return (b.published_at || '').localeCompare(a.published_at || '');
    }
    if (filters.sort === 'headcount') {
      const aHc = a.total_headcount ?? 0;
      const bHc = b.total_headcount ?? 0;
      if (bHc !== aHc) return bHc - aHc;
      return (b.published_at || '').localeCompare(a.published_at || '');
    }
    // Smart sort: active registrations first, then by published date desc
    const pa = stagePriority[a.stage] ?? 9;
    const pb = stagePriority[b.stage] ?? 9;
    if (pa !== pb) return pa - pb;
    return (b.published_at || '').localeCompare(a.published_at || '');
  });
}

export interface FlattenedExamPosition extends ExamPositionRow {
  exam: ExamAnnouncement;
  eligibility: PositionEligibilityResult;
}

export function flattenAndFilterExamPositions(
  exams: ExamAnnouncement[],
  filters: ExamFilters,
  profile: ExamUserProfile,
): FlattenedExamPosition[] {
  const filteredExams = filterExams(exams, { ...filters, view: 'announcements' }, { ...profile, onlyMatchProfile: false }, {});
  const queryTerms = filters.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const selectedCities = filters.cities.filter((c) => c && c !== '全部');

  const rows: FlattenedExamPosition[] = [];
  for (const exam of filteredExams) {
    for (const pos of exam.positions || []) {
      if (selectedCities.length > 0 && pos.city) {
        const cityMatched = selectedCities.some((c) => pos.city.includes(c) || exam.cities.includes(c));
        if (!cityMatched) continue;
      }
      if (filters.bianzhi !== '全部' && pos.bianzhi !== filters.bianzhi) continue;
      if (filters.unlimitedMajorOnly && !/不限|无限制/.test(pos.major_raw || '')) continue;

      if (queryTerms.length > 0) {
        const hay = `${pos.department} ${pos.employer} ${pos.position_name} ${pos.position_code || ''} ${pos.major_raw} ${pos.city} ${pos.other_conditions || ''} ${exam.title}`.toLowerCase();
        if (!queryTerms.every((t) => hay.includes(t))) continue;
      }

      const eligibility = evaluateExamPositionEligibility(pos, profile);
      if (profile.onlyMatchProfile && eligibility.status === 'ineligible') continue;

      rows.push({
        ...pos,
        exam_title: exam.title,
        exam,
        eligibility,
      });
    }
  }
  return rows;
}
