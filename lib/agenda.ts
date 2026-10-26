import type { Job, Personal, TalkEvent } from './jobs.ts';
import { personalFor, shanghaiDay } from './jobs.ts';

export const AGENDA_STORAGE = 'job-radar-agenda-v1';
export const EVENT_PERSONAL_STORAGE = 'job-radar-event-personal-v1';
export const EVENT_TYPES = { all: '全部活动', talk: '宣讲会', interview: '面试', test: '笔试 / 测评', job_fair: '招聘会', guidance: '就业指导', other: '其他活动', unknown: '类型待核实' };
export type AgendaFilters = { city: string; school: string; range: 'all' | 'today' | 'week' | 'custom'; dateFrom: string; dateTo: string;
  mode: 'all' | 'offline' | 'online' | 'hybrid' | 'unknown'; eventType: keyof typeof EVENT_TYPES; includeOnline: boolean };
export type EventPersonal = Record<string, { saved: boolean; observed?: { date: string; start_time?: string | null; venue: string; status?: string }; updated_at?: string }>;

export function defaultAgenda(city: string): AgendaFilters {
  return { city, school: '', range: 'all', dateFrom: '', dateTo: '', mode: 'all', eventType: 'all', includeOnline: false };
}
export function restoreAgenda(input: unknown, city: string): AgendaFilters {
  const result = defaultAgenda(city);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result;
  const value = input as Record<string, unknown>;
  for (const key of ['city', 'school'] as const) if (typeof value[key] === 'string' && value[key].length <= 80) result[key] = value[key];
  for (const key of ['dateFrom', 'dateTo'] as const) if (typeof value[key] === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value[key]) && Number.isFinite(Date.parse(value[key]))) result[key] = value[key];
  if (['all', 'today', 'week', 'custom'].includes(String(value.range))) result.range = value.range as AgendaFilters['range'];
  if (['all', 'offline', 'online', 'hybrid', 'unknown'].includes(String(value.mode))) result.mode = value.mode as AgendaFilters['mode'];
  if (typeof value.eventType === 'string' && Object.hasOwn(EVENT_TYPES, value.eventType)) result.eventType = value.eventType as AgendaFilters['eventType'];
  result.includeOnline = value.includeOnline === true;
  return result;
}
export function validateEventPersonal(input: unknown): EventPersonal {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length > 20000) throw Error('活动备份格式不正确');
  const output: EventPersonal = {};
  for (const [id, value] of Object.entries(input)) {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id) || !value || typeof value !== 'object' || Array.isArray(value)) throw Error('活动记录不正确');
    const row = value as Record<string, unknown>;
    if (typeof row.saved !== 'boolean') throw Error('活动收藏状态不正确');
    const record: EventPersonal[string] = { saved: row.saved };
    if (typeof row.updated_at === 'string' && Number.isFinite(Date.parse(row.updated_at))) record.updated_at = row.updated_at;
    if (row.observed && typeof row.observed === 'object' && !Array.isArray(row.observed)) {
      const observed = row.observed as Record<string, unknown>;
      if (typeof observed.date !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(observed.date) || typeof observed.venue !== 'string' || observed.venue.length > 500) throw Error('活动日期/地点不正确');
      record.observed = { date: observed.date, venue: observed.venue };
      if (typeof observed.start_time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(observed.start_time)) record.observed.start_time = observed.start_time;
      if (typeof observed.status === 'string' && ['scheduled', 'cancelled'].includes(observed.status)) record.observed.status = observed.status;
    }
    output[id] = record;
  }
  return output;
}

export function agendaEntries(jobs: Job[], personal: Personal, filters: AgendaFilters, now: number, saved: EventPersonal = {}, onlySaved = false) {
  const entries = new Map<string, { job: Job; event: TalkEvent }>();
  const parents = new Map(jobs.map((job) => [job.id, job]));
  for (const job of [...jobs].sort((a, b) => Number(!!a.talk_attached_to) - Number(!!b.talk_attached_to))) {
    const parent = job.talk_attached_to ? parents.get(job.talk_attached_to) : undefined;
    if (!onlySaved && (personalFor(job, personal).hidden || (parent && personalFor(parent, personal).hidden))) continue;
    for (const event of job.talk_events ?? (job.talk_event ? [job.talk_event] : [])) {
      if (onlySaved && !saved[event.id]?.saved) continue;
      if (!onlySaved && (event.status === 'cancelled' || Date.parse(`${event.date}T${event.end_time || '23:59'}:00+08:00`) < now)) continue;
      if (filters.city !== '全部城市' && event.city !== filters.city && !(filters.includeOnline && event.mode === 'online')) continue;
      if (filters.school && event.school !== filters.school) continue;
      if (filters.mode !== 'all' && (event.mode || 'unknown') !== filters.mode) continue;
      if (filters.eventType !== 'all' && (event.event_type || 'unknown') !== filters.eventType) continue;
      const today = shanghaiDay(now);
      const from = filters.range === 'today' || filters.range === 'week' ? today : filters.range === 'custom' ? filters.dateFrom : '';
      const to = filters.range === 'today' ? today : filters.range === 'week' ? shanghaiDay(now + 6 * 86400000) : filters.range === 'custom' ? filters.dateTo : '';
      if ((from && event.date < from) || (to && event.date > to)) continue;
      if (!entries.has(event.id)) entries.set(event.id, { job: parent || job, event });
    }
  }
  return [...entries.values()].sort((a, b) => `${a.event.date}T${a.event.start_time || '23:59'}`.localeCompare(`${b.event.date}T${b.event.start_time || '23:59'}`));
}

export function eventChanged(event: TalkEvent, record: EventPersonal[string] | undefined): boolean {
  const old = record?.observed;
  return Boolean(old && (old.date !== event.date || (old.start_time || null) !== (event.start_time || null) || old.venue !== event.venue || (old.status || 'scheduled') !== (event.status || 'scheduled')));
}
