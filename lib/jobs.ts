import { PROVINCE_CITIES, citiesInText, workplaceEvidence } from './cities.ts';
import { assessOpportunityValidity, deadlineTime } from './opportunity-validity.ts';
import { matchesEducationRequirement, positionMatches } from './eligibility.ts';
import { jobMatchesMajor, MAX_EXTRACTED_MAJORS } from './job-major-matcher.ts';
import { PERSONAL_DETAIL_FIELDS, validatePersonalDetails, mergePersonalRecords } from './personal-records.ts';
import employerBrands from '../config/employer-brands.json' with { type: 'json' };
import campusLocations from '../config/campus-locations.json' with { type: 'json' };
import type { CardSummaryMeta } from './card-summary.ts';

export function shanghaiDay(value: string | number): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp + 8 * 3600000).toISOString().slice(0, 10) : '';
}

export function chinaDayStart(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  const dayIndex = Math.floor((ms + 8 * 3600000) / 86400000);
  return dayIndex * 86400000 - 8 * 3600000;
}

export function isTodayOpportunity(job: Job, now: number): boolean {
  const today = shanghaiDay(now);
  const pub = publicationDate(job, now);
  return (
    (pub ? shanghaiDay(pub) === today : false) ||
    shanghaiDay(job.first_seen_at) === today ||
    substantiveBoostDate(job, now) === today
  );
}

export function isSupplementOpportunity(job: Job): boolean {
  return /补录|补招|追加|第[二两三]批|春招补录|秋招补录|续聘/.test(job.title) ||
    job.recent_change?.type === 'supplemental' || job.lifecycle_stage === 'supplemental';
}

export type PositionRequirement = {
  name: string;
  position_name?: string;
  category?: string;
  majors?: string[];
  education?: string;
  count?: string;
  city?: string;
  cohort?: string;
  notes?: string;
  source_type?: string;
  source_file?: string;
  source_url?: string;
};

export type LifecycleStage =
  | 'upcoming'
  | 'accepting'
  | 'extended'
  | 'supplemental'
  | 'selection'
  | 'expiring_soon'
  | 'unconfirmed'
  | 'expired';

export interface TimelineEvent {
  date: string;
  timestamp?: string;
  type:
    | 'published'
    | 'deadline_extended'
    | 'supplemental'
    | 'positions_updated'
    | 'selection_stage'
    | 'content_updated'
    | 'source_repost';
  title: string;
  detail: string;
  source?: string;
}

export interface RecentChange {
  type:
    | 'deadline_extended'
    | 'supplemental'
    | 'positions_updated'
    | 'selection_stage'
    | 'content_updated';
  label: string;
  date: string;
  detail: string;
}

export type ChangeTypeFilter = '全部' | '有变更' | '截止延期' | '补录招募' | '岗位调整' | '考核阶段';

export type TalkEvent = {
  id: string;
  source_school?: string;
  date: string;
  start_time?: string | null;
  end_time?: string | null;
  city?: string | null;
  school: string;
  venue: string;
  url: string;
  city_resolution?: { method: 'explicit' | 'campus' | 'unknown'; rule_id?: string; reason?: string };
  event_type?: 'talk' | 'interview' | 'test' | 'job_fair' | 'guidance' | 'other' | 'unknown';
  mode?: 'offline' | 'online' | 'hybrid' | 'unknown';
  status?: 'scheduled' | 'cancelled';
  registration_url?: string;
  access_policy?: string;
  event_updated_at?: string;
};

export type Job = {
  card_summary?: CardSummaryMeta;
  listing_facts?: {
    version: 1;
    salary?: { min: number; max: number | null; raw: string };
    salary_display?: { cleanTitle: string; salary: string | null };
    selection_notice?: boolean;
    long_term?: boolean;
    change_dates?: string[];
    position_change_dates?: string[];
    source_names?: string[];
    detail_pending?: boolean;
  };
  id: string;
  title: string;
  company: string;
  company_note?: string;
  company_original?: string;
  company_conflict?: boolean;
  source_id: string;
  source?: string;
  source_name: string;
  source_url: string;
  talk_event?: TalkEvent | null;
  talk_events?: TalkEvent[];
  talk_attached_to?: string;
  published_at: string | null;
  date_label?: string;
  provenance?: string;
  duplicate_sources?: {
    id?: string;
    source?: string;
    source_name?: string;
    title: string;
    announcement_title?: string;
    url: string;
    published_at?: string | null;
    application_url?: string;
    facts?: Record<string, unknown>;
  }[];
  duplicate_ids?: string[];
  classification_note?: string;
  domestic_status?: 'domestic' | 'mixed' | 'overseas' | 'unknown';
  search_text?: string;
  details_available?: boolean;
  kind: string;
  types: string[];
  graduation_years: string[];
  sectors: string[];
  directions: string[];
  cities: string[];
  possible_cities?: string[];
  province_possible?: boolean;
  location_evidence: string[];
  education: string;
  deadline: string | null;
  deadline_evidence?: string | null;
  deadline_precision: string | null;
  application_url: string | null;
  emails?: string[];
  attachments?: { title: string; url: string; parse_status?: 'parsed' | 'no_table' | 'deferred' }[];
  links?: { title: string; url: string }[];
  qr_attachment?: boolean;
  excerpt: string;
  body?: string;
  first_seen_at: string;
  updated_at: string;
  last_verified_at: string;
  revision: number;
  positions?: PositionRequirement[];
  position_matches?: PositionRequirement[];
  employment_type?: 'full_time' | 'internship' | 'part_time' | 'unknown';
  employer_brand?: string;
  company_department?: string;
  availability_evidence?: { kind: 'open' | 'long_term'; text: string; checked_at?: string | null; url?: string; verified: boolean } | null;
  position_count?: number;
  sample_positions?: string[];
  majors?: string[];
  lifecycle_stage?: LifecycleStage;
  listing_status?: 'active' | 'unconfirmed' | 'withdrawn';
  listing_checked_at?: string;
  timeline?: TimelineEvent[];
  recent_change?: RecentChange;
};
export type Source = {
  id: string;
  name: string;
  url: string;
  scope?: string;
  recruitment_types?: string[];
  sectors?: string[];
  trust?: string;
  source_family?: string;
  status?: string;
  pages?: number;
  discovered?: number;
  parsed?: number;
  cached?: number;
  coverage?: string;
  last_success_at?: string | null;
  last_attempt_at?: string | null;
  last_list_read_at?: string | null;
  head_scan_at?: string | null;
  pending_details?: number;
  oldest_pending_at?: string | null;
  pending_age_unknown?: number;
  errors?: { url: string; reason: string }[];
};
export type Snapshot = {
  browse_index?: { version: number; count: number; shards: string[]; search_shards: string[] };
  schema_version: number;
  generated_at: string;
  last_success_at: string | null;
  schedule_enabled: boolean;
  details_url?: string;
  detail_shards?: Record<string, string>;
  search_url?: string;
  index_shards?: string[];
  index_count?: number;
  search_shards?: string[];
  coverage_url?: string;
  partial?: boolean;
  partial_total?: number;
  cities: string[];
  jobs: Job[];
  sources: Source[];
};
export type PersonalRecord = { saved?: boolean; applied?: boolean; hidden?: boolean; readAt?: string | null;
  application_stage?: 'planned' | 'applied' | 'test' | 'interview' | 'offer' | 'rejected' | 'withdrawn';
  applied_at?: string | null; next_action_at?: string | null; next_action_note?: string; notes?: string; personal_updated_at?: string | null };
export type Personal = Record<string, PersonalRecord>;
export type SortOrder = 'newest' | 'deadline_asc' | 'salary_desc' | 'reputation_desc' | 'employer_intent_desc';
export type RadarFocus = 'none' | 'today' | 'supplement' | 'urgent' | 'change';
export type Filters = {
  city: string;
  type: string;
  year: string;
  sector: string;
  direction: string;
  query: string;
  education: string;
  includeUncertain: boolean;
  locationScope: 'exact' | 'possible' | 'unknown';
  showExpired: boolean;
  view: string;
  onlyNew: boolean;
  onlyUnread: boolean;
  provenance: string;
  kind: string;
  salary: string;
  sort: SortOrder;
  changeType: ChangeTypeFilter;
  radarFocus: RadarFocus;
  workCities?: string[];
  includeRelatedTalks?: boolean;
  employmentType?: 'all' | 'full_time' | 'internship' | 'part_time';
  validity?: 'all' | 'confirmed_open' | 'long_term' | 'unconfirmed';
  major?: string;
  includeUnlimitedMajor?: boolean;
  includeUnstatedMajor?: boolean;
  reputationMin?: 'all' | '3' | '4';
  includeUnrated?: boolean;
  applicationStage?: 'all' | NonNullable<PersonalRecord['application_stage']>;
};
export const defaultFilters: Filters = {
  city: '济南',
  type: '全部',
  year: '全部',
  sector: '全部',
  direction: '全部',
  query: '',
  education: '',
  includeUncertain: true,
  locationScope: 'exact',
  showExpired: false,
  view: 'all',
  onlyNew: false,
  onlyUnread: false,
  provenance: '全部',
  kind: '全部',
  salary: '全部',
  sort: 'newest',
  changeType: '全部',
  radarFocus: 'none',
  includeRelatedTalks: false,
  employmentType: 'all',
  validity: 'all',
  major: '',
  includeUnlimitedMajor: false,
  includeUnstatedMajor: false,
  reputationMin: 'all',
  includeUnrated: true,
  applicationStage: 'all',
};

export const UNKNOWN_SECTOR = '单位性质未明确';

export function selectedWorkCities(filters: Filters): string[] {
  return filters.workCities ?? (filters.city === '全部城市' ? [] : [filters.city]);
}

export function workCitiesLabel(filters: Filters): string {
  return selectedWorkCities(filters).join(' / ') || '全部城市';
}
export function publicationDate(job: Job, now = Date.now()): string {
  const value = job.published_at || '';
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  const today = shanghaiDay(now);
  const rawDay = shanghaiDay(value);
  if (!rawDay || rawDay > today) return '';

  // Heal ATS portals (e.g. Zhiye / Haier) that refresh PostDate on every daily
  // crawl without substantive recruitment changes: once verified on a later day
  // than first_seen_at, an announcement's initial publication date cannot drift
  // past its first-seen calendar day.
  const firstSeenDay = job.first_seen_at ? shanghaiDay(job.first_seen_at) : '';
  const verifiedDay = job.last_verified_at ? shanghaiDay(job.last_verified_at) : '';
  if (firstSeenDay && verifiedDay > firstSeenDay && rawDay > firstSeenDay) {
    const earliestTimelinePub = (job.timeline ?? [])
      .filter((event) => event.type === 'published' && event.date)
      .map((event) => shanghaiDay(event.date))
      .filter((day) => Boolean(day) && day <= firstSeenDay)
      .sort()[0];
    return earliestTimelinePub || firstSeenDay;
  }
  return value;
}

/** Return true only when a recent change represents a genuine recruitment
 * expansion (supplemental batch, deadline extension, added positions/majors, or
 * newly added cities), excluding routine link/prose maintenance. */
export function isSubstantiveReopenChange(change?: RecentChange | null): boolean {
  if (!change) return false;
  if (change.type === 'supplemental') return true;
  if (change.type === 'deadline_extended') {
    return deadlineChangeKind(change) === 'extended';
  }
  if (change.type === 'positions_updated') {
    const text = (change.label || '') + (change.detail || '');
    return !/就绪|首次提取|缩减|减少/.test(text) && !/为 0 个职位/.test(change.detail || '');
  }
  if (change.type === 'content_updated') {
    return change.label === '地点调整' && !/补全/.test(change.detail || '') && /新增/.test(change.detail || '');
  }
  return false;
}

export function substantiveBoostDate(job: Job, now = Date.now()): string {
  if (!isSubstantiveReopenChange(job.recent_change)) return '';
  const rawDate = job.recent_change?.date || '';
  const changeDay = rawDate ? shanghaiDay(rawDate) : '';
  if (!changeDay || changeDay > shanghaiDay(now)) return '';
  return changeDay;
}

export function effectiveNewestDate(job: Job, now = Date.now()): string {
  const pubRaw = publicationDate(job, now);
  const pubDay = pubRaw ? shanghaiDay(pubRaw) : '';
  const boostDay = substantiveBoostDate(job, now);
  return boostDay > pubDay ? boostDay : pubDay;
}

function newestTieBreakerMs(job: Job, effectiveDay: string, pubDay: string): number {
  if (!effectiveDay) return 0;
  if (effectiveDay > pubDay) {
    const updatedMs = Date.parse(job.updated_at || '');
    return Number.isFinite(updatedMs) ? updatedMs : 0;
  }
  const firstSeenMs = Date.parse(job.first_seen_at || '');
  if (Number.isFinite(firstSeenMs)) return firstSeenMs;
  const pubMs = Date.parse(job.published_at || '');
  return Number.isFinite(pubMs) ? pubMs : 0;
}

export function compareJobsByNewest(a: Job, b: Job, now = Date.now()): number {
  const aPub = publicationDate(a, now);
  const aPubDay = aPub ? shanghaiDay(aPub) : '';
  const aBoostDay = substantiveBoostDate(a, now);
  const aEff = aBoostDay > aPubDay ? aBoostDay : aPubDay;

  const bPub = publicationDate(b, now);
  const bPubDay = bPub ? shanghaiDay(bPub) : '';
  const bBoostDay = substantiveBoostDate(b, now);
  const bEff = bBoostDay > bPubDay ? bBoostDay : bPubDay;

  const cmpDay = bEff.localeCompare(aEff);
  if (cmpDay !== 0) return cmpDay;

  const bTie = newestTieBreakerMs(b, bEff, bPubDay);
  const aTie = newestTieBreakerMs(a, aEff, aPubDay);
  if (bTie !== aTie) return bTie - aTie;

  return a.id.localeCompare(b.id);
}

export function publicationText(job: Job, now = Date.now()): string {
  return publicationDate(job, now) || (job.published_at ? '日期异常待核实' : '日期未明确');
}

const ATS_TEST_RECORD_RE = /仅供测试使用|^测试(?:专业公司|岗位|职位)$/;

export function isExpired(job: Job, now = Date.now()) {
  if ((job.kind === '宣讲会' || (job.source_id || '').endsWith('-talks')) && job.talk_event?.status === 'cancelled') return true;
  if (job.listing_status === 'withdrawn') return true;
  if (ATS_TEST_RECORD_RE.test((job.company || '').trim()) || ATS_TEST_RECORD_RE.test((job.title || '').trim())) return true;
  if (job.deadline) {
    const t = deadlineTime(job.deadline);
    return !Number.isNaN(t) && t < now;
  }
  return false;
}
export function normalizeCompanyName(name?: string | null): string {
  if (!name) return '';
  return name
    .trim()
    .replace(/\s+/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\((?:中国|集团|有限|股份|分公司|有限责任).*?\)/g, '')
    .replace(/(?:有限责任公司|股份有限公司|有限公司|集团有限公司|集团)(?=(?:[\u4e00-\u9fa5]{2,10}?(?:分行|支行|分公司|中心|办事处))?$)/g, '');
}
const departmentPattern = new RegExp(employerBrands.department_pattern);
export function employerBrand(sourceId?: string): string {
  return (employerBrands.sources as Record<string, string>)[sourceId || ''] || '';
}
export function employerGroupName(job: Job): string {
  const raw = (job.company || '').trim();
  const brand =
    employerBrand(job.source_id) ||
    (employerBrands.reference_sources as Record<string, string>)[job.source_id || ''] ||
    '';
  if (!raw) return brand;
  return departmentPattern.test(raw) ? brand || job.company : job.company;
}
export function formatCompanyDisplay(company?: string | null, title?: string | null, sourceId?: string): { displayCompany: string; monogram: string } {
  const rawComp = (company ?? '').trim();
  const rawTitle = (title ?? '').trim();
  const brand = employerBrand(sourceId) || (employerBrands.reference_sources as Record<string, string>)[sourceId || ''] || '';
  let displayCompany = rawComp || brand;
  if (rawComp === '所属区县及以下机构' && sourceId?.startsWith('picc-')) {
    const piccBranch = rawTitle.match(/^(人保(?:财险|寿险|健康|资产|金服|养老|再保险|科技)(?:公司)?)-([^-\s]+分公司)/);
    displayCompany = piccBranch
      ? `${piccBranch[1]}${piccBranch[2]} · ${rawComp}`
      : `${brand || '中国人民保险集团'} · ${rawComp}`;
  } else if (brand && rawComp && departmentPattern.test(rawComp) && !rawComp.includes(brand)) {
    displayCompany = `${brand} · ${rawComp}`;
  }

  const monogramBase = displayCompany || rawTitle;
  const norm = normalizeCompanyName(monogramBase);
  const monogram = (norm.length >= 2 ? norm.slice(0, 2) : monogramBase.slice(0, 2)) || '招';

  return { displayCompany: displayCompany || '企业名称待核实', monogram };
}
export function effectiveJobTypes(job: Pick<Job, 'types' | 'source_id' | 'kind'>): string[] {
  if (job.types?.length) return job.types;
  if (job.kind === '具体岗位' && /(?:-(?:positions|jobs))$/.test(job.source_id || '')) {
    return ['校招'];
  }
  return [];
}

const ONLINE_EVENT_VENUE_RE = /线上|直播|空中宣讲|腾讯会议|网络会议/;
const CAMPUS_LOCATION_RULES = campusLocations.rules.map((rule) => ({
  school: rule.school,
  city: rule.city,
  campusLabels:
    'campus_labels' in rule && Array.isArray(rule.campus_labels) ? rule.campus_labels : [],
  pattern: new RegExp(rule.venue_pattern),
}));

export function effectiveEventCity(
  event: Pick<TalkEvent, 'city' | 'mode' | 'school' | 'venue'>,
): string | null {
  const venue = event.venue || '';
  if (event.mode === 'online' || ONLINE_EVENT_VENUE_RE.test(venue)) return null;
  if (event.city) return event.city;
  const school = event.school || '';
  const matches = CAMPUS_LOCATION_RULES.filter(
    (rule) => (rule.school === school || venue.includes(rule.school)) && rule.pattern.test(venue),
  );
  let locationText = venue;
  for (const rule of matches) {
    for (const label of rule.campusLabels) {
      locationText = locationText.replaceAll(label, '');
    }
  }
  const explicit = citiesInText(locationText);
  const inferred = new Set(matches.map((rule) => rule.city));
  if (
    explicit.length > 1 ||
    inferred.size > 1 ||
    (explicit.length === 1 && inferred.size === 1 && !inferred.has(explicit[0]))
  ) {
    return null;
  }
  if (explicit.length === 1) return explicit[0];
  if (inferred.size === 1) return [...inferred][0];
  return null;
}

export function effectiveJobSectors(
  job: Pick<Job, 'company' | 'title' | 'sectors' | 'source_id'> & { kind?: string },
): string[] {
  const rawSectors = job.sectors ?? [];
  if (!rawSectors.length) return rawSectors;

  const comp = (job.company || '').trim();
  const sourceId = job.source_id || '';
  const brand =
    employerBrand(sourceId) ||
    (employerBrands.reference_sources as Record<string, string>)[sourceId] ||
    '';
  const rawTitle = (job.title || '').split('\n')[0].trim();
  const titleEntity = rawTitle.includes('·')
    ? rawTitle.split('·')[0].trim()
    : job.kind === '具体岗位' && comp
      ? ''
      : rawTitle;
  const employerEntity = `${comp} ${titleEntity}`;
  const entityText = `${comp} ${brand} ${titleEntity}`;

  const isExplicitBankEmployer =
    /银行|农信|信用社|农商行|村镇银行/.test(employerEntity) &&
    !/保险|人寿|财险|产险|寿险|再保险/.test(employerEntity);

  const isExplicitInsurer =
    (/(?:保险|人寿|财险|产险|寿险|再保险|太保|人保)/.test(entityText) ||
      /^(?:chinalife|taiping|picc)-/.test(sourceId)) &&
    !/银行|农信|信用社|农商行|村镇银行/.test(employerEntity);

  const hasBankEntity =
    !isExplicitInsurer &&
    (/银行|农信|信用社|农商行|村镇银行/.test(entityText) ||
      /^(?:boc|psbc)-/.test(sourceId) ||
      ((!comp || comp === '单位名称待核实' || comp === '招聘单位见原页面') &&
        /(?:总行|分行|支行)|柜员/.test(rawTitle)));

  const isCorpEntity = /有限公司|股份有限公司|有限责任公司|集团公司|合伙企业|事务所/.test(
    employerEntity,
  );

  const filtered = rawSectors.filter((sector) => {
    if (sector === '银行' && !hasBankEntity) return false;
    if (sector === '保险' && isExplicitBankEmployer) return false;
    if ((sector === '公务员' || sector === '事业单位') && isCorpEntity) return false;
    return true;
  });

  if (isExplicitInsurer && !filtered.includes('保险') && rawSectors.includes('银行')) {
    filtered.unshift('保险');
  }

  if (filtered.length === 0) {
    return ['企业 / 其他'];
  }
  if (
    filtered.length === rawSectors.length &&
    filtered.every((sector, idx) => sector === rawSectors[idx])
  ) {
    return rawSectors;
  }
  return filtered;
}
export function formatEducationDisplay(education?: string | null, fallback = '学历待核实'): string {
  if (!education) return fallback;
  const cleaned = education
    .replace(/(?:20)?\d{2}\s*届(?:[\s,/、，|-]*(?:20)?\d{2}\s*届)*/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,/、，|-]+|[\s,/、，|-]+$/g, '')
    .trim();
  if (!cleaned || cleaned === '未明确 / 见原公告' || cleaned === '招聘条件待核实' || cleaned === '未明确') {
    return fallback;
  }
  return cleaned;
}
const TRAILING_ATS_CODE_RE =
  /\s*[(（[【]\s*(?:岗位编号|职位编号|职位代码|岗位代码|编号)?\s*[:：]?\s*[A-Za-z]{1,4}[-_]?\d{4,12}\s*[)）\]】]\s*$/;

export function stripTrailingAtsCode(title: string): string {
  return title.replace(TRAILING_ATS_CODE_RE, '').trim();
}

export function sanitizeDisplayExcerpt(text: string | null | undefined): string {
  if (!text) return '';
  const trimmed = text.trim();
  if (!trimmed || trimmed === '单位介绍与岗位说明请查看原公告。') return '';
  return trimmed
    .replace(/([：:])\s*[：:]+/g, '：')
    .replace(/([；;])\s*[；;]+/g, '；')
    .replace(/([，,])\s*[，,]+/g, '，')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function sanitizeVenueDisplay(venue: string | null | undefined, school?: string | null): string {
  const raw = (venue ?? '').trim();
  if (!raw) return '';
  let out = raw.replace(/\s+/g, ' ');
  const schoolTrimmed = (school ?? '').trim();
  if (schoolTrimmed && out.startsWith(schoolTrimmed) && out.length > schoolTrimmed.length) {
    out = out.slice(schoolTrimmed.length).replace(/^[\s·•—-]+/, '').trim() || out;
  }
  out = out.replace(/^([\u4e00-\u9fa5A-Za-z0-9]{2,14}?)\s*\1+/, '$1');
  // Strip redundant leading/trailing bracketed campus or school tag when already present in the venue body
  const leadMatch = out.match(/^[【[（(]([^】\]）)]{2,16})[】\]）)]\s*(.+)$/);
  if (leadMatch && (leadMatch[2].includes(leadMatch[1].trim()) || leadMatch[1].trim() === schoolTrimmed)) {
    out = leadMatch[2].trim();
  }
  const trailMatch = out.match(/^(.+?)\s*[【[（(]([^】\]）)]{2,16})[】\]）)]$/);
  if (trailMatch && (trailMatch[1].includes(trailMatch[2].trim()) || trailMatch[2].trim() === schoolTrimmed)) {
    out = trailMatch[1].trim();
  }
  return out.trim();
}

export function cardJobTitle(cleanTitle: string, company?: string | null, displayCompany?: string | null): string {
  const rawTitle = cleanTitle.trim();
  if (!rawTitle) return rawTitle;
  const stripped = stripTrailingAtsCode(rawTitle) || rawTitle;
  for (const candidate of [displayCompany, company]) {
    const prefix = (candidate ?? '').trim();
    if (!prefix) continue;
    if (stripped.startsWith(prefix)) {
      const rest = stripped.slice(prefix.length).replace(/^\s*[·•—\-:：]\s*/, '').trim();
      if (rest) return rest;
    }
  }
  return stripped;
}
export function eventDisplayTitle(job: Job): string {
  return job.company
    ? formatCompanyDisplay(job.company, job.title, job.source_id).displayCompany
    : stripTrailingAtsCode(job.title || '') || '校园活动';
}
export function resolveJobId(jobs: Job[], identifier: string): Job | undefined {
  return jobs.find((job) => job.id === identifier) || jobs.find((job) => job.duplicate_ids?.includes(identifier));
}
export function normalizeTitleCore(title: string): string {
  if (!title) return '';
  return title
    .trim()
    .replace(/\s+/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/^[【[(][^】\])]{1,20}[】\])]/g, '')
    .replace(/(?:校园招聘(?:简章|公告|启事)?|招聘(?:简章|公告|启事|信息)?|简章|公告|启事|专场)$/g, '')
    .replace(/(20\d{2})年$/, '$1');
}
const COHORT_CHAIN_WITH_CAMPAIGN_RE =
  /((?:20\d{2})(?:\s*[/、,，\-—–~至及和]\s*(?:20\d{2}|\d{2}))*)\s*(?:届|应届|年应届|年(?:高校)?毕业|(?=校园招聘|校招))/g;
const COHORT_CHAIN_STRICT_RE =
  /((?:20\d{2})(?:\s*[/、,，\-—–~至及和]\s*(?:20\d{2}|\d{2}))*)\s*(?:届|应届|年应届|年(?:高校)?毕业)/g;
const COHORT_CHAIN_TOKEN_RE = /([/、,，\-—–~至及和]?)\s*(20\d{2}|\d{2})/g;
const GENERIC_ANNOUNCEMENT_TAIL_RE =
  /^(?:面向(?:我校|高校|全国|社会))?(?:(?:20\d{2}(?:[/、,，\-—–~至及和](?:20)?\d{2})*(?:年(?:度)?|届|应届|年应届|年(?:高校)?毕业)?))*(?:面向(?:我校|高校|全国|社会|(?:20\d{2}(?:[/、,，\-—–~至及和](?:20)?\d{2})*)?届)?|诚聘|招贤纳士|人才)?(?:春季|秋季|暑期|寒假|校园|高校|毕业生|应届生|应届毕业生|线上|线下|网络|空中|专场|公开|社会|联合){0,3}(?:校园招聘|校招|春招|秋招|社招|招聘|引才)(?:公告|简章|启事|信息|计划|通知|专场|合集|汇总|职位|岗位|启动|火热进行中|进行中|正式启动)?$/;

export function extractTitleCohorts(title: string, includeCampaignLookahead = false): string[] {
  if (!title) return [];
  const pattern = includeCampaignLookahead ? COHORT_CHAIN_WITH_CAMPAIGN_RE : COHORT_CHAIN_STRICT_RE;
  const found = new Set<string>();
  for (const match of title.matchAll(pattern)) {
    const chain = match[1];
    let prevYear: number | null = null;
    for (const token of chain.matchAll(COHORT_CHAIN_TOKEN_RE)) {
      const sep = token[1];
      const raw = token[2];
      let year: number;
      if (raw.length === 4) {
        year = Number(raw);
      } else {
        const two = Number(raw);
        if (two < 20 || two > 39) {
          prevYear = null;
          continue;
        }
        year = 2000 + two;
      }
      if (year < 2020 || year > 2035) {
        prevYear = null;
        continue;
      }
      if (
        (sep === '-' || sep === '—' || sep === '–' || sep === '~' || sep === '至') &&
        prevYear !== null &&
        year > prevYear &&
        year - prevYear <= 4
      ) {
        for (let y = prevYear; y <= year; y += 1) found.add(String(y));
      } else {
        found.add(String(year));
      }
      prevYear = year;
    }
  }
  return [...found].sort();
}

export function resolveEffectiveCohorts(
  titleCohorts: readonly string[],
  graduationYears: readonly string[] | undefined,
  campaignYears: readonly string[] = [],
): string[] {
  const grad = [...new Set((graduationYears ?? []).filter(Boolean))].sort();
  const title = [...new Set(titleCohorts.filter(Boolean))].sort();
  if (title.length > 0) {
    // Only expand to body-derived graduation_years when the title itself already
    // names multiple cohorts (e.g. "2026/2027届" with body "2025/2026/2027届").
    // An explicit single-cohort title ("2026届" vs "2027届") keeps its own cohort
    // so separate annual campaigns whose bodies both mention ["2026", "2027"]
    // never collide.
    if (title.length >= 2 && grad.length >= title.length && title.every((y) => grad.includes(y))) {
      return grad;
    }
    return title;
  }
  if (grad.length > 0) return grad;
  return [...new Set(campaignYears.filter(Boolean))].sort();
}

function extractDedupPhaseAndBatch(title: string): { phase: string; batchTag: string } {
  const t = title ?? '';
  let phase = '校招';
  if (/春(?:季校园招聘|季招聘|招).*?补[录招]|补[录招].*?春[季招]/.test(t)) phase = '春招补录';
  else if (/秋(?:季校园招聘|季招聘|招).*?补[录招]|补[录招].*?秋[季招]/.test(t)) phase = '秋招补录';
  else if (/补录|补招|追加|第[二两三]批|续聘/.test(t)) phase = '补录';
  else if (/提前批/.test(t)) phase = '提前批';
  else if (/春(?:季校园招聘|季招聘|招)/.test(t)) phase = '春招';
  else if (/秋(?:季校园招聘|季招聘|招)/.test(t)) phase = '秋招';
  else if (/社招|社会/.test(t)) phase = '社招';
  else if (/实习/.test(t)) phase = '实习';

  const batchMatch = t.match(/(第[一二两三四五1-5]批|第[一二两三四五1-5]期)/);
  return { phase, batchTag: batchMatch ? batchMatch[1] : '' };
}

function isGenericAnnouncementTitle(title: string, company: string, normComp: string): boolean {
  let t = (title ?? '').replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')');
  while (true) {
    const stripped = t.replace(/^[【[][^】\]]{1,24}[】\]]/, '');
    if (stripped === t) break;
    t = stripped;
  }
  const compClean = (company ?? '').replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')');
  if (compClean && t.startsWith(compClean)) {
    t = t.slice(compClean.length);
  } else if (normComp && t.startsWith(normComp)) {
    t = t.slice(normComp.length).replace(/^(?:有限责任|股份有限|有限|集团有限|集团)?(?:公司)?/, '');
  }
  t = t.replace(/^(?:\([^)]{1,24}\))+/, '').replace(/^[·•—\-:：]+/, '');
  return Boolean(t && GENERIC_ANNOUNCEMENT_TAIL_RE.test(t));
}

function normContentForDedup(value: string | undefined): string {
  return (value ?? '')
    .replace(/[\s\u200b-\u200d\ufeff]+/g, '')
    .replace(/^(?:单位介绍|企业简介|公司简介|企业介绍|公司介绍|单位简介)[:：]/, '')
    .replace(/(?:…|\.{2,})+$/, '');
}

function textMatchesWithOptionalHeader(
  a: string,
  b: string,
  minOverlap: number,
  minRatio = 0,
  maxHeaderOffset = 50,
): boolean {
  if (a === b) return true;
  const maxLen = Math.max(a.length, b.length);
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length >= minOverlap && longer.startsWith(shorter)) {
    if (minRatio <= 0 || shorter.length / maxLen >= minRatio) return true;
  }
  for (const [lead, shifted] of [
    [a, b],
    [b, a],
  ] as const) {
    if (lead.length < minOverlap) continue;
    const idx = shifted.indexOf(lead.slice(0, minOverlap));
    if (idx > 0 && idx <= maxHeaderOffset) {
      const overlapLen = Math.min(lead.length, shifted.length - idx);
      if (
        overlapLen >= minOverlap &&
        (minRatio <= 0 || overlapLen / maxLen >= minRatio) &&
        shifted.slice(idx, idx + overlapLen) === lead.slice(0, overlapLen)
      ) {
        return true;
      }
    }
  }
  return false;
}

function contentMatchesForGenericRepost(existing: Job, candidate: Job): boolean {
  const b1 = normContentForDedup(existing.body);
  const b2 = normContentForDedup(candidate.body);
  if (b1.length >= 100 && b2.length >= 100) {
    return textMatchesWithOptionalHeader(b1, b2, 120, 0.85);
  }
  const e1 = normContentForDedup(existing.excerpt);
  const e2 = normContentForDedup(candidate.excerpt);
  if (e1.length >= 60 && e2.length >= 60) {
    return textMatchesWithOptionalHeader(e1, e2, 60);
  }
  return false;
}

function datesWithinDays(
  d1: string | null | undefined,
  d2: string | null | undefined,
  maxDays = 120,
): boolean {
  const s1 = d1 ? shanghaiDay(d1) : '';
  const s2 = d2 ? shanghaiDay(d2) : '';
  if (!s1 || !s2) return true;
  const t1 = Date.parse(`${s1}T00:00:00Z`);
  const t2 = Date.parse(`${s2}T00:00:00Z`);
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return true;
  return Math.abs(t1 - t2) <= maxDays * 86400000;
}

export function mergeJobIntoExisting(existing: Job, job: Job): void {
  const existingUrls = new Set([
    existing.source_url,
    ...(existing.duplicate_sources ?? []).map((s) => s.url),
  ]);
  if (job.source_url && !existingUrls.has(job.source_url)) {
    existing.duplicate_sources = existing.duplicate_sources ?? [];
    existing.duplicate_sources.push({
      source: job.source || job.source_id,
      source_name: job.source_name,
      title: job.title || job.source_name,
      url: job.source_url,
      ...(job.published_at ? { published_at: job.published_at } : {}),
      ...(job.application_url ? { application_url: job.application_url } : {}),
    });
    existingUrls.add(job.source_url);
  }
  if (job.duplicate_sources?.length) {
    for (const ds of job.duplicate_sources) {
      if (ds.url && !existingUrls.has(ds.url)) {
        existing.duplicate_sources = existing.duplicate_sources ?? [];
        existing.duplicate_sources.push({ ...ds });
        existingUrls.add(ds.url);
      }
    }
  }
  existing.duplicate_ids = existing.duplicate_ids ?? [];
  if (job.id && job.id !== existing.id && !existing.duplicate_ids.includes(job.id)) {
    existing.duplicate_ids.push(job.id);
  }
  if (job.talk_events?.length) {
    const events = new Map((existing.talk_events ?? []).map((event) => [event.id, event]));
    for (const event of job.talk_events) events.set(event.id, event);
    existing.talk_events = [...events.values()].sort((a, b) =>
      `${a.date} ${a.start_time ?? ''}`.localeCompare(`${b.date} ${b.start_time ?? ''}`),
    );
  }
  if (job.duplicate_ids?.length) {
    existing.duplicate_ids = [...new Set([...existing.duplicate_ids, ...job.duplicate_ids])].filter(
      (id) => id !== existing.id,
    );
  }

  if (job.published_at) {
    if (!existing.published_at) {
      const exFirstDay = existing.first_seen_at ? shanghaiDay(existing.first_seen_at) : '';
      const exVerDay = existing.last_verified_at ? shanghaiDay(existing.last_verified_at) : '';
      const jobPubDay = shanghaiDay(job.published_at);
      existing.published_at =
        exFirstDay && exVerDay > exFirstDay && jobPubDay > exFirstDay
          ? exFirstDay
          : job.published_at;
    } else if (job.published_at < existing.published_at) {
      existing.published_at = job.published_at;
    }
  }
  if (!existing.application_url && job.application_url) {
    existing.application_url = job.application_url;
  }
  if (job.deadline) {
    if (!existing.deadline || job.deadline > existing.deadline) {
      existing.deadline = job.deadline;
      existing.deadline_evidence = job.deadline_evidence;
      existing.deadline_precision = job.deadline_precision;
    }
  }
  if (job.emails?.length) {
    existing.emails = [...new Set([...(existing.emails ?? []), ...job.emails])];
  }
  if (job.cities?.length) {
    existing.cities = [...new Set([...(existing.cities ?? []), ...job.cities])].sort();
  }
  if (job.location_evidence?.length) {
    existing.location_evidence = [...new Set([...(existing.location_evidence ?? []), ...job.location_evidence])];
  }
  if (job.graduation_years?.length) {
    existing.graduation_years = [...new Set([...(existing.graduation_years ?? []), ...job.graduation_years])].sort();
  }
  if (job.types?.length) {
    existing.types = [...new Set([...(existing.types ?? []), ...job.types])];
  }
  if (job.attachments?.length) {
    const attUrls = new Set((existing.attachments ?? []).map((a) => a.url));
    for (const a of job.attachments) {
      if (!attUrls.has(a.url)) {
        existing.attachments = existing.attachments ?? [];
        existing.attachments.push(a);
        attUrls.add(a.url);
      }
    }
  }
  if (job.position_matches?.length) {
    const candidates = [...(existing.position_matches || []), ...job.position_matches];
    existing.position_matches = [...new Map(candidates.map((p) => [JSON.stringify(p), p])).values()];
  }
  if (job.positions?.length) {
    existing.positions = existing.positions ?? [];
    const posKey = (p: PositionRequirement) =>
      `${p.name}-${p.city ?? ''}-${p.education ?? ''}-${(p.majors ?? []).slice().sort().join(',')}`;
    const existingKeys = new Set(existing.positions.map(posKey));
    for (const p of job.positions) {
      const key = posKey(p);
      if (!existingKeys.has(key)) {
        existing.positions.push(p);
        existingKeys.add(key);
      }
    }
    existing.position_count = existing.positions.length;
  }
  if (job.majors?.length) {
    existing.majors = [...new Set([...(existing.majors ?? []), ...job.majors])].slice(0, MAX_EXTRACTED_MAJORS);
  }
  if (job.sample_positions?.length && !(existing.sample_positions?.length)) {
    existing.sample_positions = job.sample_positions;
  }
  if (existing.provenance === '第三方线索' && job.provenance === '公开原始来源') {
    existing.source_name = job.source_name;
    existing.source_url = job.source_url;
    existing.source_id = job.source_id;
    existing.provenance = '公开原始来源';
    existing.title = job.title;
    if (job.body) {
      existing.body = job.body;
      existing.excerpt = job.excerpt || existing.excerpt;
    }
  } else {
    if (
      (existing.title ?? '').includes('面向我校') &&
      job.title &&
      !job.title.includes('面向我校') &&
      !(existing.provenance === '公开原始来源' && job.provenance === '第三方线索')
    ) {
      existing.title = job.title;
    }
    if ((job.body?.length ?? 0) > (existing.body?.length ?? 0) + 200) {
      existing.body = job.body;
      existing.excerpt = job.excerpt || existing.excerpt;
    }
  }

  if (job.timeline?.length) {
    existing.timeline = existing.timeline ?? [];
    const existingKeys = new Set(
      existing.timeline.map((e) => `${e.date}-${e.type}-${e.title}`),
    );
    for (const e of job.timeline) {
      const key = `${e.date}-${e.type}-${e.title}`;
      if (!existingKeys.has(key)) {
        existing.timeline.push({ ...e });
        existingKeys.add(key);
      }
    }
    existing.timeline.sort((a, b) => a.date.localeCompare(b.date));

    let hasFirstPublished = false;
    for (const evt of existing.timeline) {
      if (evt.type === 'published' || evt.title === '首次发布') {
        if (!hasFirstPublished) {
          hasFirstPublished = true;
          evt.type = 'published';
          evt.title = '首次发布';
        } else {
          evt.type = 'source_repost';
          evt.title = '跨渠道发布';
          if (evt.source && !evt.detail.includes('同步发布')) {
            evt.detail = `在「${evt.source}」同步发布`;
          }
        }
      }
    }
  }

  if (job.recent_change) {
    const changePrio: Record<string, number> = {
      deadline_extended: 5,
      supplemental: 4,
      selection_stage: 3,
      positions_updated: 2,
      content_updated: 1,
    };
    if (!existing.recent_change) {
      existing.recent_change = job.recent_change;
      if ((job.updated_at ?? '') > (existing.updated_at ?? '')) {
        existing.updated_at = job.updated_at;
      }
    } else {
      const currP = changePrio[existing.recent_change.type] ?? 0;
      const newP = changePrio[job.recent_change.type] ?? 0;
      if (newP > currP) {
        existing.recent_change = job.recent_change;
        if ((job.updated_at ?? '') > (existing.updated_at ?? '')) {
          existing.updated_at = job.updated_at;
        }
      }
    }
  }

  if ((job.listing_checked_at ?? '') > (existing.listing_checked_at ?? '')) {
    existing.listing_status = job.listing_status;
    existing.listing_checked_at = job.listing_checked_at;
  }
  if (!existing.lifecycle_stage && job.lifecycle_stage) {
    existing.lifecycle_stage = job.lifecycle_stage;
  }
}

const UNIVERSITY_SOURCE_ID_RE =
  /(?:-announcements|-positions|-jobs)$|^(?:sdu|nankai|upc|sdei-news|sdei-jobfairs)$/;
const UNIVERSITY_SOURCE_NAME_RE = /大学|学院|高校|学生就业服务平台/;

function isUniversityOrThirdPartyPrimary(job: Job): boolean {
  if (job.source_id?.endsWith('-talks')) return false;
  if (job.provenance === '第三方线索') return true;
  if (UNIVERSITY_SOURCE_ID_RE.test(job.source_id ?? '')) return true;
  return UNIVERSITY_SOURCE_NAME_RE.test(job.source_name ?? '');
}

function isSdufeSourceEntry(entry: { source?: string; source_name?: string; title?: string; url?: string }): boolean {
  const name = entry.source_name || entry.source || entry.title || '';
  return name.includes('山东财经大学') || (entry.url ?? '').includes('/jobsdufe/');
}

function inferSdufeSourceId(sourceName: string, url: string, kind: string): string {
  if (
    kind === '具体岗位' ||
    sourceName.includes('具体岗位') ||
    url.includes('/companyissueinfo/')
  ) {
    return 'jobsdufe-positions';
  }
  return 'jobsdufe-announcements';
}

function trailingUrlNumericId(url: string | undefined): number {
  const match = (url ?? '').match(/(\d{4,})(?:\/)?(?:\?.*)?$/);
  return match ? Number(match[1]) : 0;
}

/**
 * Among equal-tier university portals (or third-party clues), promote
 * 山东财经大学 as the primary display source while keeping `job.id`,
 * `duplicate_ids`, official enterprise `application_url`, and all other
 * merged channels intact. Enterprise official portals and government portals
 * are never demoted.
 */
export function promotePreferredCampusPrimary(job: Job): Job {
  if (!job.duplicate_sources?.length) return job;
  if (job.source_id?.endsWith('-talks')) return job;
  if ((job.source_name ?? '').includes('山东财经大学') || (job.source_id ?? '').startsWith('jobsdufe')) {
    return job;
  }
  if (!isUniversityOrThirdPartyPrimary(job)) return job;

  let bestIdx = -1;
  for (let i = 0; i < job.duplicate_sources.length; i += 1) {
    const candidate = job.duplicate_sources[i];
    if (!candidate.url || !isSdufeSourceEntry(candidate)) continue;
    if (bestIdx < 0) {
      bestIdx = i;
      continue;
    }
    const curr = job.duplicate_sources[bestIdx];
    const candApp = candidate.application_url ? 1 : 0;
    const currApp = curr.application_url ? 1 : 0;
    if (candApp !== currApp) {
      if (candApp > currApp) bestIdx = i;
      continue;
    }
    const candTitle = candidate.announcement_title || candidate.title || '';
    const currTitle = curr.announcement_title || curr.title || '';
    const candClean = candTitle.includes('面向我校') ? 0 : 1;
    const currClean = currTitle.includes('面向我校') ? 0 : 1;
    if (candClean !== currClean) {
      if (candClean > currClean) bestIdx = i;
      continue;
    }
    const candBody = typeof candidate.facts?.body === 'string' ? candidate.facts.body.length : 0;
    const currBody = typeof curr.facts?.body === 'string' ? curr.facts.body.length : 0;
    if (candBody !== currBody) {
      if (candBody > currBody) bestIdx = i;
      continue;
    }
    const candDate = candidate.published_at ?? '';
    const currDate = curr.published_at ?? '';
    if (candDate !== currDate) {
      if (candDate > currDate) bestIdx = i;
      continue;
    }
    if (trailingUrlNumericId(candidate.url) > trailingUrlNumericId(curr.url)) {
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return job;

  const preferred = job.duplicate_sources[bestIdx];
  const formerPrimary = {
    source: job.source || job.source_id,
    source_name: job.source_name,
    title: job.source_name || job.title,
    announcement_title: job.title,
    url: job.source_url,
    ...(job.published_at ? { published_at: job.published_at } : {}),
    ...(job.application_url ? { application_url: job.application_url } : {}),
    ...(job.body
      ? {
          facts: {
            body: job.body,
            ...(job.excerpt ? { excerpt: job.excerpt } : {}),
            title: job.title,
            ...(job.published_at ? { published_at: job.published_at } : {}),
            ...(job.application_url ? { application_url: job.application_url } : {}),
          },
        }
      : {}),
  };

  const nextDuplicates = job.duplicate_sources.filter((_, i) => i !== bestIdx);
  if (formerPrimary.url && !nextDuplicates.some((d) => d.url === formerPrimary.url)) {
    nextDuplicates.unshift(formerPrimary);
  }
  job.duplicate_sources = nextDuplicates;

  const nextSourceName = preferred.source_name || preferred.source || '山东财经大学';
  job.source_name = nextSourceName;
  job.source_url = preferred.url;
  job.source_id = inferSdufeSourceId(nextSourceName, preferred.url, job.kind ?? '招聘公告');
  if (job.source) job.source = nextSourceName;
  job.provenance = '公开原始来源';
  if (!job.application_url && preferred.application_url) {
    job.application_url = preferred.application_url;
  }
  const preferredTitle =
    preferred.announcement_title ||
    (typeof preferred.facts?.title === 'string' ? preferred.facts.title : '');
  if ((job.title ?? '').includes('面向我校') && preferredTitle && !preferredTitle.includes('面向我校')) {
    job.title = preferredTitle;
  }
  const prefBody = typeof preferred.facts?.body === 'string' ? preferred.facts.body : '';
  const prefExcerpt = typeof preferred.facts?.excerpt === 'string' ? preferred.facts.excerpt : '';
  if (prefBody && prefBody.length >= Math.max(100, Math.floor((job.body?.length ?? 0) * 0.8))) {
    job.body = prefBody;
    if (prefExcerpt) job.excerpt = prefExcerpt;
  }
  return job;
}

export function mergeDuplicateOpportunities(jobs: Job[]): Job[] {
  // The optional browsing index is already merged with this same function.
  if (jobs.length && jobs.every((job) => job.listing_facts?.version === 1)) return jobs;
  const groups = new Map<string, Job>();
  for (const job of jobs) {
    const company = job.company?.trim() ?? '';
    const normComp = normalizeCompanyName(company);
    const normTitle = normalizeTitleCore(job.title ?? '');
    const kind = job.kind ?? '招聘公告';
    const cities = (job.cities ?? []).slice().sort().join(',');

    let key: string;
    if (job.source_id?.endsWith('-talks')) {
      key = `talk_${job.id}`;
    } else if (kind === '具体岗位') {
      if (!company || !job.title) {
        key = `pos_fallback_${job.id}`;
      } else {
        key = `pos_${normComp}_${job.title.replace(/\s+/g, '')}_${cities}`;
      }
    } else {
      // Keep campaign years separate from graduation cohorts. A title such as
      // "2026年校园招聘" may recruit the 2027届 cohort; prefer explicit cohorts
      // and let fuller body-derived graduation_years win when it already covers
      // every cohort named in the title.
      const titleCohorts = extractTitleCohorts(job.title ?? '', true);
      const campaignYears = [...new Set([...(job.title ?? '').matchAll(/(20\d{2})\s*(?:年(?:度)?\s*)?(?=校园招聘|校招)/g)].map((m) => m[1]))];
      const cohorts = resolveEffectiveCohorts(titleCohorts, job.graduation_years, campaignYears).join(',');
      const { phase, batchTag } = extractDedupPhaseAndBatch(job.title ?? '');

      if (!company && !normTitle) {
        key = `ann_id_${job.id}`;
      } else if (normComp && cohorts && job.types?.includes('校招')) {
        key = `campus_${normComp}_${cohorts}_${phase}_${batchTag}`;
      } else if (normComp && normTitle) {
        key = `ann_norm_${normComp}_${normTitle}`;
      } else if (normTitle) {
        key = `ann_title_${normTitle}_${cities}`;
      } else {
        key = `ann_exact_${job.title.replace(/\s+/g, '')}_${company}`;
      }
    }

    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        ...job,
        duplicate_sources: job.duplicate_sources ? [...job.duplicate_sources] : [],
        duplicate_ids: job.duplicate_ids ? [...job.duplicate_ids] : [],
      });
    } else {
      mergeJobIntoExisting(existing, job);
    }
  }

  // Pass 2: collapse generic cross-channel announcement reposts (e.g. "面向我校招聘"
  // lacking graduation_years + "2027届校园招聘" from another university) ONLY when
  // company, phase, batch, recruitment type, cohort compatibility, date window, and
  // normalized body/excerpt all match strictly.
  const result: Job[] = [];
  const genericBuckets = new Map<string, Job[]>();
  for (const item of groups.values()) {
    const company = item.company?.trim() ?? '';
    const normComp = normalizeCompanyName(company);
    const kind = item.kind ?? '招聘公告';
    if (
      !normComp ||
      kind === '具体岗位' ||
      item.source_id?.endsWith('-talks') ||
      !isGenericAnnouncementTitle(item.title ?? '', company, normComp)
    ) {
      result.push(item);
      continue;
    }
    const { phase, batchTag } = extractDedupPhaseAndBatch(item.title ?? '');
    const bucketKey = `${normComp}\u0000${phase}\u0000${batchTag}`;
    let candidates = genericBuckets.get(bucketKey);
    if (!candidates) {
      candidates = [];
      genericBuckets.set(bucketKey, candidates);
    }
    const itemTypes = effectiveJobTypes(item);
    const itemCampaignYears = [...new Set([...(item.title ?? '').matchAll(/(20\d{2})\s*(?:年(?:度)?\s*)?(?=校园招聘|校招)/g)].map((m) => m[1]))];
    const itemCohorts = resolveEffectiveCohorts(
      extractTitleCohorts(item.title ?? '', true),
      item.graduation_years,
      itemCampaignYears,
    );
    let merged = false;
    for (const existing of candidates) {
      const exTypes = effectiveJobTypes(existing);
      if (
        exTypes.includes('社招') !== itemTypes.includes('社招') ||
        exTypes.includes('实习') !== itemTypes.includes('实习')
      ) {
        continue;
      }
      const exCampaignYears = [...new Set([...(existing.title ?? '').matchAll(/(20\d{2})\s*(?:年(?:度)?\s*)?(?=校园招聘|校招)/g)].map((m) => m[1]))];
      const exCohorts = resolveEffectiveCohorts(
        extractTitleCohorts(existing.title ?? '', true),
        existing.graduation_years,
        exCampaignYears,
      );
      if (
        exCohorts.length > 0 &&
        itemCohorts.length > 0 &&
        !(exCohorts.every((y) => itemCohorts.includes(y)) || itemCohorts.every((y) => exCohorts.includes(y)))
      ) {
        continue;
      }
      if (!datesWithinDays(existing.published_at, item.published_at)) continue;
      if (!contentMatchesForGenericRepost(existing, item)) continue;
      mergeJobIntoExisting(existing, item);
      merged = true;
      break;
    }
    if (!merged) {
      candidates.push(item);
      result.push(item);
    }
  }
  for (const item of result) {
    promotePreferredCampusPrimary(item);
  }
  return result;
}
export function personalFor(job: Job, personal: Personal) {
  const master = personal[job.id];
  const duplicateRecords = (job.duplicate_ids ?? [])
    .map((id) => personal[id])
    .filter((r): r is NonNullable<typeof r> => Boolean(r));

  let saved: boolean;
  if (master && typeof master.saved === 'boolean') {
    saved = master.saved;
  } else {
    saved = duplicateRecords.some((r) => r.saved);
  }

  let applied: boolean;
  if (master && typeof master.applied === 'boolean') {
    applied = master.applied;
  } else {
    applied = duplicateRecords.some((r) => r.applied);
  }

  let hidden: boolean;
  if (master && typeof master.hidden === 'boolean') {
    hidden = master.hidden;
  } else {
    hidden = duplicateRecords.some((r) => r.hidden);
  }

  let readAt: string | undefined;
  if (master && 'readAt' in master) {
    readAt = master.readAt ?? undefined;
  } else {
    readAt = duplicateRecords.flatMap((r) => (r.readAt ? [r.readAt] : [])).sort().at(-1);
  }

  const details: Partial<PersonalRecord> = {};
  for (const record of [...duplicateRecords].sort((a, b) => (a.personal_updated_at || '').localeCompare(b.personal_updated_at || '')).concat(master ? [master] : [])) {
    for (const field of PERSONAL_DETAIL_FIELDS) if (Object.hasOwn(record, field)) Object.assign(details, { [field]: record[field] });
  }
  return {
    ...details,
    saved,
    applied,
    hidden,
    ...(readAt ? { readAt } : {}),
  };
}
export function isUnread(job: Job, personal: Personal) {
  const readAt = personalFor(job, personal).readAt;
  if (!readAt) return true;
  return Date.parse(job.updated_at) > Date.parse(readAt);
}
export function isPendingApplication(job: Job, record: PersonalRecord, now: number): boolean {
  return !!record.saved && !record.applied && !record.hidden && !isExpired(job, now);
}
export function comparePendingApplications(a: Job, b: Job): number {
  const time = (job: Job) => Number.isFinite(deadlineTime(job.deadline)) ? deadlineTime(job.deadline) : Number.MAX_SAFE_INTEGER;
  return time(a) - time(b) || a.id.localeCompare(b.id);
}
export function mergePersonal(current: Personal, imported: Personal): Personal {
  return mergePersonalRecords(current, imported);
}
export function isDomestic(job: Job) {
  if (job.domestic_status === 'overseas') return false;
  const locationLines = workplaceEvidence(job.location_evidence ?? []);
  const evidence = locationLines.join('\n');
  if (!job.cities.length) {
    const headerText = `${job.company || ''} ${job.title || ''} ${evidence}`;
    if (
      /(?:香港|澳门)(?:分行|支行|子公司|分公司|代表处|地区|工作)|港澳地区/.test(headerText) &&
      !/国内|中国大陆|境内|内地|全国|各地可选|不限城市|各地招聘|各省市/.test(headerText)
    ) {
      return false;
    }
  }
  if (job.domestic_status) return true;
  return !(
    /海外|国外|境外|境外地区|海外地区/.test(evidence) &&
    !job.cities.length &&
    !/国内|中国大陆|境内|全国|各地可选|不限城市|各地招聘|各省市/.test(evidence)
  );
}
const cityProvinces = new Map(Object.entries(PROVINCE_CITIES).flatMap(([province, cities]) => cities.map((city) => [city, province] as const)));
const broadProvincePatterns = new Map(Object.keys(PROVINCE_CITIES).map((province) => [province,
  new RegExp(`${province}(?:省)?[ \\t]*(?=$|[/、，,；;\\n]|各地|全省|不限|多个城市|分行辖属|各分支机构)`),
]));
const jobLocationFacts = new WeakMap<Job, { evidenceSource: string[] | undefined; citiesSource: string[];
  evidence: string; detailEvidence: string; provinces: string[]; specificCities: string[] }>();

function locationFacts(job: Job) {
  const cached = jobLocationFacts.get(job);
  if (cached && cached.evidenceSource === job.location_evidence && cached.citiesSource === job.cities) return cached;
  const lines = workplaceEvidence(job.location_evidence ?? []);
  const evidence = lines.join('\n');
  const details = lines.filter((line) => /^(?:工作地点|工作城市|岗位地点|工作地域|招聘地点|招聘机构|工作区域|意向工作地|意向城市|工作地|招聘城市|所属分行|所属分公司)/.test(line));
  const detailEvidence = details.join('\n');
  const facts = { evidenceSource: job.location_evidence, citiesSource: job.cities, evidence,
    detailEvidence: details.length ? detailEvidence : evidence,
    provinces: Object.keys(PROVINCE_CITIES).filter((province) => evidence.includes(province)),
    specificCities: citiesInText(detailEvidence, job.cities.length === 0) };
  jobLocationFacts.set(job, facts);
  return facts;
}
export function locationMatch(
  job: Job,
  city: string,
): 'exact' | 'possible' | 'unknown' | 'none' {
  if (city === '全部城市' || job.cities.includes(city)) return 'exact';
  // Only recruitment location evidence counts; headquarters and body mentions do not.
  const { evidence, detailEvidence, provinces, specificCities } = locationFacts(job);
  const province = cityProvinces.get(city);
  // A specific city in a recruitment-location line takes precedence over a
  // nearby province/national label. This prevents “上海、全国、海外” from
  // being presented as a possible Jinan opportunity.
  const broadPattern = province && broadProvincePatterns.get(province);
  if (specificCities.includes(city)) return 'exact';
  if (broadPattern && broadPattern.test(detailEvidence)) return 'possible';
  if (specificCities.length) return 'none';
  if (/全国|不限城市|各地可选|各地招聘|各省市/.test(evidence)) return 'possible';
  if (job.cities.length || provinces.length) return 'none';
  return 'unknown';
}

export function locationSummary(job: Job) {
  if (job.cities.length) return job.cities.join(' / ');
  const evidence = (job.location_evidence ?? [])
    .join('；')
    .replace(/\s+/g, ' ')
    .trim();
  return evidence
    ? `原文工作地域：${evidence.slice(0, 140)}`
    : '未提取到工作地点，请核对原公告';
}
export type DeadlineCountdown = {
  daysLeft: number;
  text: string;
  urgency: 'urgent' | 'warning' | 'normal' | 'expired';
};

export function getDeadlineCountdown(
  deadline: string | null | undefined,
  now = Date.now(),
): DeadlineCountdown | null {
  if (!deadline) return null;
  const target = deadlineTime(deadline);
  if (Number.isNaN(target)) return null;
  const diffMs = target - now;
  if (diffMs <= 0) {
    return { daysLeft: 0, text: '已截止', urgency: 'expired' };
  }
  // Recruitment dates use Beijing time (UTC+8). Calendar-day ordinals avoid
  // constructing two Intl formatters for every card/radar candidate, and do
  // not depend on the visitor's system timezone or daylight-saving changes.
  const shanghaiDayNumber = (timestamp: number) => Math.floor((timestamp + 8 * 3600000) / 86400000);
  const daysLeft = Math.max(0, shanghaiDayNumber(target) - shanghaiDayNumber(now));

  if (daysLeft === 0) {
    return { daysLeft: 0, text: '今日截止', urgency: 'urgent' };
  }
  if (daysLeft === 1) {
    return { daysLeft: 1, text: '剩 1 天截止', urgency: 'urgent' };
  }
  if (daysLeft <= 3) {
    return { daysLeft, text: `剩 ${daysLeft} 天截止`, urgency: 'urgent' };
  }
  if (daysLeft <= 7) {
    return { daysLeft, text: `剩 ${daysLeft} 天截止`, urgency: 'warning' };
  }
  return { daysLeft, text: `剩 ${daysLeft} 天`, urgency: 'normal' };
}

export type SalaryRange = {
  min: number;
  max: number;
  raw: string;
};

const MIXED_SALARY_UNITS_RE =
  /\d+(?:\.\d+)?\s*(?:k|K|元)\s*[-~至–—]\s*\d+(?:\.\d+)?\s*[万wW]|\d+(?:\.\d+)?\s*[万wW]\s*[-~至–—]\s*\d+(?:\.\d+)?\s*(?:k|K|元)/;

function salaryUnitMultiplier(unit: string): number {
  if (unit === '万' || unit === 'w' || unit === 'W') return 10000;
  if (unit === 'k' || unit === 'K') return 1000;
  return 1;
}

function isWanSalaryUnit(unit: string): boolean {
  return unit === '万' || unit === 'w' || unit === 'W';
}

export function parseSalaryRange(job: Job): SalaryRange | null {
  if (job.listing_facts?.version === 1) {
    const salary = job.listing_facts.salary;
    if (!salary) return null;
    const rawMax = salary.max ?? Number.POSITIVE_INFINITY;
    if (
      salary.min <= 0 ||
      rawMax < 1000 ||
      salary.min > rawMax ||
      MIXED_SALARY_UNITS_RE.test(salary.raw || '')
    ) {
      const reparsedFromRaw = salary.raw
        ? parseSalaryRange({ ...job, listing_facts: undefined, title: `岗位 ${salary.raw}`, excerpt: '' })
        : null;
      if (reparsedFromRaw) {
        return { ...reparsedFromRaw, raw: salary.raw };
      }
      return parseSalaryRange({ ...job, listing_facts: undefined });
    }
    if (
      salary.min >= 60000 &&
      /[万wW]/.test(salary.raw) &&
      !/年|\/月|月薪|每月/.test(salary.raw)
    ) {
      return {
        min: Math.round(salary.min / 12),
        max: Number.isFinite(rawMax) ? Math.round(rawMax / 12) : Number.POSITIVE_INFINITY,
        raw: salary.raw,
      };
    }
    return { ...salary, max: rawMax };
  }
  const title = job.title;
  const excerpt = job.excerpt || '';
  let salaryContext = title;

  // 1. Check title end: (\n6000-8000元, (8k-15k), 20000元以上, 15~18W/年, 15W-50W, 8k-1.2万/月)
  let m = title.match(
    /(?:[（(\n\s])(\d+(?:\.\d+)?)\s*(k|K|万|w|W|元)?\s*[-~至–—]\s*(\d+(?:\.\d+)?)\s*(k|K|万|w|W|元)?(?:·\d+薪)?(?:元|\/月|\/年|\/天|人民币)?(?:[)）\s]*)$/,
  );
  let isAbove = false;
  if (!m) {
    m = title.match(
      /(?:[（(\n\s])(\d+(?:\.\d+)?)\s*(k|K|万|w|W|元)?\s*(?:以上|及以上)(?:[)）\s]*)$/,
    );
    if (m) isAbove = true;
  }
  if (!m) {
    const exMatch = excerpt.match(
      /薪资(?:待遇)?[:：]\s*([^\s,，;；\n*]*(?:\s*[-~至–—]\s*[^\s,，;；\n*]+)?)/,
    );
    if (exMatch && exMatch[1].trim()) {
      const rawText = exMatch[1].trim();
      salaryContext = rawText;
      m = rawText.match(
        /(\d+(?:\.\d+)?)\s*(k|K|万|w|W|元)?\s*[-~至–—]\s*(\d+(?:\.\d+)?)\s*(k|K|万|w|W|元)?/,
      );
      if (!m) {
        m = rawText.match(
          /(\d+(?:\.\d+)?)\s*(k|K|万|w|W|元)?\s*(?:以上|及以上)/,
        );
        if (m) isAbove = true;
      }
    }
  }

  if (!m) return null;
  if (/\/天|\/日|\/小时|日薪|时薪|美元|港币|USD|HKD/i.test(salaryContext)) return null;

  let val1 = Number.parseFloat(m[1]);
  const rawNum1 = val1;
  const unit1 = m[2] || '';

  const matchedStr = m[0];
  const hasExplicitMonthly = /\/月|月薪|每月/.test(salaryContext) || /\/月|月薪|每月/.test(matchedStr);
  const hasExplicitAnnual =
    /\/年|年薪|每年/.test(salaryContext) || /\/年|年薪|每年/.test(matchedStr);

  if (isAbove) {
    const isWan = isWanSalaryUnit(unit1);
    val1 *= salaryUnitMultiplier(unit1);
    if (hasExplicitAnnual || (isWan && !hasExplicitMonthly && rawNum1 >= 6)) {
      val1 /= 12;
    }
    if (!Number.isFinite(val1) || val1 < 1000) return null;
    return { min: Math.round(val1), max: Number.POSITIVE_INFINITY, raw: m[0].trim() };
  }

  const rawNum2 = Number.parseFloat(m[3]);
  const unit2 = m[4] || '';
  const effUnit1 = unit1 || unit2;
  const effUnit2 = unit2 || unit1;

  val1 = rawNum1 * salaryUnitMultiplier(effUnit1);
  let val2 = rawNum2 * salaryUnitMultiplier(effUnit2);

  const isImplicitAnnualWan =
    !hasExplicitMonthly &&
    isWanSalaryUnit(effUnit1) &&
    isWanSalaryUnit(effUnit2) &&
    val1 >= 60000;

  if (hasExplicitAnnual || isImplicitAnnualWan) {
    val1 /= 12;
    val2 /= 12;
  }

  if (!Number.isFinite(val1) || !Number.isFinite(val2) || val1 <= 0 || val2 < 1000 || val1 > val2) {
    return null;
  }
  // Guard against calendar years e.g. 2024-2025 or 2026-0
  if (!effUnit1 && !effUnit2 && rawNum1 >= 2010 && rawNum1 <= 2030 && rawNum2 >= 2010 && rawNum2 <= 2035) {
    return null;
  }
  if (rawNum1 >= 2010 && rawNum1 <= 2030 && rawNum2 < 100 && !unit1 && !unit2) return null;

  return {
    min: Math.round(val1),
    max: Math.round(val2),
    raw: m[0].trim(),
  };
}

export function salaryThreshold(salaryFilter: string): number {
  switch (salaryFilter) {
    case '6K以上':
      return 6000;
    case '8K以上':
      return 8000;
    case '10K以上':
      return 10000;
    case '15K以上':
      return 15000;
    case '20K以上':
      return 20000;
    default:
      return 0;
  }
}

export function hasSelectionNotice(job: Job): boolean {
  if (job.listing_facts?.version === 1) return !!job.listing_facts.selection_notice;
  const body = (job.body || job.excerpt || '').slice(0, 1000);
  return job.recent_change?.type === 'selection_stage' ||
    /(?:笔试|面试|初试|复试).*(?:安排|通知|名单|公示|复审)|(?:拟录用|录取公示|录用名单)/.test(job.title || '') ||
    (/(?:笔试|面试|初试|复试).*(?:安排|通知|名单|公示|复审)|(?:拟录用|录取公示|录用名单)/.test(body) &&
     !/(?:具体安排|时间地点|相关安排|时间)?另行通知|流程[：:\s]/.test(body));
}

export function hasLongTermText(job: Job): boolean {
  return job.listing_facts?.version === 1 ? !!job.listing_facts.long_term :
    /长期|常态|常年|招满为止/.test((job.title || '') + (job.body || job.excerpt || '').slice(0, 1000));
}

export function duplicateSourceNames(job: Job): string[] {
  return job.listing_facts?.version === 1 ? job.listing_facts.source_names || [] :
    (job.duplicate_sources || []).map((source) => source.source_name || source.source || source.title || '');
}

export function meaningfulChangeDates(job: Job): string[] {
  if (job.listing_facts?.version === 1) return job.listing_facts.change_dates || [];
  return (job.timeline || []).filter((e) => e.type !== 'published' && e.type !== 'source_repost' &&
    e.title !== '岗位表就绪' && e.detail !== '招聘公告正文或附件内容已同步最新变动' &&
    !/就绪|首次提取/.test(e.title + (e.detail || ''))).map((e) => e.date);
}

export function positionChangeDates(job: Job): string[] {
  return job.listing_facts?.version === 1 ? job.listing_facts.position_change_dates || [] :
    (job.timeline || []).filter((e) => e.type === 'positions_updated' && e.title !== '岗位表就绪').map((e) => e.date);
}

export type DeadlineChangeKind = 'extended' | 'clarified' | 'adjusted';

const ROLLING_DEADLINE_RE =
  /延长至\s*(\d{4}-\d{2}-\d{2})[^\d（(]*[（(]原截止时间[:：]\s*(\d{4}-\d{2}-\d{2})/;

function isRollingHorizonDeadlineChange(change: RecentChange): boolean {
  const m = (change.detail || '').match(ROLLING_DEADLINE_RE);
  if (!m || !change.date) return false;
  const changeMs = Date.parse(`${shanghaiDay(change.date)}T00:00:00Z`);
  const newMs = Date.parse(`${m[1]}T00:00:00Z`);
  const oldMs = Date.parse(`${m[2]}T00:00:00Z`);
  if (!Number.isFinite(changeMs) || !Number.isFinite(newMs) || !Number.isFinite(oldMs)) return false;
  return (
    newMs - changeMs >= 330 * 86400000 &&
    oldMs - changeMs >= 300 * 86400000 &&
    newMs - oldMs <= 14 * 86400000
  );
}

/** The collector records first-known, later and earlier deadlines with the same
 * change type; its label/detail keep the distinction. Only a later deadline is
 * an extension. Unknown labels keep the historical "extended" meaning. */
export function deadlineChangeKind(change?: RecentChange | null): DeadlineChangeKind | null {
  if (change?.type !== 'deadline_extended') return null;
  const detail = change.detail || '';
  if (change.label === '明确截止时间' || detail.startsWith('明确报名截止时间')) return 'clarified';
  if (change.label === '截止调整' || detail.startsWith('报名截止时间调整为')) return 'adjusted';
  if (isRollingHorizonDeadlineChange(change)) return 'clarified';
  return 'extended';
}

/** Card-level reminder: only recent changes that alter what an applicant should
 * do. Text refinements, attachments and a first-known deadline stay in the
 * detail timeline (the deadline itself is already shown on the card). */
export function cardChangeAlert(job: Job, now = Date.now()): { text: string; tone: 'info' | 'warning' } | null {
  const change = job.recent_change;
  if (change && isRecentDate(change.date, now)) {
    const kind = deadlineChangeKind(change);
    const first = (change.detail || '').split('；')[0].trim();
    if (kind === 'extended' && first) return { text: first, tone: 'info' };
    if (kind === 'adjusted') return { text: first || '报名截止时间有调整，请以原公告为准', tone: 'warning' };
    if ((change.type === 'supplemental' || change.type === 'selection_stage') && first) return { text: first, tone: 'info' };
    if (change.type === 'positions_updated' && first && !/为 0 个职位/.test(first) && !/就绪|首次提取/.test(change.label + first))
      return { text: first, tone: 'info' };
  }
  const stage = getLifecycleStage(job, now).stage;
  if (stage === 'extended') return { text: '报名截止时间已延期（详见原公告）', tone: 'info' };
  if (stage === 'supplemental') return { text: '补录 / 追加招聘批次进行中', tone: 'info' };
  if (stage === 'selection') return { text: '发布考核选拔或录用进展通知', tone: 'info' };
  return null;
}

export function getLifecycleStage(
  job: Job,
  now = Date.now(),
): {
  stage: LifecycleStage;
  label: string;
  badge: string;
  badgeClass: string;
} {
  if (job.listing_status === 'withdrawn') {
    return { stage: 'expired', label: '官网已下架', badge: '官网已下架', badgeClass: 'badge-stage-expired' };
  }
  if (job.listing_status === 'unconfirmed') {
    return { stage: 'unconfirmed', label: '官网在架状态待核验', badge: '在架待核验', badgeClass: 'badge-stage-selection' };
  }
  if (isExpired(job, now)) {
    return {
      stage: 'expired',
      label: '网申已截止',
      badge: '已截止',
      badgeClass: 'badge-stage-expired',
    };
  }

  const title = job.title || '';
  const isSelectionNotice = hasSelectionNotice(job);

  if (isSelectionNotice) {
    return {
      stage: 'selection',
      label: '考核选拔中',
      badge: '📢 考核阶段',
      badgeClass: 'badge-stage-selection',
    };
  }

  if (deadlineChangeKind(job.recent_change) === 'extended' || /延长|延期|推迟/.test(title)) {
    return {
      stage: 'extended',
      label: '截止已延期',
      badge: '🔔 截止延期',
      badgeClass: 'badge-stage-extended',
    };
  }

  if (/补录|补招|追加|第[二两三]批|续聘/.test(title) || job.recent_change?.type === 'supplemental') {
    return {
      stage: 'supplemental',
      label: '补录进行中',
      badge: '🔥 补录招募',
      badgeClass: 'badge-stage-supplemental',
    };
  }

  if (job.deadline) {
    const dTime = Date.parse(job.deadline);
    if (!Number.isNaN(dTime)) {
      const daysLeft = Math.ceil((dTime - now) / (1000 * 60 * 60 * 24));
      if (daysLeft >= 0 && daysLeft <= 3) {
        return {
          stage: 'expiring_soon',
          label: '网申即将截止',
          badge: daysLeft === 0 ? '⏳ 今日截止' : `⏳ 剩 ${daysLeft} 天截止`,
          badgeClass: 'badge-stage-expiring',
        };
      }
    }
    return {
      stage: 'accepting',
      label: '网申进行中',
      badge: '✨ 网申中',
      badgeClass: 'badge-stage-accepting',
    };
  }

  // When job.deadline is null:
  if (hasLongTermText(job)) {
    return {
      stage: 'accepting',
      label: '长期招募中',
      badge: '长期招聘',
      badgeClass: 'badge-stage-accepting',
    };
  }

  return {
    stage: 'accepting',
    label: '状态待核实',
    badge: '截止未明',
    badgeClass: 'badge-stage-accepting',
  };
}

export function generateJobTimeline(job: Job, now = Date.now()): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const seenKeys = new Set<string>();

  const addEvt = (evt: TimelineEvent) => {
    const key = `${evt.date}-${evt.type}-${evt.title}-${evt.source || ''}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      events.push(evt);
    }
  };

  // 1. Any backend recorded timeline events first
  if (job.timeline?.length) {
    for (const e of job.timeline) {
      if (e.detail !== '招聘公告正文或附件内容已同步最新变动') {
        addEvt({ ...e });
      }
    }
  }

  // 2. Cross-channel publications from duplicate_sources
  if (job.duplicate_sources?.length) {
    for (const ds of job.duplicate_sources) {
      if (ds.published_at && ds.source_name && ds.source_name !== job.source_name) {
        const dsDate = ds.published_at.slice(0, 10);
        const alreadyPresent = events.some(
          (e) => (e.source === ds.source_name || e.detail.includes(ds.source_name!)) && e.date === dsDate,
        );
        if (!alreadyPresent) {
          addEvt({
            date: dsDate,
            type: 'source_repost',
            title: '跨渠道发布',
            detail: `在「${ds.source_name}」同步发布`,
            source: ds.source_name,
          });
        }
      }
    }
  }

  // 3. Fallback initial publication only if no 'published' event exists yet
  const hasPublished = events.some((e) => e.type === 'published');
  if (!hasPublished) {
    const pubDate = (job.published_at || job.first_seen_at || '').slice(0, 10) || '近期';
    addEvt({
      date: pubDate,
      type: 'published',
      title: '首次发布',
      detail: `由 ${job.source_name || '招聘渠道'} 发布公告`,
      source: job.source_name,
    });
  }

  // 4. Any inferred changes from recent_change
  if (
    job.recent_change &&
    job.recent_change.detail !== '招聘公告正文或附件内容已同步最新变动' &&
    !events.some((e) => e.type === job.recent_change!.type)
  ) {
    const pubDate = (job.published_at || job.first_seen_at || '').slice(0, 10) || '近期';
    addEvt({
      date: job.recent_change.date || pubDate,
      type: job.recent_change.type,
      title: job.recent_change.label,
      detail: job.recent_change.detail,
    });
  }

  // 5. If position count exists and no positions_updated event
  if (job.position_count && !events.some((e) => e.type === 'positions_updated')) {
    const pubDate = (job.published_at || job.first_seen_at || '').slice(0, 10) || '近期';
    addEvt({
      date: pubDate,
      type: 'positions_updated',
      title: '岗位表就绪',
      detail: `解析提取出 ${job.position_count} 个具体岗位与专业要求`,
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date));

  // Enforce invariant: strictly ONE "首次发布"
  // The earliest publication event remains "首次发布"; any subsequent publication events are converted to "跨渠道发布"
  let foundFirstPublish = false;
  for (const evt of events) {
    if (evt.type === 'published' || evt.title === '首次发布') {
      if (!foundFirstPublish) {
        foundFirstPublish = true;
        evt.type = 'published';
        evt.title = '首次发布';
      } else {
        evt.type = 'source_repost';
        evt.title = '跨渠道发布';
        if (evt.source && !evt.detail.includes('同步发布')) {
          evt.detail = `在「${evt.source}」同步发布`;
        }
      }
    }
  }

  // 6. Current stage status node
  const currentStage = getLifecycleStage(job, now);
  let statusDetail = currentStage.label;
  if (job.listing_status === 'withdrawn') {
    statusDetail = '连续完整核验中未再发现此岗位；保留原公告及个人记录，请以企业官网为准';
  } else if (job.listing_status === 'unconfirmed') {
    statusDetail = '最近一次完整岗位列表中未发现此岗位，等待再次核验';
  } else if (job.deadline) {
    if (isExpired(job, now)) {
      statusDetail = `报名已于 ${job.deadline.slice(0, 10)} 截止`;
    } else {
      const days = Math.ceil((Date.parse(job.deadline) - now) / (1000 * 60 * 60 * 24));
      statusDetail = `报名中，预计 ${job.deadline.slice(0, 10)} 截止（还剩 ${Math.max(0, days)} 天）`;
    }
  } else if (currentStage.stage === 'selection') {
    statusDetail = '当前处于考核选拔阶段，原公告未明确报名截止时间';
  } else if (currentStage.stage === 'extended') {
    statusDetail = '公告标注为截止延期，具体截止时间待核实';
  } else if (currentStage.stage === 'supplemental') {
    statusDetail = '当前为补录/追加招聘阶段，原公告未明确报名截止时间';
  } else {
    statusDetail = /长期|常态|常年|招满为止/.test((job.title || '') + (job.body || job.excerpt || ''))
      ? '长期招聘，招满为止，持续接收简历'
      : '原公告未明确具体截止时间，开放状态待核实';
  }
  events.push({
    date: '当前状态',
    type: currentStage.stage === 'expired' ? 'content_updated' : 'published',
    title: currentStage.label,
    detail: statusDetail,
  });

  return events;
}

export function isRecentDate(d?: string | null, now = Date.now()): boolean {
  if (!d) return false;
  const t = Date.parse(d);
  if (Number.isNaN(t)) return false;
  const diffDays = (now - t) / 86400000;
  return diffDays >= -1 && diffDays <= 30;
}

export function hasRecentJobChange(j: Job, now = Date.now()): boolean {
  const isInitialTableReadiness = Boolean(
    j.recent_change &&
      (j.recent_change.label === '岗位表就绪' ||
        (j.recent_change.type === 'positions_updated' &&
          /就绪|首次提取/.test((j.recent_change.label || '') + (j.recent_change.detail || '')))),
  );
  const isGenericBoilerplate = Boolean(
    j.recent_change &&
      j.recent_change.detail === '招聘公告正文或附件内容已同步最新变动',
  );
  const hasRecentChangeObj = Boolean(
    j.recent_change &&
      !isInitialTableReadiness &&
      !isGenericBoilerplate &&
      isRecentDate(j.recent_change.date, now),
  );
  const hasRecentTimeline = meaningfulChangeDates(j).some((date) => isRecentDate(date, now));
  const stage = getLifecycleStage(j, now).stage;
  const isRecentJob = isRecentDate(j.updated_at || j.published_at || j.first_seen_at, now);
  return (
    hasRecentChangeObj ||
    hasRecentTimeline ||
    ((stage === 'extended' ||
      stage === 'supplemental' ||
      stage === 'selection' ||
      /延长|延期|补录|追加|笔试|面试/.test(j.title)) &&
      isRecentJob)
  );
}

function jobLocation(j: Job, workCities: string[]): 'exact' | 'possible' | 'unknown' | 'none' {
  const matches = workCities.map((city) => locationMatch(j, city));
  return matches.includes('exact') ? 'exact' : matches.includes('possible') ? 'possible' : matches.includes('unknown') ? 'unknown' : 'none';
}

function hasUpcomingTalkIn(j: Job, workCities: string[], now: number): boolean {
  return Boolean(
    j.talk_events?.some(
      (event) =>
        workCities.includes(effectiveEventCity(event) || '') &&
        event.status !== 'cancelled' &&
        Date.parse(`${event.date}T${event.end_time || '23:59'}:00+08:00`) >= now,
    ),
  );
}

export function buildJobSearchText(j: Job, extraSearchText?: string): string {
  return [
    j.title,
    j.company,
    employerBrand(j.source_id),
    ...(j.talk_events?.map((event) => `${effectiveEventCity(event) ?? ''} ${event.school} ${event.venue} ${event.date}`) ?? []),
    // Version-2 browsing excerpts are display summaries (which may be
    // attributed to another exact-name company announcement). Search
    // continues to use this job's complete canonical text, not that bio.
    j.card_summary ? '' : j.excerpt,
    j.education,
    ...(j.directions ?? []),
    ...effectiveJobSectors(j),
    ...(j.location_evidence ?? []),
    ...(j.sample_positions ?? []),
    ...(j.majors ?? []),
    ...(j.positions?.map((p) => `${p.name} ${(p.majors ?? []).join(' ')} ${p.city ?? ''}`) ?? []),
    extraSearchText ?? j.search_text ?? '',
    j.body ?? '',
  ]
    .join(' ')
    .toLowerCase();
}

export function buildJobSearchMap(
  jobs: Job[],
  searchIndex: Record<string, string>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const job of jobs) {
    map.set(job.id, buildJobSearchText(job, searchIndex[job.id] ?? ''));
  }
  return map;
}

function matchesPersonalConditions(
  j: Job,
  f: Filters,
  personal: Personal,
  now: number,
): boolean {
  const p = personalFor(j, personal);
  if (f.view === 'planned' && !isPendingApplication(j, p, now)) return false;
  if (f.view === 'pipeline' && (p.hidden || !(p.saved || p.applied || p.application_stage))) return false;
  if (
    f.view === 'pipeline' &&
    f.applicationStage &&
    f.applicationStage !== 'all' &&
    (p.application_stage || (p.applied ? 'applied' : 'planned')) !== f.applicationStage
  ) {
    return false;
  }
  if (f.onlyUnread && !isUnread(j, personal)) return false;
  if (
    (f.view === 'saved' && !p.saved) ||
    (f.view === 'applied' && !p.applied) ||
    (f.view === 'hidden' && !p.hidden)
  ) {
    return false;
  }
  if (f.view === 'all' && p.hidden) return false;
  return true;
}

function matchesContentConditions(
  j: Job,
  f: Filters,
  workCities: string[],
  keywords: string[],
  since: string | null,
  now: number,
  ignoreLocationScope = false,
  searchText?: (job: Job) => string,
): boolean {
  if (f.view === 'all' && j.talk_attached_to) return false;
  if (!f.showExpired && isExpired(j, now)) return false;
  if (f.kind !== '全部' && j.kind !== f.kind) return false;
  if (f.view === 'all' && !isDomestic(j)) return false;
  if (f.provenance === '高校 / 政府' && j.provenance === '第三方线索') return false;
  if (f.provenance === '第三方线索' && j.provenance !== '第三方线索') return false;
  if (workCities.length && !ignoreLocationScope) {
    const location = jobLocation(j, workCities);
    const talkInCity = Boolean(
      f.includeRelatedTalks && f.locationScope === 'exact' && hasUpcomingTalkIn(j, workCities, now),
    );
    if (location !== f.locationScope && !talkInCity) return false;
  }
  if (f.validity && f.validity !== 'all' && assessOpportunityValidity(j, now).status !== f.validity) return false;
  if (
    f.employmentType &&
    f.employmentType !== 'all' &&
    j.employment_type !== f.employmentType &&
    !(f.includeUncertain && (!j.employment_type || j.employment_type === 'unknown'))
  ) {
    return false;
  }
  const positions = j.position_matches || j.positions;
  if (positions?.length && (f.education || f.major || workCities.length || f.year !== '全部')) {
    if (
      !positions.some((position) =>
        positionMatches(position, {
          cities: workCities,
          education: f.education,
          major: f.major || '',
          year: f.type === '校招' ? f.year : '全部',
          includeUnknown: f.includeUncertain,
          includeUnlimitedMajor: Boolean(f.includeUnlimitedMajor),
          includeUnstatedNotices: j.kind === '招聘公告' && Boolean(f.includeUnstatedMajor),
        }),
      )
    ) {
      return false;
    }
  } else if (
    f.major &&
    !jobMatchesMajor(j, f.major, {
      includeUnlimited: Boolean(f.includeUnlimitedMajor),
      includeUnstatedNotices: Boolean(f.includeUnstatedMajor),
    })
  ) {
    return false;
  }
  const effectiveTypes = effectiveJobTypes(j);
  if (
    f.type !== '全部' &&
    !effectiveTypes.includes(f.type) &&
    !(f.includeUncertain && effectiveTypes.length === 0)
  ) {
    return false;
  }
  if (
    f.type === '校招' &&
    f.year !== '全部' &&
    !positions?.length &&
    !j.graduation_years.includes(f.year) &&
    !(f.includeUncertain && j.graduation_years.length === 0)
  ) {
    return false;
  }
  if (f.sector !== '全部') {
    const sectors = effectiveJobSectors(j);
    if ([UNKNOWN_SECTOR, '综合（高校 / 平台公告）', '综合'].includes(f.sector)) {
      if (sectors.some((sector) => !['综合', '综合（高校 / 平台公告）', UNKNOWN_SECTOR].includes(sector))) {
        return false;
      }
    } else if (!sectors.includes(f.sector)) {
      return false;
    }
  }
  if (f.direction !== '全部' && !j.directions.includes(f.direction)) return false;
  if (
    f.education &&
    !positions?.length &&
    !matchesEducationRequirement(j.education, f.education, f.includeUncertain)
  ) {
    return false;
  }
  if (f.salary && f.salary !== '全部') {
    const threshold = salaryThreshold(f.salary);
    const sal = parseSalaryRange(j);
    if (!sal || sal.max < threshold) return false;
  }
  if (f.changeType && f.changeType !== '全部') {
    const hasChange = hasRecentJobChange(j, now);
    const stage = getLifecycleStage(j, now).stage;
    const isRecentJob = isRecentDate(j.updated_at || j.published_at || j.first_seen_at, now);
    const hasRecentChangeObj = Boolean(j.recent_change && isRecentDate(j.recent_change.date, now));

    if (f.changeType === '有变更' && !hasChange) return false;
    if (
      f.changeType === '截止延期' &&
      (stage !== 'extended' || !isRecentJob) &&
      !(deadlineChangeKind(j.recent_change) === 'extended' && hasRecentChangeObj)
    ) {
      return false;
    }
    if (
      f.changeType === '补录招募' &&
      (stage !== 'supplemental' || !isRecentJob) &&
      !(j.recent_change?.type === 'supplemental' && hasRecentChangeObj)
    ) {
      return false;
    }
    if (
      f.changeType === '岗位调整' &&
      !(j.recent_change?.type === 'positions_updated' && hasRecentChangeObj) &&
      !positionChangeDates(j).some((date) => isRecentDate(date, now))
    ) {
      return false;
    }
    if (
      f.changeType === '考核阶段' &&
      (stage !== 'selection' || !isRecentJob) &&
      !(j.recent_change?.type === 'selection_stage' && hasRecentChangeObj)
    ) {
      return false;
    }
  }
  if (f.radarFocus && f.radarFocus !== 'none') {
    if (f.radarFocus === 'today') {
      if (!isTodayOpportunity(j, now)) return false;
    } else if (f.radarFocus === 'supplement') {
      if (!isSupplementOpportunity(j)) return false;
    } else if (f.radarFocus === 'urgent') {
      const countdown = getDeadlineCountdown(j.deadline, now);
      if (!countdown || countdown.urgency !== 'urgent') return false;
    } else if (f.radarFocus === 'change') {
      if (!hasRecentJobChange(j, now)) return false;
    }
  }
  if (keywords.length) {
    const searchable = searchText ? searchText(j) : buildJobSearchText(j);
    if (!keywords.every((kw) => searchable.includes(kw))) return false;
  }
  if (
    f.onlyNew &&
    (!since ||
      (Date.parse(j.first_seen_at) <= Date.parse(since) &&
        Date.parse(j.updated_at) <= Date.parse(since)))
  ) {
    return false;
  }
  return true;
}

export function filterJobsByContent(
  jobs: Job[],
  f: Filters,
  now = Date.now(),
  since: string | null = null,
  searchText?: (job: Job) => string,
): Job[] {
  const workCities = selectedWorkCities(f);
  const keywords = f.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return jobs.filter((j) =>
    matchesContentConditions(j, f, workCities, keywords, since, now, false, searchText),
  );
}

export function applyPersonalView(
  jobs: Job[],
  f: Filters,
  personal: Personal,
  now = Date.now(),
): Job[] {
  const matches = jobs.filter((j) => matchesPersonalConditions(j, f, personal, now));
  // Parse dates and salaries once per matching row instead of once per comparison.
  // This cache belongs to this call: edits, clock changes and new snapshots cannot
  // leave stale sort keys behind.
  const keys = new Map(
    matches.map((job) => {
      const range = f.sort === 'salary_desc' ? parseSalaryRange(job) : null;
      const plannedTime = f.view === 'planned' ? deadlineTime(job.deadline) : NaN;
      const pubRaw = f.view === 'planned' ? '' : publicationDate(job, now);
      const pubDay = pubRaw ? shanghaiDay(pubRaw) : '';
      const boostDay = f.view === 'planned' ? '' : substantiveBoostDate(job, now);
      const newestDay = boostDay > pubDay ? boostDay : pubDay;
      const newestTie = f.view === 'planned' ? 0 : newestTieBreakerMs(job, newestDay, pubDay);
      return [
        job,
        {
          newestDay,
          newestTie,
          expired: f.sort === 'deadline_asc' && isExpired(job, now),
          deadline:
            f.view === 'planned'
              ? Number.isFinite(plannedTime)
                ? plannedTime
                : Number.MAX_SAFE_INTEGER
              : job.deadline
                ? Date.parse(job.deadline)
                : Number.POSITIVE_INFINITY,
          salary: range ? (Number.isFinite(range.max) ? range.max : range.min) : -1,
        },
      ] as const;
    }),
  );
  return matches.sort((a, b) => {
    const ak = keys.get(a)!,
      bk = keys.get(b)!;
    if (f.view === 'planned') return ak.deadline - bk.deadline || a.id.localeCompare(b.id);
    if (f.sort === 'deadline_asc') {
      if (ak.expired !== bk.expired) return ak.expired ? 1 : -1;
      if (Number.isFinite(ak.deadline) && Number.isFinite(bk.deadline)) {
        return (
          ak.deadline - bk.deadline ||
          bk.newestDay.localeCompare(ak.newestDay) ||
          bk.newestTie - ak.newestTie ||
          a.id.localeCompare(b.id)
        );
      }
      if (Number.isFinite(ak.deadline) !== Number.isFinite(bk.deadline)) {
        return Number.isFinite(ak.deadline) ? -1 : 1;
      }
    }
    if (f.sort === 'salary_desc' && ak.salary !== bk.salary) return bk.salary - ak.salary;
    return (
      bk.newestDay.localeCompare(ak.newestDay) ||
      bk.newestTie - ak.newestTie ||
      a.id.localeCompare(b.id)
    );
  });
}

function matchingJobs(
  jobs: Job[],
  f: Filters,
  personal: Personal,
  since: string | null,
  now = Date.now(),
  ignoreLocationScope = false,
  searchText?: (job: Job) => string,
) {
  const workCities = selectedWorkCities(f);
  const keywords = f.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return jobs.filter(
    (j) =>
      matchesPersonalConditions(j, f, personal, now) &&
      matchesContentConditions(j, f, workCities, keywords, since, now, ignoreLocationScope, searchText),
  );
}

/** Same eligibility rules as the visible list, without sorting discarded rows. */
export function countMatchingJobs(
  jobs: Job[],
  f: Filters,
  personal: Personal,
  since: string | null,
  now = Date.now(),
  searchText?: (job: Job) => string,
): number {
  return matchingJobs(jobs, f, personal, since, now, false, searchText).length;
}

/** Counts for the three work-location scopes in one pass; each count equals
 * countMatchingJobs with that locationScope. */
export function countByLocationScope(
  jobs: Job[],
  f: Filters,
  personal: Personal,
  since: string | null,
  now = Date.now(),
  searchText?: (job: Job) => string,
) {
  const counts = { exact: 0, possible: 0, unknown: 0 };
  const workCities = selectedWorkCities(f);
  if (!workCities.length) return counts;
  for (const j of matchingJobs(jobs, f, personal, since, now, true, searchText)) {
    const location = jobLocation(j, workCities);
    if (location === 'exact' || (f.includeRelatedTalks && hasUpcomingTalkIn(j, workCities, now))) counts.exact++;
    if (location === 'possible') counts.possible++;
    if (location === 'unknown') counts.unknown++;
  }
  return counts;
}

export function filterJobs(
  jobs: Job[],
  f: Filters,
  personal: Personal,
  since: string | null,
  now = Date.now(),
  searchText?: (job: Job) => string,
): Job[] {
  return applyPersonalView(filterJobsByContent(jobs, f, now, since, searchText), f, personal, now);
}
export function validatePersonal(input: unknown): Personal {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw Error('备份格式不正确');
  const entries = Object.entries(input);
  if (entries.length > 20000) throw Error('备份条目过多');
  const result: Personal = {};
  for (const [id, value] of entries) {
    if (
      !/^[a-f0-9]{20}$/.test(id) ||
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value)
    )
      throw Error('备份条目不正确');
    const row = value as Record<string, unknown>;
    const details = validatePersonalDetails(row);
    for (const key of Object.keys(row)) {
      if ((PERSONAL_DETAIL_FIELDS as readonly string[]).includes(key)) continue;
      if (key === 'readAt') {
        if (row[key] !== null && (typeof row[key] !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row[key]) ||
            !Number.isFinite(Date.parse(row[key])))) throw Error('备份已读时间不正确');
        continue;
      }
      if (
        !['saved', 'applied', 'hidden'].includes(key) ||
        typeof row[key] !== 'boolean'
      )
        throw Error('备份状态不正确');
    }
    const item: PersonalRecord = { ...details };
    if (typeof row.saved === 'boolean') item.saved = row.saved;
    if (typeof row.applied === 'boolean') item.applied = row.applied;
    if (item.application_stage) item.applied = item.application_stage !== 'planned';
    if (typeof row.hidden === 'boolean') item.hidden = row.hidden;
    if (Object.hasOwn(row, 'readAt')) item.readAt = row.readAt as string | null;
    result[id] = item;
  }
  return result;
}
export function displayJobTitle(job: Pick<Job, 'title' | 'company'>): string {
  return job.title.replace(/^招聘单位见原页面(?=\s*·)/, job.company?.trim() || '单位名称待核实');
}

// Preserve the exact record URL and offer the platform's public list separately.
export function sdeiPositionListUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'school.gxjy.sdei.edu.cn' || parsed.username || parsed.password || parsed.port) return null;
    const match = parsed.pathname.match(/^\/([a-z0-9_-]+)\/school\/companyissueinfo\/edit1\/\d+\/?$/i);
    return match ? `https://school.gxjy.sdei.edu.cn/${match[1]}/front/JiuYeInfo?type=zwxx` : null;
  } catch {
    return null;
  }
}

export function externalUrl(url: string | null | undefined) {
  try {
    const u = new URL(url ?? '');
    return ['https:', 'http:'].includes(u.protocol) ? u.href : undefined;
  } catch {
    return undefined;
  }
}


export function countActiveFilters(f: Filters): number {
  const selectedCities = selectedWorkCities(f);
  return [
    selectedCities.length > 0,
    f.type !== '全部',
    f.type === '校招' && f.year !== '全部',
    f.sector !== '全部',
    (f.employmentType || 'all') !== 'all',
    f.direction !== '全部',
    f.salary !== '全部',
    Boolean(f.education && f.education !== '不限'),
    Boolean(f.major),
    f.provenance !== '全部',
    f.kind !== '全部',
    f.changeType !== '全部',
    (f.validity || 'all') !== 'all',
    (f.reputationMin || 'all') !== 'all',
    f.showExpired,
    !f.includeUncertain,
    Boolean(f.includeRelatedTalks),
  ].filter(Boolean).length;
}

export function resetFilters(
  current: Filters,
  keep: (keyof Filters)[] = ['city', 'workCities', 'view'],
): Filters {
  const next: Filters = { ...defaultFilters };
  for (const key of keep) {
    if (Object.hasOwn(current, key)) {
      Object.assign(next, { [key]: current[key] });
    }
  }
  return next;
}
