export type Job = {
  id: string;
  title: string;
  company: string;
  company_note?: string;
  company_original?: string;
  company_conflict?: boolean;
  source_id: string;
  source_name: string;
  source_url: string;
  published_at: string | null;
  date_label?: string;
  provenance?: string;
  duplicate_sources?: {
    title: string;
    url: string;
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
export function personalFor(job: Job, personal: Personal) {
  if (personal[job.id]) return personal[job.id];
  const records = (job.duplicate_ids ?? []).map((id) => personal[id]);
  const readAt = records.flatMap((record) => record?.readAt ? [record.readAt] : []).sort().at(-1);
  return {
    saved: records.some((record) => record?.saved),
    applied: records.some((record) => record?.applied),
    hidden: records.some((record) => record?.hidden),
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
  const broadPattern = province && new RegExp(`${province}(?:省)?[ \\t]*(?=$|[/、，,；;\\n]|各地|全省|不限|多个城市|分行辖属)`);
  const detailLocations = (job.location_evidence ?? []).filter((line) => /^(?:工作地点|工作城市|岗位地点|招聘地点)/.test(line));
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

  if (isAbove) {
    if (['万', 'w', 'W'].includes(unit1)) val1 *= 10000;
    else if (['k', 'K'].includes(unit1)) val1 *= 1000;
    if (val1 < 1000) return null;
    return { min: Math.round(val1), max: Number.POSITIVE_INFINITY, raw: m[0].trim() };
  }

  let val2 = Number.parseFloat(m[3]);
  const unit2 = m[4] || '';
  const unit = unit2 || unit1 || '';
  const isAnnual = title.includes('/年') || excerpt.includes('年薪');

  if (['万', 'w', 'W'].includes(unit)) {
    val1 *= 10000;
    val2 *= 10000;
  } else if (['k', 'K'].includes(unit)) {
    val1 *= 1000;
    val2 *= 1000;
  }

  if (isAnnual || (['万', 'w', 'W'].includes(unit) && val1 >= 50000)) {
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
        const aSal = parseSalaryRange(a)?.max ?? -1;
        const bSal = parseSalaryRange(b)?.max ?? -1;
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
