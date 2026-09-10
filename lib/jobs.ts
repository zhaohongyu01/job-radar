export type Job = {
  id: string;
  title: string;
  company: string;
  source_id: string;
  source_name: string;
  source_url: string;
  published_at: string | null;
  date_label?: string;
  provenance?: string;
  duplicate_sources?: { title: string; url: string }[];
  duplicate_ids?: string[];
  kind: string;
  types: string[];
  graduation_years: string[];
  sectors: string[];
  directions: string[];
  cities: string[];
  possible_cities: string[];
  province_possible: boolean;
  location_evidence: string[];
  education: string;
  deadline: string | null;
  deadline_evidence: string | null;
  deadline_precision: string | null;
  application_url: string | null;
  emails: string[];
  attachments: { title: string; url: string }[];
  links: { title: string; url: string }[];
  qr_attachment: boolean;
  excerpt: string;
  body: string;
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
  cities: string[];
  jobs: Job[];
  sources: Source[];
};
export type Personal = Record<
  string,
  { saved?: boolean; applied?: boolean; hidden?: boolean }
>;
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
  provenance: string;
  kind: string;
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
  provenance: '全部',
  kind: '全部',
};
export function isExpired(job: Job, now = Date.now()) {
  return !!job.deadline && Date.parse(job.deadline) < now;
}
export function personalFor(job: Job, personal: Personal) {
  if (personal[job.id]) return personal[job.id];
  const records = (job.duplicate_ids ?? []).map((id) => personal[id]);
  return {
    saved: records.some((record) => record?.saved),
    applied: records.some((record) => record?.applied),
    hidden: records.some((record) => record?.hidden),
  };
}
export function locationMatch(
  job: Job,
  city: string,
): 'exact' | 'possible' | 'unknown' | 'none' {
  if (city === '全部城市' || job.cities.includes(city)) return 'exact';
  // Only recruitment location evidence counts; headquarters and body mentions do not.
  const evidence = (job.location_evidence ?? []).join('\n');
  if (/全国|不限城市|各地可选/.test(evidence)) return 'possible';
  const province = Object.entries(PROVINCE_CITIES).find(([, cities]) =>
    cities.includes(city),
  )?.[0];
  const provinces = Object.keys(PROVINCE_CITIES).filter((p) =>
    evidence.includes(p),
  );
  // A province inside a specific address is not province-wide recruitment.
  const broadPattern = province && new RegExp(`${province}(?:省)?[ \\t]*(?=$|[/、，,；;\\n]|各地|全省|不限|多个城市|分行辖属)`);
  const detailLocations = (job.location_evidence ?? []).filter((line) => /^(?:工作地点|工作城市|岗位地点)/.test(line));
  const specificDetail = detailLocations.some((line) => job.cities.some((c) => line.includes(c)));
  if (specificDetail && broadPattern && !detailLocations.some((line) => broadPattern.test(line))) return 'none';
  if (broadPattern && broadPattern.test(evidence)) return 'possible';
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
      if (
        (f.view === 'saved' && !p.saved) ||
        (f.view === 'applied' && !p.applied) ||
        (f.view === 'hidden' && !p.hidden)
      )
        return false;
      if (f.view === 'all' && p.hidden) return false;
      if (!f.showExpired && isExpired(j, now)) return false;
      if (f.kind !== '全部' && j.kind !== f.kind) return false;
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
      if (
        f.query &&
        !`${j.title} ${j.company} ${j.body}`
          .toLowerCase()
          .includes(f.query.trim().toLowerCase())
      )
        return false;
      if (
        f.onlyNew &&
        (!since ||
          (Date.parse(j.first_seen_at) <= Date.parse(since) &&
            Date.parse(j.updated_at) <= Date.parse(since)))
      )
        return false;
      return true;
    })
    .sort(
      (a, b) =>
        (b.published_at ?? '').localeCompare(a.published_at ?? '') ||
        a.id.localeCompare(b.id),
    );
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
    for (const key of Object.keys(row))
      if (
        !['saved', 'applied', 'hidden'].includes(key) ||
        typeof row[key] !== 'boolean'
      )
        throw Error('备份状态不正确');
    result[id] = {
      saved: row.saved === true,
      applied: row.applied === true,
      hidden: row.hidden === true,
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
