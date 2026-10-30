import { defaultFilters, personalFor, isPendingApplication, comparePendingApplications } from './jobs.ts';
import type { Filters, Job, Personal, TalkEvent } from './jobs.ts';

/** Personal lists start without discovery restrictions, so saved jobs cannot disappear. */
export function personalViewFilters(view: Filters['view']): Filters {
  return {
    ...defaultFilters,
    view,
    city: '全部城市',
    workCities: [],
    year: '全部',
    showExpired: true,
  };
}

export function buildActionQueue(jobs: Job[], personal: Personal, now: number) {
  return jobs.filter(job => isPendingApplication(job, personalFor(job, personal), now)).sort(comparePendingApplications);
}

export function upcomingTalks(
  jobs: Job[],
  personal: Personal,
  city: string,
  now: number,
) {
  const parents = new Map(jobs.map((job) => [job.id, job]));
  const events = new Map<string, { job: Job; event: TalkEvent }>();
  // Prefer the recruitment record that already contains this talk over its standalone source.
  const ordered = [...jobs].sort(
    (a, b) => Number(!!a.talk_attached_to) - Number(!!b.talk_attached_to),
  );
  for (const job of ordered) {
    const parent = job.talk_attached_to
      ? parents.get(job.talk_attached_to)
      : undefined;
    if (
      personalFor(job, personal).hidden ||
      (parent && personalFor(parent, personal).hidden)
    )
      continue;
    for (const event of job.talk_events ??
      (job.talk_event ? [job.talk_event] : [])) {
      if (event.status === 'cancelled') continue;
      if (city !== '全部城市' && event.city !== city) continue;
      const end = Date.parse(
        `${event.date}T${event.end_time || '23:59'}:00+08:00`,
      );
      if (!Number.isFinite(end) || end < now) continue;
      const key =
        event.id ||
        [
          event.date,
          event.start_time,
          event.school,
          event.venue,
          job.company,
        ].join('|');
      if (!events.has(key)) events.set(key, { job, event });
    }
  }
  return [...events.values()].sort((a, b) =>
    `${a.event.date}T${a.event.start_time || '23:59'}`.localeCompare(
      `${b.event.date}T${b.event.start_time || '23:59'}`,
    ),
  );
}
