import type { Job, TalkEvent } from '@/lib/jobs';

export function talkEventsForCity(job: Job, city: string, now = Date.now()): TalkEvent[] {
  const events = job.talk_events ?? (job.talk_event ? [job.talk_event] : []);
  const matching = city === '全部城市' ? events : events.filter((event) => event.city === city);
  return matching.slice().sort((a, b) => {
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
