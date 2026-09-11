import type { Job } from './jobs.ts';

export type JobGroup = { id: string; company: string; label: string; jobs: Job[] };

/** Presentation only: keep every matching record and its own application/read state. */
export function groupJobs(jobs: Job[], enabled = true): JobGroup[] {
  const groups = new Map<string, JobGroup>();
  for (const job of jobs) {
    const company = job.company.trim().replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')');
    const titleCohorts = [...new Set([...job.title.matchAll(/(20\d{2})\s*届/g)].map((m) => m[1]))];
    const cohorts = titleCohorts.length ? titleCohorts : job.graduation_years;
    const phase = /提前批|春(?:季校园招聘|季招聘|招)|秋(?:季校园招聘|季招聘|招)|补录|补招/.exec(job.title)?.[0]?.replace(/^春.*/, '春招').replace(/^秋.*/, '秋招') || '校招';
    // Preserve branches and legal entities verbatim. Do not guess aliases or a missing cohort.
    const canGroup = enabled && company && cohorts.length === 1 && job.types.length === 1 && job.types[0] === '校招';
    const id = canGroup ? JSON.stringify([company, cohorts[0], phase]) : job.id;
    const existing = groups.get(id);
    if (existing) existing.jobs.push(job);
    else groups.set(id, { id, company: job.company, label: canGroup ? `${cohorts[0]} 届 · ${phase}` : '', jobs: [job] });
  }
  // Input is already sorted; insertion order gives each group its newest member's position.
  return [...groups.values()];
}
