import type { TalkEvent } from './jobs.ts';

const text = (value: string) => value.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
const stamp = (date: number) => new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
function fold(line: string): string {
  let result = '', length = 0;
  for (const point of line) {
    const bytes = new TextEncoder().encode(point).length;
    if (length + bytes > 75) { result += '\r\n '; length = 1; }
    result += point; length += bytes;
  }
  return result;
}
export function exportCalendar(events: { event: TalkEvent; title: string }[], now: number): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Job Radar//Campus Agenda//ZH', 'CALSCALE:GREGORIAN'];
  const unique = new Map<string, { event: TalkEvent; title: string }>();
  for (const entry of events) if (!unique.has(entry.event.id)) unique.set(entry.event.id, entry);
  for (const { event, title } of unique.values()) {
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(event.date) || new Date(`${event.date}T00:00:00Z`).toISOString().slice(0, 10) !== event.date) throw Error('活动日期无效');
    const clock = (value: string) => {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw Error('活动时间无效');
      return Date.parse(`${event.date}T${value}:00+08:00`);
    };
    lines.push('BEGIN:VEVENT', `UID:${text(event.id)}@job-radar.local`, `DTSTAMP:${stamp(now)}`);
    if (event.start_time) {
      const start = clock(event.start_time);
      lines.push(`DTSTART:${stamp(start)}`);
      if (event.end_time) {
        const end = clock(event.end_time);
        if (end <= start) throw Error('结束时间早于或等于开始时间，请核对原公告');
        lines.push(`DTEND:${stamp(end)}`);
      }
    } else lines.push(`DTSTART;VALUE=DATE:${event.date.replaceAll('-', '')}`);
    lines.push(`SUMMARY:${text(title)}`, `LOCATION:${text(`${event.school} · ${event.venue || '地点待核实'}`)}`,
      `DESCRIPTION:${text(`${event.start_time ? '' : '活动时间待确认。'}校外入场规则：${event.access_policy || '原文未说明，请向学校核对'}。官方来源：${event.url}`)}`,
      `STATUS:${event.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT');
  }
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function downloadCalendar(entries: { event: TalkEvent; title: string }[], now: number) {
  const blob = new Blob([exportCalendar(entries, now)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = '职讯雷达-我的日程.ics'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
