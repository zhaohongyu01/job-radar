import { PROVINCE_CITIES, citiesInText, workplaceEvidence } from './cities.ts';
import { assessOpportunityValidity, deadlineTime } from './opportunity-validity.ts';
import { positionMatches } from './eligibility.ts';
import { PERSONAL_DETAIL_FIELDS, validatePersonalDetails, mergePersonalRecords } from './personal-records.ts';
import employerBrands from '../config/employer-brands.json' with { type: 'json' };

export function shanghaiDay(value: string | number): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp + 8 * 3600000).toISOString().slice(0, 10) : '';
}

export function isTodayOpportunity(job: Job, now: number): boolean {
  const today = shanghaiDay(now);
  return shanghaiDay(job.published_at || '') === today || shanghaiDay(job.first_seen_at) === today;
}

export function isSupplementOpportunity(job: Job): boolean {
  return /补录|补招|追加|第[二两三]批|春招补录|秋招补录|续聘/.test(job.title) ||
    job.recent_change?.type === 'supplemental' || job.lifecycle_stage === 'supplemental';
}

export type PositionRequirement = {
  name: string;
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
  reputationMin?: 'all' | '3' | '4';
  includeUnrated?: boolean;
  applicationStage?: 'all' | NonNullable<PersonalRecord['application_stage']>;
};
export const defaultFilters: Filters = {
  city: '济南',
  type: '全部',
  year: '2027',
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
  const today = new Date(now + 8 * 3600000).toISOString().slice(0, 10);
  return value && Number.isFinite(Date.parse(value)) && value.slice(0, 10) <= today ? value : '';
}

export function publicationText(job: Job, now = Date.now()): string {
  return publicationDate(job, now) || (job.published_at ? '日期异常待核实' : '日期未明确');
}

export function isExpired(job: Job, now = Date.now()) {
  if ((job.kind === '宣讲会' || (job.source_id || '').endsWith('-talks')) && job.talk_event?.status === 'cancelled') return true;
  if (job.listing_status === 'withdrawn') return true;
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
  return departmentPattern.test(job.company || '') ? employerBrand(job.source_id) || job.company : job.company;
}
export function formatCompanyDisplay(company?: string | null, title?: string | null, sourceId?: string): { displayCompany: string; monogram: string } {
  const rawComp = (company ?? '').trim();
  const rawTitle = (title ?? '').trim();
  const brand = employerBrand(sourceId);
  const displayCompany = brand && rawComp && departmentPattern.test(rawComp) && !rawComp.includes(brand)
    ? `${brand} · ${rawComp}` : rawComp || brand;

  const monogramBase = displayCompany || rawTitle;
  const norm = normalizeCompanyName(monogramBase);
  const monogram = (norm.length >= 2 ? norm.slice(0, 2) : monogramBase.slice(0, 2)) || '招';

  return { displayCompany: displayCompany || '企业名称待核实', monogram };
}
export function eventDisplayTitle(job: Job): string {
  return job.company ? formatCompanyDisplay(job.company, job.title, job.source_id).displayCompany : job.title || '校园活动';
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
      // Keep campaign years separate from graduation cohorts.  A title such
      // as "2026年校园招聘" may recruit the 2027届 cohort; prefer explicit
      // cohort evidence and use a campaign year only when no cohort is known.
      const titleCohorts = [...new Set([...(job.title ?? '').matchAll(/(20\d{2})\s*(?:届|应届|年应届|年(?:高校)?毕业|(?=校园招聘|校招))/g)].map((m) => m[1]))];
      const campaignYears = [...new Set([...(job.title ?? '').matchAll(/(20\d{2})\s*(?:年(?:度)?\s*)?(?=校园招聘|校招)/g)].map((m) => m[1]))];
      const cohorts = (titleCohorts.length ? titleCohorts : (job.graduation_years?.length ? job.graduation_years : campaignYears)).slice().sort().join(',');
      let phase = '校招';
      if (/春(?:季校园招聘|季招聘|招).*?补[录招]|补[录招].*?春[季招]/.test(job.title)) phase = '春招补录';
      else if (/秋(?:季校园招聘|季招聘|招).*?补[录招]|补[录招].*?秋[季招]/.test(job.title)) phase = '秋招补录';
      else if (/补录|补招|追加|第[二两三]批|续聘/.test(job.title)) phase = '补录';
      else if (/提前批/.test(job.title)) phase = '提前批';
      else if (/春(?:季校园招聘|季招聘|招)/.test(job.title)) phase = '春招';
      else if (/秋(?:季校园招聘|季招聘|招)/.test(job.title)) phase = '秋招';
      else if (/社招|社会/.test(job.title)) phase = '社招';
      else if (/实习/.test(job.title)) phase = '实习';

      const batchMatch = (job.title ?? '').match(/(第[一二两三四五1-5]批|第[一二两三四五1-5]期)/);
      const batchTag = batchMatch ? batchMatch[1] : '';

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
      existing.duplicate_ids.push(job.id);
      if (job.talk_events?.length) {
        const events = new Map((existing.talk_events ?? []).map((event) => [event.id, event]));
        for (const event of job.talk_events) events.set(event.id, event);
        existing.talk_events = [...events.values()].sort((a, b) =>
          `${a.date} ${a.start_time ?? ''}`.localeCompare(`${b.date} ${b.start_time ?? ''}`),
        );
      }
      if (job.duplicate_ids?.length) {
        existing.duplicate_ids = [...new Set([...existing.duplicate_ids, ...job.duplicate_ids])];
      }

      if (job.published_at) {
        if (!existing.published_at || job.published_at < existing.published_at) {
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
        existing.majors = [...new Set([...(existing.majors ?? []), ...job.majors])].slice(0, 15);
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
      } else if ((job.body?.length ?? 0) > (existing.body?.length ?? 0) + 200) {
        existing.body = job.body;
        existing.excerpt = job.excerpt || existing.excerpt;
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
        } else {
          const currP = changePrio[existing.recent_change.type] ?? 0;
          const newP = changePrio[job.recent_change.type] ?? 0;
          if (newP > currP) {
            existing.recent_change = job.recent_change;
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
  }
  return [...groups.values()];
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
  if (job.domestic_status) return true;
  const locationLines = workplaceEvidence(job.location_evidence ?? []);
  const evidence = locationLines.join('\n');
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
  const targetMidnight = new Date(
    new Date(target).toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }),
  ).setHours(0, 0, 0, 0);
  const nowMidnight = new Date(
    new Date(now).toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }),
  ).setHours(0, 0, 0, 0);
  const daysLeft = Math.max(0, Math.round((targetMidnight - nowMidnight) / 86400000));

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

export function parseSalaryRange(job: Job): SalaryRange | null {
  if (job.listing_facts?.version === 1) {
    const salary = job.listing_facts.salary;
    return salary ? { ...salary, max: salary.max ?? Number.POSITIVE_INFINITY } : null;
  }
  const title = job.title;
  const excerpt = job.excerpt || '';
  let salaryContext = title;

  // 1. Check title end: (\n6000-8000元, (8k-15k), 20000元以上, 15~18W/年)
  let m = title.match(
    /(?:[（(\n\s])(\d+(?:\.\d+)?)\s*(k|K|万|w|W|元)?\s*[-~至–]\s*(\d+(?:\.\d+)?)\s*(k|K|万|w|W|元)?(?:·\d+薪)?(?:元|\/月|\/年|\/天|人民币)?(?:[)）\s]*)$/,
  );
  let isAbove = false;
  if (!m) {
    m = title.match(
      /(?:[（(\n\s])(\d+(?:\.\d+)?)\s*(k|K|万|w|W|元)?\s*(?:以上|及以上)(?:[)）\s]*)$/,
    );
    if (m) isAbove = true;
  }
  if (!m) {
    const exMatch = excerpt.match(/薪资(?:待遇)?[:：]\s*([^\s,，;；\n*]+)/);
    if (exMatch) {
      const rawText = exMatch[1].trim();
      salaryContext = rawText;
      m = rawText.match(
        /(\d+(?:\.\d+)?)\s*(k|K|万|w|W|元)?\s*[-~至–]\s*(\d+(?:\.\d+)?)\s*(k|K|万|w|W|元)?/,
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
  const unit1 = m[2] || '';

  const matchedStr = m[0];
  const isAnnual =
    salaryContext.includes('/年') ||
    salaryContext.includes('年薪') ||
    matchedStr.includes('/年') ||
    matchedStr.includes('年');

  if (isAbove) {
    if (['万', 'w', 'W'].includes(unit1)) val1 *= 10000;
    else if (['k', 'K'].includes(unit1)) val1 *= 1000;
    if (isAnnual) {
      val1 /= 12;
    }
    if (val1 < 1000) return null;
    return { min: Math.round(val1), max: Number.POSITIVE_INFINITY, raw: m[0].trim() };
  }

  let val2 = Number.parseFloat(m[3]);
  const unit2 = m[4] || '';
  const unit = unit2 || unit1 || '';

  if (['万', 'w', 'W'].includes(unit)) {
    val1 *= 10000;
    val2 *= 10000;
  } else if (['k', 'K'].includes(unit)) {
    val1 *= 1000;
    val2 *= 1000;
  }

  if (isAnnual) {
    val1 /= 12;
    val2 /= 12;
  }

  if (val2 < 1000) return null;
  // Guard against calendar years e.g. 2024-2025 or 2026-0
  if (val1 >= 2010 && val1 <= 2030 && val2 < 100) return null;

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

  if (job.recent_change?.type === 'deadline_extended' || /延长|延期|推迟/.test(title)) {
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

function matchingJobs(
  jobs: Job[],
  f: Filters,
  personal: Personal,
  since: string | null,
  now = Date.now(),
) {
  const workCities = selectedWorkCities(f);
  const keywords = f.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return jobs
    .filter((j) => {
      const p = personalFor(j, personal);
      if (f.view === 'planned' && !isPendingApplication(j, p, now)) return false;
      if (f.view === 'pipeline' && (p.hidden || !(p.saved || p.applied || p.application_stage))) return false;
      if (f.view === 'pipeline' && f.applicationStage && f.applicationStage !== 'all' &&
          (p.application_stage || (p.applied ? 'applied' : 'planned')) !== f.applicationStage) return false;
      if (f.view === 'all' && j.talk_attached_to) return false;
      if (f.onlyUnread && !isUnread(j, personal)) return false;
      if (
        (f.view === 'saved' && !p.saved) ||
        (f.view === 'applied' && !p.applied) ||
        (f.view === 'hidden' && !p.hidden)
      )
        return false;
      if (f.view === 'all' && p.hidden) return false;
      if (!f.showExpired && isExpired(j, now)) return false;
      if (f.kind !== '全部' && j.kind !== f.kind) return false;
      if (f.view === 'all' && !isDomestic(j)) return false;
      if (f.provenance === '高校 / 政府' && j.provenance === '第三方线索') return false;
      if (f.provenance === '第三方线索' && j.provenance !== '第三方线索') return false;
      const matches = workCities.map((city) => locationMatch(j, city));
      const location = matches.includes('exact') ? 'exact' : matches.includes('possible') ? 'possible' : matches.includes('unknown') ? 'unknown' : 'none';
      const talkInCity = Boolean(f.includeRelatedTalks && f.locationScope === 'exact' && j.talk_events?.some((event) =>
        workCities.includes(event.city || '') && event.status !== 'cancelled' && Date.parse(`${event.date}T${event.end_time || '23:59'}:00+08:00`) >= now,
      ));
      if (workCities.length && location !== f.locationScope && !talkInCity) return false;
      if (f.validity && f.validity !== 'all' && assessOpportunityValidity(j, now).status !== f.validity) return false;
      if (f.employmentType && f.employmentType !== 'all' && j.employment_type !== f.employmentType && !(f.includeUncertain && (!j.employment_type || j.employment_type === 'unknown'))) return false;
      const positions = j.position_matches || j.positions;
      if (positions?.length && (f.education || f.major || workCities.length || f.year !== '全部')) {
        if (!positions.some((position) => positionMatches(position, { cities: workCities, education: f.education,
          major: f.major || '', year: f.type === '校招' ? f.year : '全部', includeUnknown: f.includeUncertain }))) return false;
      } else if (f.major && !(j.majors?.some((major) => major.includes(f.major!))) && !(f.includeUncertain && !j.majors?.length)) return false;
      if (
        f.type !== '全部' &&
        !j.types.includes(f.type) &&
        !(f.includeUncertain && j.types.length === 0)
      )
        return false;
      if (
        f.type === '校招' &&
        f.year !== '全部' && !positions?.length &&
        !j.graduation_years.includes(f.year) &&
        !(f.includeUncertain && j.graduation_years.length === 0)
      )
        return false;
      if (f.sector !== '全部') {
        if ([UNKNOWN_SECTOR, '综合（高校 / 平台公告）', '综合'].includes(f.sector)) {
          if (j.sectors.some((sector) => !['综合', '综合（高校 / 平台公告）', UNKNOWN_SECTOR].includes(sector))) return false;
        } else if (!j.sectors.includes(f.sector)) {
          return false;
        }
      }
      if (f.direction !== '全部' && !j.directions.includes(f.direction))
        return false;
      if (
        f.education && !positions?.length &&
        !j.education.includes(f.education) &&
        !(f.includeUncertain && j.education.includes('未明确'))
      )
        return false;
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
        if (f.changeType === '截止延期' && (stage !== 'extended' || !isRecentJob) && !(j.recent_change?.type === 'deadline_extended' && hasRecentChangeObj)) return false;
        if (f.changeType === '补录招募' && (stage !== 'supplemental' || !isRecentJob) && !(j.recent_change?.type === 'supplemental' && hasRecentChangeObj)) return false;
        if (f.changeType === '岗位调整' && !(j.recent_change?.type === 'positions_updated' && hasRecentChangeObj) && !positionChangeDates(j).some((date) => isRecentDate(date, now))) return false;
        if (f.changeType === '考核阶段' && (stage !== 'selection' || !isRecentJob) && !(j.recent_change?.type === 'selection_stage' && hasRecentChangeObj)) return false;
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
      if (f.query.trim()) {
        if (keywords.length) {
          const searchable = [
            j.title,
            j.company,
            employerBrand(j.source_id),
            ...(j.talk_events?.map((event) => `${event.city ?? ''} ${event.school} ${event.venue} ${event.date}`) ?? []),
            j.excerpt,
            j.education,
            ...(j.directions ?? []),
            ...(j.sectors ?? []),
            ...(j.location_evidence ?? []),
            ...(j.sample_positions ?? []),
            ...(j.majors ?? []),
            ...(j.positions?.map((p) => `${p.name} ${(p.majors ?? []).join(' ')} ${p.city ?? ''}`) ?? []),
            j.search_text ?? '',
            j.body ?? '',
          ]
            .join(' ')
            .toLowerCase();
          if (!keywords.every((kw) => searchable.includes(kw))) return false;
        }
      }
      if (
        f.onlyNew &&
        (!since ||
          (Date.parse(j.first_seen_at) <= Date.parse(since) &&
            Date.parse(j.updated_at) <= Date.parse(since)))
      )
        return false;
      return true;
    });
}

/** Same eligibility rules as the visible list, without sorting discarded rows. */
export function countMatchingJobs(jobs: Job[], f: Filters, personal: Personal, since: string | null, now = Date.now()): number {
  return matchingJobs(jobs, f, personal, since, now).length;
}

export function filterJobs(jobs: Job[], f: Filters, personal: Personal, since: string | null, now = Date.now()): Job[] {
  const matches = matchingJobs(jobs, f, personal, since, now);
  // Parse dates and salaries once per matching row instead of once per comparison.
  // This cache belongs to this call: edits, clock changes and new snapshots cannot
  // leave stale sort keys behind.
  const keys = new Map(matches.map(job => {
    const range = f.sort === 'salary_desc' ? parseSalaryRange(job) : null;
    const plannedTime = f.view === 'planned' ? deadlineTime(job.deadline) : NaN;
    return [job, {
      published: f.view === 'planned' ? '' : publicationDate(job, now),
      expired: f.sort === 'deadline_asc' && isExpired(job, now),
      deadline: f.view === 'planned'
        ? Number.isFinite(plannedTime) ? plannedTime : Number.MAX_SAFE_INTEGER
        : job.deadline ? Date.parse(job.deadline) : Number.POSITIVE_INFINITY,
      salary: range ? Number.isFinite(range.max) ? range.max : range.min : -1,
    }] as const;
  }));
  return matches.sort((a, b) => {
    const ak = keys.get(a)!, bk = keys.get(b)!;
    if (f.view === 'planned') return ak.deadline - bk.deadline || a.id.localeCompare(b.id);
    if (f.sort === 'deadline_asc') {
      if (ak.expired !== bk.expired) return ak.expired ? 1 : -1;
      if (Number.isFinite(ak.deadline) && Number.isFinite(bk.deadline)) {
        return ak.deadline - bk.deadline || bk.published.localeCompare(ak.published) || a.id.localeCompare(b.id);
      }
      if (Number.isFinite(ak.deadline) !== Number.isFinite(bk.deadline)) return Number.isFinite(ak.deadline) ? -1 : 1;
    }
    if (f.sort === 'salary_desc' && ak.salary !== bk.salary) return bk.salary - ak.salary;
    return bk.published.localeCompare(ak.published) || a.id.localeCompare(b.id);
  });
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
