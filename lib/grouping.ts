import type { Job } from './jobs.ts';
import {
  cardJobTitle,
  effectiveJobTypes,
  employerGroupName,
  extractTitleCohorts,
  formatCompanyDisplay,
  formatEducationDisplay,
  normalizeCompanyName,
  resolveEffectiveCohorts,
  stripTrailingAtsCode,
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
    const strippedRole =
      stripTrailingAtsCode(rawRole).replace(/\s*[（(][A-Za-z]\d{4,}[)）]\s*$/, '').trim() || rawRole;
    const rawPosList = [
      ...(item.positions || []).map((p) => p.name || p.position_name || ''),
      ...(item.sample_positions || []),
    ];
    const posNames = [
      ...new Set(
        rawPosList
          .map((n) => stripTrailingAtsCode(n.trim()))
          .filter((name) => name.length > 0 && !/^\d+$/.test(name)),
      ),
    ];
    const isGenericBrochureRole = /^(?:20\d{2}\s*[年届]?\s*)?(?:春季|秋季|校园|社会|公开)?(?:招聘|招聘简章|招聘公告|引才公告|简章|公告)$/.test(
      strippedRole,
    );
    const cleanRole =
      isGenericBrochureRole && posNames.length > 0
        ? posNames.length === 1
          ? posNames[0]
          : `${posNames.slice(0, 2).join(' / ')}${posNames.length > 2 ? ` 等${posNames.length}岗` : ''}`
        : strippedRole;
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
      ...(item.positions || []).map((p) => p.name || p.position_name || ''),
      ...(item.sample_positions || []),
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
  if (!enabled) {
    return jobs.map((job) => ({
      id: job.id,
      company: employerGroupName(job),
      label: '',
      jobs: [job],
    }));
  }

  type Entry = {
    job: Job;
    groupName: string;
    company: string;
    type: string;
    phase: string;
    kindLabel: string;
    cohorts: string[];
    cohortKey: string;
    bucketKey: string;
  };

  const entries: Entry[] = jobs.map((job) => {
    const groupName = employerGroupName(job);
    const rawTrimmed = groupName.trim().replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')');
    const company = normalizeCompanyName(groupName) || rawTrimmed;
    const titleCohorts = extractTitleCohorts(job.title ?? '', false);
    const cohorts = resolveEffectiveCohorts(titleCohorts, job.graduation_years);
    const phase =
      /提前批|春(?:季校园招聘|季招聘|招)|秋(?:季校园招聘|季招聘|招)|补录|补招/
        .exec(job.title)?.[0]
        ?.replace(/^春.*/, '春招')
        .replace(/^秋.*/, '秋招') || '校招';
    // Preserve branches and legal entities verbatim. Do not guess aliases or a
    // missing cohort: records without a cohort/type only group with others that
    // are equally unstated, and the label says so.
    const types = effectiveJobTypes(job);
    const type =
      types.length === 1
        ? types[0]
        : types.length === 0
          ? ''
          : [...new Set(types)].sort().join(' / ');
    const cohortKey = cohorts.join(' / ');
    const kindLabel = type === '社招' ? '社招' : type === '校招' ? phase : type || '类型未明确';
    const bucketKey = company ? JSON.stringify([company, type, type === '校招' ? phase : '']) : '';
    return { job, groupName, company, type, phase, kindLabel, cohorts, cohortKey, bucketKey };
  });

  // Within the same (company, type, phase) bucket, fold non-empty cohort sets
  // into a unique maximal superset present in that bucket (e.g. 2026/2027届
  // folds into 2025/2026/2027届), while keeping disjoint cohorts (2026届 vs
  // 2027届) and unstated cohorts ([]) strictly separate.
  const bucketCohorts = new Map<string, Map<string, string[]>>();
  for (const e of entries) {
    if (!e.bucketKey || !e.cohorts.length) continue;
    let map = bucketCohorts.get(e.bucketKey);
    if (!map) {
      map = new Map<string, string[]>();
      bucketCohorts.set(e.bucketKey, map);
    }
    if (!map.has(e.cohortKey)) map.set(e.cohortKey, e.cohorts);
  }

  const cohortAlias = new Map<string, Map<string, string>>();
  for (const [bucketKey, cohortMap] of bucketCohorts.entries()) {
    if (cohortMap.size <= 1) continue;
    const allSets = [...cohortMap.entries()];
    const isSubset = (sub: string[], sup: string[]) =>
      sub.length <= sup.length && sub.every((y) => sup.includes(y));
    const maximals = allSets.filter(
      ([kA, setA]) => !allSets.some(([kB, setB]) => kA !== kB && isSubset(setA, setB)),
    );
    const resolved = new Map<string, string>();
    for (const [key, set] of allSets) {
      const covering = maximals.filter(([, maxSet]) => isSubset(set, maxSet));
      if (covering.length === 1) resolved.set(key, covering[0][0]);
    }
    if (resolved.size) cohortAlias.set(bucketKey, resolved);
  }

  const groups = new Map<string, JobGroup>();
  for (const e of entries) {
    const canGroup = !!e.company;
    const effectiveCohort =
      canGroup && e.cohortKey
        ? (cohortAlias.get(e.bucketKey)?.get(e.cohortKey) ?? e.cohortKey)
        : e.cohortKey;
    const id = canGroup
      ? JSON.stringify([e.company, e.type, effectiveCohort, e.type === '校招' ? e.phase : ''])
      : e.job.id;
    const existing = groups.get(id);
    if (existing) {
      existing.jobs.push(e.job);
    } else {
      groups.set(id, {
        id,
        company: e.groupName,
        label: canGroup
          ? `${effectiveCohort ? `${effectiveCohort} 届` : '届别未明确'} · ${e.kindLabel}`
          : '',
        jobs: [e.job],
      });
    }
  }
  // Input is already sorted; insertion order gives each group its newest member's position.
  return [...groups.values()];
}
