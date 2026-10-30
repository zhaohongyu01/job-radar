import { employerBrand } from './jobs.ts';
import type { Job } from './jobs.ts';
import brands from '../config/employer-brands.json' with { type: 'json' };

export type EmployerScope = 'name' | 'source' | 'brand' | 'department';
export type EmployerProfile = {
  id: string; name: string; scope: EmployerScope; source: string; brand?: string;
};
const prefix = 'employer:v1:';
const scopes = new Set(['name', 'source', 'brand', 'department']);
const canonical = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ');
const department = new RegExp(brands.department_pattern);

function profile(scope: EmployerScope, name: string, source = '', brand?: string): EmployerProfile {
  return { id: prefix + JSON.stringify([scope, source, name]), name, scope, source, ...(brand ? { brand } : {}) };
}

/** Exact names retain legal suffixes and branch names. This is a name match,
 * never a claim of registration verification, nor a replacement for job IDs. */
export function resolveEmployer(job: Pick<Job, 'id' | 'company' | 'source_id' | 'source_name' | 'company_conflict'>): EmployerProfile | null {
  const name = canonical(job.company || '');
  const brand = employerBrand(job.source_id);
  // A fair/joint announcement is not one employer. Do not create a shared
  // rating for several organisations merely because the text ends in 公司.
  if (/[、;；|｜]|\s[&+/]\s|等\d+家|多家企业|联合招聘/.test(name)) return null;
  if (!name || /待核实|待确认|见原|未知|未明确|招聘单位名称|来源单位字段|^(?:招聘单位|企业名称|公司名称|单位名称)$/.test(name))
    return brand ? profile('brand', brand) : null;
  if (brand && name === brand) return profile('brand', brand);
  if (brand && department.test(name)) return profile('department', name, brand, brand);
  if (name.length > 160) return null;
  // Abbreviations, conflicting names and departments remain scoped to their
  // original source until an explicit identity mapping can disambiguate them.
  if (!job.company_conflict && /(?:有限责任公司|股份有限公司|有限公司|股份公司|分公司|分行|支行)$/.test(name))
    return profile('name', name, '', brand || undefined);
  return profile('source', name, canonical(job.source_id || job.source_name || job.id).slice(0, 120), brand || undefined);
}

export function employerFromId(id: string): EmployerProfile {
  if (!id.startsWith(prefix) || id.length > 700) throw Error('企业档案标识不正确');
  const value: unknown = JSON.parse(id.slice(prefix.length));
  if (!Array.isArray(value) || value.length !== 3 || !value.every(v => typeof v === 'string') ||
      !scopes.has(value[0]) || !value[2] || value[2].length > 160 || value[1].length > 160 ||
      canonical(value[2]) !== value[2] || canonical(value[1]) !== value[1] ||
      ((value[0] === 'name' || value[0] === 'brand') && value[1]) ||
      ((value[0] === 'source' || value[0] === 'department') && !value[1]))
    throw Error('企业档案标识不正确');
  const result = profile(value[0] as EmployerScope, value[2], value[1], value[0] === 'department' ? value[1] : undefined);
  if (id !== result.id) throw Error('企业档案标识不正确');
  return result;
}

export function employerLabel(value: EmployerProfile): string {
  return value.scope === 'department' ? `${value.brand || value.source} · ${value.name}` : value.name;
}

/** Search entrances, not purported company pages or pre-fetched review data. */
export function employerResearchLinks(keyword: string) {
  const name = canonical(keyword).slice(0, 160);
  if (!name) return [];
  return [
    { label: '历史看准评价检索', domain: 'kanzhun.com', topic: '公司评价' },
    { label: '牛客面经', domain: 'nowcoder.com', topic: '面经' },
    { label: '脉脉工作体验', domain: 'maimai.cn', topic: '工作体验' },
  ].map(source => ({ ...source, url: `https://www.bing.com/search?q=${encodeURIComponent(`site:${source.domain} "${name.replaceAll('"', '')}" ${source.topic}`)}` }));
}
