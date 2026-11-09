import type { Job } from './jobs.ts';
import {
  cardJobTitle,
  effectiveJobTypes,
  employerGroupName,
  formatCompanyDisplay,
  formatEducationDisplay,
} from './jobs.ts';
import { extractSalary } from './salary-display.ts';

export type JobGroup = { id: string; company: string; label: string; jobs: Job[] };

export type GroupRoleItem = {
  job: Job;
  rawRole: string;
  cleanRole: string;
  suffix: string;
  city: string;
  eduShort: string;
  subUnit: string;
  tooltipMeta: string;
  searchText: string;
};

/** Build role chip metadata for a company group, disambiguating duplicate role names. */
export function buildGroupRoleItems(jobs: Job[], groupCompany?: string): GroupRoleItem[] {
  const prelim = jobs.map((item) => {
    const displayCompany = formatCompanyDisplay(item.company, item.title, item.source_id).displayCompany;
    const rawRole = cardJobTitle(
      extractSalary(item).cleanTitle,
      item.company,
      displayCompany,
    );
    const cleanRole = rawRole.replace(/\s*[（(][A-Za-z]\d{4,}[)）]\s*$/, '').trim() || rawRole;
    const baseGroup = (groupCompany || employerGroupName(item) || '').trim();
    const rawComp = (item.company || '').trim();
    const subCandidate =
      rawComp && rawComp !== baseGroup
        ? rawComp.startsWith(baseGroup)
          ? rawComp.slice(baseGroup.length).replace(/^[·•—\-\s]+|[·•—\-\s]+$/g, '').trim()
          : rawComp
        : '';
    const subUnit = subCandidate && subCandidate.length <= 14 ? subCandidate : '';
    const city =
      (item.cities || []).find(
        (c) => c && c !== '全国' && c !== '其他' && c !== '地区待确认',
      ) || '';
    const eduRaw = formatEducationDisplay(item.education);
    const eduShort =
      eduRaw === '博士研究生' || eduRaw === '博士生毕业'
        ? '博士'
        : eduRaw === '硕士研究生' || eduRaw === '硕士生毕业'
          ? '硕士'
          : eduRaw === '本科生毕业' || eduRaw === '本科及以上'
            ? '本科'
            : eduRaw === '学历待确认' || eduRaw === '学历待核实'
              ? ''
              : eduRaw;
    return { item, rawRole, cleanRole, subUnit, city, eduShort };
  });

  const roleCounts = new Map<string, number>();
  const roleSubCounts = new Map<string, number>();
  const roleCityCounts = new Map<string, number>();
  for (const p of prelim) {
    roleCounts.set(p.cleanRole, (roleCounts.get(p.cleanRole) || 0) + 1);
    if (p.subUnit) {
      const subKey = `${p.cleanRole}::${p.subUnit}`;
      roleSubCounts.set(subKey, (roleSubCounts.get(subKey) || 0) + 1);
    }
    if (p.city) {
      const cityKey = `${p.cleanRole}::${p.city}`;
      roleCityCounts.set(cityKey, (roleCityCounts.get(cityKey) || 0) + 1);
    }
  }

  return prelim.map(({ item, rawRole, cleanRole, subUnit, city, eduShort }) => {
    let suffix = '';
    if ((roleCounts.get(cleanRole) || 0) > 1) {
      if (subUnit) {
        const subKey = `${cleanRole}::${subUnit}`;
        suffix = (roleSubCounts.get(subKey) || 0) > 1 && city ? `${subUnit}·${city}` : subUnit;
      } else if (city) {
        const cityKey = `${cleanRole}::${city}`;
        suffix = (roleCityCounts.get(cityKey) || 0) > 1 && eduShort ? `${city}·${eduShort}` : city;
      } else if (eduShort) {
        suffix = eduShort;
      }
    }
    const tooltipMeta = [subUnit, city, eduShort].filter(Boolean).join(' · ');
    const searchText = [
      rawRole,
      cleanRole,
      subUnit,
      ...(item.cities || []),
      eduShort,
      item.company || '',
    ]
      .join(' ')
      .toLowerCase();
    return {
      job: item,
      rawRole,
      cleanRole,
      suffix,
      city,
      eduShort,
      subUnit,
      tooltipMeta,
      searchText,
    };
  });
}

/** Presentation only: keep every matching record and its own application/read state. */
export function groupJobs(jobs: Job[], enabled = true): JobGroup[] {
  const groups = new Map<string, JobGroup>();
  for (const job of jobs) {
    const groupName = employerGroupName(job);
    const company = groupName.trim().replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')');
    const titleCohorts = [...new Set([...job.title.matchAll(/(20\d{2})\s*届/g)].map((m) => m[1]))];
    const cohorts = titleCohorts.length ? titleCohorts : job.graduation_years;
    const phase = /提前批|春(?:季校园招聘|季招聘|招)|秋(?:季校园招聘|季招聘|招)|补录|补招/.exec(job.title)?.[0]?.replace(/^春.*/, '春招').replace(/^秋.*/, '秋招') || '校招';
    // Preserve branches and legal entities verbatim. Do not guess aliases or a
    // missing cohort: records without a cohort/type only group with others that
    // are equally unstated, and the label says so.
    const types = effectiveJobTypes(job);
    const type = types.length === 1 ? types[0] : types.length === 0 ? '' : [...new Set(types)].sort().join(' / ');
    const cohort = [...new Set(cohorts)].sort().join(' / ');
    const canGroup = enabled && !!company;
    const kindLabel = type === '社招' ? '社招' : type === '校招' ? phase : type || '类型未明确';
    const id = canGroup ? JSON.stringify([company, type, cohort, type === '校招' ? phase : '']) : job.id;
    const existing = groups.get(id);
    if (existing) existing.jobs.push(job);
    else groups.set(id, { id, company: groupName, label: canGroup ? `${cohort ? `${cohort} 届` : '届别未明确'} · ${kindLabel}` : '', jobs: [job] });
  }
  // Input is already sorted; insertion order gives each group its newest member's position.
  return [...groups.values()];
}
