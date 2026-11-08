import type { Job } from './jobs.ts';
import { employerGroupName, effectiveJobTypes } from './jobs.ts';

export type JobGroup = { id: string; company: string; label: string; jobs: Job[] };

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
    const type = types.length === 1 ? types[0] : types.length === 0 ? '' : null;
    const cohort = cohorts.length === 1 ? cohorts[0] : cohorts.length === 0 ? '' : null;
    const canGroup = enabled && !!company && type !== null && cohort !== null;
    const kindLabel = type === '社招' ? '社招' : type === '校招' ? phase : '类型未明确';
    const id = canGroup ? JSON.stringify([company, type, cohort, type === '校招' ? phase : '']) : job.id;
    const existing = groups.get(id);
    if (existing) existing.jobs.push(job);
    else groups.set(id, { id, company: groupName, label: canGroup ? `${cohort ? `${cohort} 届` : '届别未明确'} · ${kindLabel}` : '', jobs: [job] });
  }
  // Input is already sorted; insertion order gives each group its newest member's position.
  return [...groups.values()];
}
