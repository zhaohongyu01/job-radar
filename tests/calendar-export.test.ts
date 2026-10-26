import test from 'node:test';
import assert from 'node:assert/strict';
import { exportCalendar } from '../lib/calendar-export.ts';

const event = { id: 'stable-event', date: '2026-10-27', start_time: '14:30', end_time: '16:30', school: '南开大学', venue: '津南校区 A104', city: '天津', url: 'https://example.org/event' };
const now = Date.parse('2026-10-25T10:00:00+08:00');
await test('calendar exports stable IDs, China timezone and safe UTF-8 line folding', () => {
  const content = exportCalendar([{ event, title: '中文公司'.repeat(30) + ';测试,备注\nATTENDEE:fake' }, { event, title: 'duplicate' }], now);
  assert.equal(content.split('BEGIN:VEVENT').length - 1, 1);
  assert.ok(content.includes('DTSTART:20261027T063000Z\r\n'));
  assert.ok(content.includes('DTEND:20261027T083000Z\r\n'));
  assert.ok(content.includes('UID:stable-event@job-radar.local'));
  for (const line of content.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
  const unfolded = content.replaceAll('\r\n ', '');
  assert.ok(unfolded.includes('\\;测试\\,备注\\nATTENDEE:fake'));
  assert.ok(!unfolded.includes('\r\nATTENDEE:'));
});
await test('unknown end time is not invented; date-only and cancellation retain meaning', () => {
  const unknownEnd = exportCalendar([{ event: { ...event, end_time: null }, title: '活动' }], now);
  assert.ok(!unknownEnd.includes('DTEND:'));
  const dateOnly = exportCalendar([{ event: { ...event, start_time: null, end_time: null, status: 'cancelled' }, title: '活动' }], now);
  assert.ok(dateOnly.includes('DTSTART;VALUE=DATE:20261027'));
  assert.ok(dateOnly.includes('STATUS:CANCELLED'));
  assert.throws(() => exportCalendar([{ event: { ...event, date: '2026-02-30' }, title: '活动' }], now));
});
