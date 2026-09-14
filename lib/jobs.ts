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
};

export type Job = {
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
  published_at: string | null;
  date_label?: string;
  provenance?: string;
  duplicate_sources?: {
    source?: string;
    source_name?: string;
    title: string;
    url: string;
    published_at?: string | null;
    application_url?: string;
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
  attachments?: { title: string; url: string }[];
  links?: { title: string; url: string }[];
  qr_attachment?: boolean;
  excerpt: string;
  body?: string;
  first_seen_at: string;
  updated_at: string;
  last_verified_at: string;
  revision: number;
  positions?: PositionRequirement[];
  position_count?: number;
  sample_positions?: string[];
  majors?: string[];
};
export type Source = {
  id: string;
  name: string;
  url: string;
  status: string;
  pages: number;
  discovered: number;
  parsed: number;
  cached?: number;
  coverage: string;
  last_success_at: string | null;
  last_attempt_at: string;
  errors: { url: string; reason: string }[];
};
export type Snapshot = {
  schema_version: number;
  generated_at: string;
  last_success_at: string | null;
  schedule_enabled: boolean;
  details_url?: string;
  detail_shards?: Record<string, string>;
  search_url?: string;
  cities: string[];
  jobs: Job[];
  sources: Source[];
};
export type Personal = Record<
  string,
  { saved?: boolean; applied?: boolean; hidden?: boolean; readAt?: string | null }
>;
export type SortOrder = 'newest' | 'deadline_asc' | 'salary_desc';
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
};
export function isExpired(job: Job, now = Date.now()) {
  return !!job.deadline && Date.parse(job.deadline) < now;
}
export function normalizeCompanyName(name?: string | null): string {
  if (!name) return '';
  return name
    .trim()
    .replace(/\s+/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\((?:中国|集团|有限|股份|分公司|有限责任).*?\)/g, '')
    .replace(/(?:有限责任公司|股份有限公司|有限公司|集团有限公司|集团)$/g, '');
}
export function normalizeTitleCore(title: string): string {
  if (!title) return '';
  return title
    .trim()
    .replace(/\s+/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/^[【[(][^】\])]{1,20}[】\])]/g, '')
    .replace(/(?:校园招聘(?:简章|公告|启事)?|招聘(?:简章|公告|启事|信息)?|简章|公告|启事|专场)$/g, '');
}
export function mergeDuplicateOpportunities(jobs: Job[]): Job[] {
  const groups = new Map<string, Job>();
  for (const job of jobs) {
    const company = job.company?.trim() ?? '';
    const normComp = normalizeCompanyName(company);
    const normTitle = normalizeTitleCore(job.title ?? '');
    const kind = job.kind ?? '招聘公告';
    const cities = (job.cities ?? []).slice().sort().join(',');

    let key: string;
    if (kind === '具体岗位') {
      if (!company || !job.title) {
        key = `pos_fallback_${job.id}`;
      } else {
        key = `pos_${normComp}_${job.title.replace(/\s+/g, '')}_${cities}`;
      }
    } else {
      const titleCohorts = [...new Set([...(job.title ?? '').matchAll(/(20\d{2})\s*届/g)].map((m) => m[1]))];
      const cohorts = (titleCohorts.length ? titleCohorts : job.graduation_years ?? []).slice().sort().join(',');
      let phase = '校招';
      if (/春(?:季校园招聘|季招聘|招).*?补[录招]|补[录招].*?春[季招]/.test(job.title)) phase = '春招补录';
      else if (/秋(?:季校园招聘|季招聘|招).*?补[录招]|补[录招].*?秋[季招]/.test(job.title)) phase = '秋招补录';
      else if (/补录|补招|追加|第[二两三]批|续聘/.test(job.title)) phase = '补录';
      else if (/提前批/.test(job.title)) phase = '提前批';
      else if (/春(?:季校园招聘|季招聘|招)/.test(job.title)) phase = '春招';
      else if (/秋(?:季校园招聘|季招聘|招)/.test(job.title)) phase = '秋招';
      else if (/社招|社会/.test(job.title)) phase = '社招';
      else if (/实习/.test(job.title)) phase = '实习';

      if (!company && !normTitle) {
        key = `ann_id_${job.id}`;
      } else if (normComp && cohorts && job.types?.includes('校招')) {
        key = `campus_${normComp}_${cohorts}_${phase}`;
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
      if (job.duplicate_ids?.length) {
        existing.duplicate_ids = [...new Set([...existing.duplicate_ids, ...job.duplicate_ids])];
      }

      if (job.published_at) {
        if (!existing.published_at || job.published_at > existing.published_at) {
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
      if (job.positions?.length) {
        existing.positions = existing.positions ?? [];
        const existingKeys = new Set(
          existing.positions.map((p) => `${p.name}-${p.city ?? ''}-${p.education ?? ''}`),
        );
        for (const p of job.positions) {
          const key = `${p.name}-${p.city ?? ''}-${p.education ?? ''}`;
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

  return {
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
export function mergePersonal(current: Personal, imported: Personal): Personal {
  const result = { ...current };
  for (const [id, record] of Object.entries(imported)) result[id] = { ...current[id], ...record };
  return result;
}
export function isDomestic(job: Job) {
  if (job.domestic_status === 'overseas') return false;
  if (job.domestic_status) return true;
  const evidence = (job.location_evidence ?? []).join('\n');
  return !(
    /海外|国外|境外|境外地区|海外地区/.test(evidence) &&
    !job.cities.length &&
    !/国内|中国大陆|境内|全国|各地可选|不限城市|各地招聘|各省市/.test(evidence)
  );
}
export function locationMatch(
  job: Job,
  city: string,
): 'exact' | 'possible' | 'unknown' | 'none' {
  if (city === '全部城市' || job.cities.includes(city)) return 'exact';
  // Only recruitment location evidence counts; headquarters and body mentions do not.
  const evidence = (job.location_evidence ?? []).join('\n');
  const province = Object.entries(PROVINCE_CITIES).find(([, cities]) =>
    cities.includes(city),
  )?.[0];
  const provinces = Object.keys(PROVINCE_CITIES).filter((p) =>
    evidence.includes(p),
  );
  // A specific city in a recruitment-location line takes precedence over a
  // nearby province/national label. This prevents “上海、全国、海外” from
  // being presented as a possible Jinan opportunity.
  const broadPattern = province && new RegExp(`${province}(?:省)?[ \\t]*(?=$|[/、，,；;\\n]|各地|全省|不限|多个城市|分行辖属|各分支机构)`);
  const detailLocations = (job.location_evidence ?? []).filter((line) => /^(?:工作地点|工作城市|岗位地点|工作地域|招聘地点|招聘机构|工作区域|用人单位所在地|意向工作地|意向城市|工作地|招聘城市|所属分行|所属分公司)/.test(line));
  const specificCities = Object.values(PROVINCE_CITIES)
    .flat()
    .filter((candidate) => detailLocations.some((line) => line.includes(candidate)));
  if (specificCities.includes(city)) return 'exact';
  if (broadPattern && broadPattern.test(detailLocations.length ? detailLocations.join('\n') : evidence)) return 'possible';
  if (specificCities.length) return 'none';
  if (/全国|不限城市|各地可选|各地招聘|各省市/.test(evidence)) return 'possible';
  if (job.cities.length || provinces.length) return 'none';
  return 'unknown';
}

const PROVINCE_CITIES: Record<string, string[]> = {
  山东: '济南 青岛 淄博 枣庄 东营 烟台 潍坊 济宁 泰安 威海 日照 临沂 德州 聊城 滨州 菏泽'.split(
    ' ',
  ),
  广东: '广州 深圳 珠海 东莞 佛山'.split(' '),
  江苏: ['南京', '苏州'],
  浙江: ['杭州', '宁波'],
  安徽: ['合肥'],
  福建: ['福州', '厦门'],
  湖北: ['武汉'],
  湖南: ['长沙'],
  河南: ['郑州'],
  陕西: ['西安'],
  四川: ['成都'],
  云南: ['昆明'],
  贵州: ['贵阳'],
  江西: ['南昌'],
  广西: ['南宁'],
  海南: ['海口'],
  山西: ['太原'],
  河北: ['石家庄'],
  辽宁: ['沈阳', '大连'],
  吉林: ['长春'],
  黑龙江: ['哈尔滨'],
  甘肃: ['兰州'],
  青海: ['西宁'],
  宁夏: ['银川'],
  新疆: ['乌鲁木齐'],
  西藏: ['拉萨'],
  内蒙古: ['呼和浩特'],
  北京: ['北京'],
  天津: ['天津'],
  上海: ['上海'],
  重庆: ['重庆'],
  香港: ['香港'],
  澳门: ['澳门'],
  台湾: ['台北'],
};

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
  const target = Date.parse(deadline);
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
  const title = job.title;
  const excerpt = job.excerpt || '';

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

  let val1 = Number.parseFloat(m[1]);
  const unit1 = m[2] || '';

  const matchedStr = m[0];
  const isAnnual =
    title.includes('/年') ||
    excerpt.includes('年薪') ||
    matchedStr.includes('/年') ||
    matchedStr.includes('年');

  if (isAbove) {
    if (['万', 'w', 'W'].includes(unit1)) val1 *= 10000;
    else if (['k', 'K'].includes(unit1)) val1 *= 1000;
    if (isAnnual || (val1 >= 50000 && !matchedStr.includes('月') && !matchedStr.includes('/月'))) {
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

  if (
    isAnnual ||
    (['万', 'w', 'W'].includes(unit) && val1 >= 50000) ||
    (val1 >= 50000 && !matchedStr.includes('月') && !matchedStr.includes('/月'))
  ) {
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

export function filterJobs(
  jobs: Job[],
  f: Filters,
  personal: Personal,
  since: string | null,
  now = Date.now(),
) {
  return jobs
    .filter((j) => {
      const p = personalFor(j, personal);
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
      if (!isDomestic(j)) return false;
      if (f.provenance === '高校 / 政府' && j.provenance === '第三方线索') return false;
      if (f.provenance === '第三方线索' && j.provenance !== '第三方线索') return false;
      const location = locationMatch(j, f.city);
      if (f.city !== '全部城市' && location !== f.locationScope) return false;
      if (
        f.type !== '全部' &&
        !j.types.includes(f.type) &&
        !(f.includeUncertain && j.types.length === 0)
      )
        return false;
      if (
        f.type === '校招' &&
        f.year !== '全部' &&
        !j.graduation_years.includes(f.year) &&
        !(f.includeUncertain && j.graduation_years.length === 0)
      )
        return false;
      if (f.sector !== '全部' && !j.sectors.includes(f.sector)) return false;
      if (f.direction !== '全部' && !j.directions.includes(f.direction))
        return false;
      if (
        f.education &&
        !j.education.includes(f.education) &&
        !(f.includeUncertain && j.education.includes('未明确'))
      )
        return false;
      if (f.salary && f.salary !== '全部') {
        const threshold = salaryThreshold(f.salary);
        const sal = parseSalaryRange(j);
        if (!sal || sal.max < threshold) return false;
      }
      if (f.query.trim()) {
        const keywords = f.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (keywords.length) {
          const searchable = [
            j.title,
            j.company,
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
    })
    .sort((a, b) => {
      if (f.sort === 'deadline_asc') {
        const aExp = isExpired(a, now);
        const bExp = isExpired(b, now);
        if (aExp !== bExp) return aExp ? 1 : -1;

        const aTime = a.deadline ? Date.parse(a.deadline) : Number.POSITIVE_INFINITY;
        const bTime = b.deadline ? Date.parse(b.deadline) : Number.POSITIVE_INFINITY;

        if (Number.isFinite(aTime) && Number.isFinite(bTime)) {
          return (
            aTime - bTime ||
            (b.published_at ?? '').localeCompare(a.published_at ?? '') ||
            a.id.localeCompare(b.id)
          );
        }
        if (Number.isFinite(aTime) !== Number.isFinite(bTime)) {
          return Number.isFinite(aTime) ? -1 : 1;
        }
        return (
          (b.published_at ?? '').localeCompare(a.published_at ?? '') ||
          a.id.localeCompare(b.id)
        );
      }

      if (f.sort === 'salary_desc') {
        const aRange = parseSalaryRange(a);
        const bRange = parseSalaryRange(b);
        const aSal = aRange ? (Number.isFinite(aRange.max) ? aRange.max : aRange.min) : -1;
        const bSal = bRange ? (Number.isFinite(bRange.max) ? bRange.max : bRange.min) : -1;
        if (aSal !== bSal) return bSal - aSal;
        return (
          (b.published_at ?? '').localeCompare(a.published_at ?? '') ||
          a.id.localeCompare(b.id)
        );
      }

      return (
        (b.published_at ?? '').localeCompare(a.published_at ?? '') ||
        a.id.localeCompare(b.id)
      );
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
    for (const key of Object.keys(row)) {
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
    result[id] = {
      saved: row.saved === true,
      applied: row.applied === true,
      hidden: row.hidden === true,
      ...(Object.hasOwn(row, 'readAt') ? { readAt: row.readAt as string | null } : {}),
    };
  }
  return result;
}
export function externalUrl(url: string | null | undefined) {
  try {
    const u = new URL(url ?? '');
    return ['https:', 'http:'].includes(u.protocol) ? u.href : undefined;
  } catch {
    return undefined;
  }
}
