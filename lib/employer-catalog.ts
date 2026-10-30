import { resolveEmployer } from './employers.ts';
import type { EmployerProfile } from './employers.ts';
import type { Job, TalkEvent } from './jobs.ts';

export type EmployerCatalogEntry = { profile: EmployerProfile; jobs: Job[] };
export function buildEmployerCatalog(jobs: Job[]): Map<string, EmployerCatalogEntry> {
  const result = new Map<string, EmployerCatalogEntry>();
  for (const job of jobs) {
    const profile = resolveEmployer(job);
    if (!profile) continue;
    const existing = result.get(profile.id);
    if (existing) existing.jobs.push(job);
    else result.set(profile.id, { profile, jobs: [job] });
  }
  return result;
}
export function employerEvents(jobs: Job[]): { event: TalkEvent; job: Job }[] {
  const result = new Map<string, { event: TalkEvent; job: Job }>();
  for (const job of jobs) for (const event of job.talk_events || (job.talk_event ? [job.talk_event] : []))
    if (!result.has(event.id)) result.set(event.id, { event, job });
  return [...result.values()].sort((a, b) => `${a.event.date}T${a.event.start_time || '23:59'}`.localeCompare(`${b.event.date}T${b.event.start_time || '23:59'}`));
}
