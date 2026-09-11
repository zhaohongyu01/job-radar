import { defaultFilters } from './jobs.ts';
import type { Filters } from './jobs.ts';

export type ViewMode = 'cards' | 'table';
export function restoreBrowsing(input: unknown): { filters: Filters; viewMode: ViewMode; groupCompanies: boolean } {
  const result = { filters: { ...defaultFilters }, viewMode: 'cards' as ViewMode, groupCompanies: true };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result;
  const value = input as Record<string, unknown>;
  if (typeof value.groupCompanies === 'boolean') result.groupCompanies = value.groupCompanies;
  if (value.viewMode === 'table') result.viewMode = 'table';
  if (!value.filters || typeof value.filters !== 'object' || Array.isArray(value.filters)) return result;
  const fields = { ...(value.filters as Record<string, unknown>) };
  const enums = {
    type: ['全部', '校招', '社招'],
    sector: ['全部', '企业 / 其他', '银行', '国企', '事业单位', '公务员'],
    direction: ['全部', '财务 / 经济', '管理 / 职能', '技术 / 研发', '市场 / 销售'],
    locationScope: ['exact', 'possible', 'unknown'],
    view: ['all', 'saved', 'applied', 'hidden'],
    provenance: ['全部', '高校 / 政府', '第三方线索'],
    kind: ['全部', '具体岗位', '招聘公告'],
  } as const;
  for (const key of Object.keys(enums) as (keyof typeof enums)[]) {
    const field = fields[key];
    if (typeof field === 'string' && (enums[key] as readonly string[]).includes(field))
      Object.assign(result.filters, { [key]: field });
  }
  for (const key of ['includeUncertain', 'showExpired', 'onlyNew', 'onlyUnread'] as const) {
    if (typeof fields[key] === 'boolean') result.filters[key] = fields[key];
  }
  for (const key of ['query', 'education'] as const) {
    if (typeof fields[key] === 'string') result.filters[key] = fields[key].slice(0, 200);
  }
  if (typeof fields.city === 'string' && /^[\u4e00-\u9fff]{2,12}$/.test(fields.city)) result.filters.city = fields.city;
  if (typeof fields.year === 'string' && /^(全部|20\d{2})$/.test(fields.year)) result.filters.year = fields.year;
  return result;
}
