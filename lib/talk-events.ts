import type { Job, TalkEvent } from './jobs.ts';
import { normalizeVenueForDedup } from './agenda.ts';

/** A single city, '全部城市', or the selected work-city list (empty = all). */
export type TalkCityScope = string | readonly string[];

export function talkCities(scope: TalkCityScope): string[] {
  if (Array.isArray(scope)) return [...scope];
  return scope === '全部城市' ? [] : [scope as string];
}

export function talkEventsForCity(job: Job, city: TalkCityScope, now = Date.now()): TalkEvent[] {
  const events = job.talk_events ?? (job.talk_event ? [job.talk_event] : []);
  const cities = talkCities(city);
  const matching = cities.length ? events.filter((event) => cities.includes(event.city || '')) : events;
  const deduped = new Map<string, TalkEvent>();
  for (const event of matching) {
    const venueKey = normalizeVenueForDedup(event.venue, event.school);
    const key =
      event.school && event.date && (event.start_time || venueKey)
        ? [
            event.school.trim(),
            event.date,
            event.start_time || '',
            event.status || 'scheduled',
            event.mode || 'unknown',
            event.event_type || 'unknown',
            venueKey,
          ].join('|')
        : `id:${event.id}`;
    const existing = deduped.get(key);
    if (!existing || (event.venue || '').length > (existing.venue || '').length) {
      deduped.set(key, event);
    }
  }
  return [...deduped.values()].sort((a, b) => {
    const aEnd = Date.parse(`${a.date}T${a.end_time || '23:59'}:00+08:00`);
    const bEnd = Date.parse(`${b.date}T${b.end_time || '23:59'}:00+08:00`);
    const aPast = aEnd < now;
    const bPast = bEnd < now;
    if (aPast !== bPast) return aPast ? 1 : -1;
    return aPast ? bEnd - aEnd : aEnd - bEnd;
  });
}

export function talkDateLabel(event: TalkEvent): string {
  const [year, month, day] = event.date.split('-');
  const date = `${year}年${Number(month)}月${Number(day)}日`;
  const time = event.start_time
    ? ` ${event.start_time}${event.end_time ? `–${event.end_time}` : ''}`
    : '';
  return `${date}${time}`;
}
