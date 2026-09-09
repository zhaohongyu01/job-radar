export type Job = {
  id: string;
  title: string;
  company: string;
  source_id: string;
  source_name: string;
  source_url: string;
  published_at: string | null;
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
  showExpired: boolean;
  view: string;
  onlyNew: boolean;
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
  showExpired: false,
  view: 'all',
  onlyNew: false,
};
export function isExpired(job: Job, now = Date.now()) {
  return !!job.deadline && Date.parse(job.deadline) < now;
}
export function locationMatch(
  job: Job,
  city: string,
): 'exact' | 'possible' | 'none' {
  if (city === '全部城市' || job.cities.includes(city)) return 'exact';
  if (
    job.possible_cities.includes(city) ||
    (city === '济南' && job.province_possible) ||
    job.cities.length === 0
  )
    return 'possible';
  return 'none';
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
      const p = personal[j.id] ?? {};
      if (
        (f.view === 'saved' && !p.saved) ||
        (f.view === 'applied' && !p.applied) ||
        (f.view === 'hidden' && !p.hidden)
      )
        return false;
      if (f.view === 'all' && p.hidden) return false;
      if (!f.showExpired && isExpired(j, now)) return false;
      const location = locationMatch(j, f.city);
      if (
        location === 'none' ||
        (location === 'possible' && !f.includeUncertain)
      )
        return false;
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
