import { defaultFilters, UNKNOWN_SECTOR } from './jobs.ts';
import type { Filters } from './jobs.ts';
import { normalizeCity } from './cities.ts';
import { employerFromId } from './employers.ts';

const ENUMS = {
  type: ['全部', '校招', '社招'],
  sector: ['全部', '企业 / 其他', '国企', '事业单位', '公务员', '银行', '保险', UNKNOWN_SECTOR],
  direction: ['全部', '财务 / 经济', '管理 / 职能', '技术 / 研发', '市场 / 销售'],
  locationScope: ['exact', 'possible', 'unknown'], view: ['all', 'saved', 'applied', 'hidden', 'planned', 'pipeline'],
  applicationStage: ['all', 'planned', 'applied', 'test', 'interview', 'offer', 'rejected', 'withdrawn'],
  provenance: ['全部', '高校 / 政府', '第三方线索'], kind: ['全部', '具体岗位', '招聘公告'],
  salary: ['全部', '6K以上', '8K以上', '10K以上', '15K以上', '20K以上'],
  sort: ['newest', 'deadline_asc', 'salary_desc', 'reputation_desc', 'employer_intent_desc'],
  reputationMin: ['all', '3', '4'],
  changeType: ['全部', '有变更', '截止延期', '补录招募', '岗位调整', '考核阶段'],
  radarFocus: ['none', 'today', 'supplement', 'urgent', 'change'],
  employmentType: ['all', 'full_time', 'internship', 'part_time'],
  validity: ['all', 'confirmed_open', 'long_term', 'unconfirmed'],
} as const;
const BOOLEANS = ['includeUncertain', 'showExpired', 'onlyNew', 'onlyUnread', 'includeRelatedTalks', 'includeUnrated'] as const;
const TEXT = ['query', 'education', 'major'] as const;
const legacySector = (value: unknown) => value === '综合' || value === '综合（高校 / 平台公告）' ? UNKNOWN_SECTOR : value;
const cityName = (value: unknown) => typeof value === 'string' && /^[\u4e00-\u9fff]{2,24}$/.test(value)
  ? normalizeCity(value) || value : null;

export type ViewMode = 'cards' | 'table';
export function restoreBrowsing(input: unknown): { filters: Filters; viewMode: ViewMode; groupCompanies: boolean } {
  const result = { filters: { ...defaultFilters }, viewMode: 'cards' as ViewMode, groupCompanies: false };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result;
  const value = input as Record<string, unknown>;
  if (typeof value.groupCompanies === 'boolean') result.groupCompanies = value.groupCompanies;
  if (value.viewMode === 'table') result.viewMode = 'table';
  if (!value.filters || typeof value.filters !== 'object' || Array.isArray(value.filters)) return result;
  const fields = { ...(value.filters as Record<string, unknown>) };
  fields.sector = legacySector(fields.sector);
  for (const key of Object.keys(ENUMS) as (keyof typeof ENUMS)[]) {
    const field = fields[key];
    if (typeof field === 'string' && (ENUMS[key] as readonly string[]).includes(field))
      Object.assign(result.filters, { [key]: field });
  }
  for (const key of BOOLEANS) {
    if (typeof fields[key] === 'boolean') result.filters[key] = fields[key];
  }
  for (const key of TEXT) {
    if (typeof fields[key] === 'string') result.filters[key] = fields[key].slice(0, 200);
  }
  const city = cityName(fields.city);
  if (city) result.filters.city = city;
  if (Array.isArray(fields.workCities)) {
    result.filters.workCities = [...new Set(fields.workCities.map(cityName).filter((v): v is string => !!v && v !== '全部城市'))].slice(0, 20);
    result.filters.city = result.filters.workCities.length === 1 ? result.filters.workCities[0] : '全部城市';
  }
  // Existing saved browsing used local talks as an alternative to work-city matching.
  if (!Object.hasOwn(fields, 'includeRelatedTalks')) result.filters.includeRelatedTalks = true;
  if (typeof fields.year === 'string' && /^(全部|20\d{2})$/.test(fields.year)) result.filters.year = fields.year;
  return result;
}

export function parseUrlState(search: string): { filters?: Partial<Filters>; jobId?: string; employerId?: string } {
  if (!search) return {};
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const result: { filters?: Partial<Filters>; jobId?: string; employerId?: string } = {};
  const employerId = params.get('employer');
  if (employerId) { try { result.employerId = employerFromId(employerId).id; } catch { /* Invalid shared identity is ignored. */ } }

  const jobId = params.get('job');
  if (jobId && /^[a-zA-Z0-9_-]{8,64}$/.test(jobId)) {
    result.jobId = jobId;
  }

  const known = ['f', 'q', 'city', 'cities', 'year', ...Object.keys(ENUMS), ...BOOLEANS, ...TEXT];
  if (!result.jobId && !result.employerId && !known.some((key) => params.has(key))) return result;
  // A shared URL is a complete snapshot of conditions, not a patch to this device.
  const fields: Record<string, unknown> = { ...defaultFilters };
  for (const key of Object.keys(ENUMS)) if (params.has(key)) fields[key] = params.get(key);
  for (const key of BOOLEANS) {
    const value = params.get(key);
    if (value === '1' || value === '0') fields[key] = value === '1';
  }
  for (const key of TEXT) if (params.has(key === 'query' ? 'q' : key)) fields[key] = params.get(key === 'query' ? 'q' : key);
  if (params.has('year')) fields.year = params.get('year');
  const city = params.get('city');
  if (city === '全部城市' || (city && normalizeCity(city))) fields.city = city === '全部城市' ? city : normalizeCity(city);
  if (params.has('cities')) {
    const raw = params.get('cities')!;
    const cities = [...new Set(raw.split(',').map((value) => normalizeCity(value)).filter((value): value is string => !!value))].slice(0, 20);
    if (!raw || cities.length) fields.workCities = cities;
  }
  result.filters = restoreBrowsing({ filters: fields }).filters;
  return result;
}

export function formatUrlQuery(filters: Filters, jobId?: string | null, employerId?: string | null): string {
  const params = new URLSearchParams({ f: '1' });
  const normalized = restoreBrowsing({ filters: { ...defaultFilters, ...filters } }).filters;
  if (jobId) params.set('job', jobId);
  if (employerId) params.set('employer', employerFromId(employerId).id);
  if (normalized.workCities) {
    params.set('cities', normalized.workCities.join(','));
  } else if (normalized.city !== defaultFilters.city) {
    params.set('city', normalized.city);
  }
  for (const key of Object.keys(ENUMS) as (keyof typeof ENUMS)[]) {
    if (normalized[key] !== defaultFilters[key]) params.set(key, String(normalized[key]));
  }
  for (const key of BOOLEANS) if (normalized[key] !== defaultFilters[key]) params.set(key, normalized[key] ? '1' : '0');
  for (const key of TEXT) if (normalized[key]) params.set(key === 'query' ? 'q' : key, normalized[key]!);
  if (normalized.year !== defaultFilters.year) params.set('year', normalized.year);
  return `?${params.toString()}`;
}
