'use client';

import { ArrowUpRight, CalendarDays } from 'lucide-react';
import { externalUrl } from '@/lib/jobs';
import type { Job } from '@/lib/jobs';
import { talkDateLabel, talkEventsForCity } from '@/lib/talk-events';

export function TalkEvents({ job, city, now, limit, onOpen }: {
  job: Job;
  city: string;
  now: number;
  limit?: number;
  onOpen?: () => void;
}) {
  const events = talkEventsForCity(job, city, now);
  if (!events.length) return null;
  const visible = limit ? events.slice(0, limit) : events;
  return <section className="talk-events" aria-label="校园宣讲会">
    <h3><CalendarDays size={15} />校园宣讲会{city !== '全部城市' ? ` · ${city}` : ''}</h3>
    <ul>
      {visible.map((event) => {
        const href = externalUrl(event.url);
        const ended = Date.parse(`${event.date}T${event.end_time || '23:59'}:00+08:00`) < now;
        return <li key={event.id}>
          <span className="talk-event-date">{talkDateLabel(event)}{ended && <small> · 已结束</small>}</span>
          <span className="talk-event-place">{city === '全部城市' && event.city ? `${event.city} · ` : ''}{event.school} · {event.venue}</span>
          {href && <a href={href} target="_blank" rel="noopener noreferrer" onClick={onOpen} aria-label={`查看${event.school}${talkDateLabel(event)}宣讲会原文`}>原文<ArrowUpRight size={13} /></a>}
        </li>;
      })}
    </ul>
    {events.length > visible.length && <p className="talk-events-more">另有 {events.length - visible.length} 场，点击详情查看</p>}
  </section>;
}
