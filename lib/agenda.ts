import type { Job, Personal, TalkEvent } from './jobs.ts';
import {
  effectiveEventCity,
  normalizeCompanyName,
  personalFor,
  sanitizeVenueDisplay,
  shanghaiDay,
} from './jobs.ts';

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

const CN_DIGIT_MAP: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

function chineseNumeralToDigits(raw: string): string {
  if (/^\d+$/.test(raw)) return String(Number(raw));
  if (raw === '十') return '10';
  if (raw.startsWith('十') && raw.length === 2 && CN_DIGIT_MAP[raw[1]]) {
    return String(10 + CN_DIGIT_MAP[raw[1]]);
  }
  if (raw.endsWith('十') && raw.length === 2 && CN_DIGIT_MAP[raw[0]]) {
    return String(CN_DIGIT_MAP[raw[0]] * 10);
  }
  if (raw.length === 3 && raw[1] === '十' && CN_DIGIT_MAP[raw[0]] && CN_DIGIT_MAP[raw[2]]) {
    return String(CN_DIGIT_MAP[raw[0]] * 10 + CN_DIGIT_MAP[raw[2]]);
  }
  if (raw.length === 1 && CN_DIGIT_MAP[raw]) return String(CN_DIGIT_MAP[raw]);
  return raw;
}

export function normalizeVenueForDedup(venue?: string | null, school?: string | null): string {
  const cleaned = sanitizeVenueDisplay(venue, school);
  if (!cleaned) return '';
  let out = cleaned
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .toLowerCase();
  // Unify common Chinese teaching-building abbreviations (e.g., 6号教学楼 / 第六教学楼 / 6教 -> 6教)
  out = out.replace(
    /(?:第)?([一二两三四五六七八九十]{1,3}|\d+)号?(?:教学楼|教楼|教)/g,
    (_, num: string) => `${chineseNumeralToDigits(num)}教`,
  );
  // Preserve hyphenated room numbers (401-1 vs 401-2) while unifying trailing 教室/室/房间/会议室
  out = out.replace(/(\d+(?:-\d+)?)号?(?:教室|室|房间|会议室)/g, '$1室');
  out = out.replace(/(\d+(?:-\d+)?)$/, '$1室');
  // Strip whitespace and decorative punctuation, preserving hyphens between digits
  out = out.replace(/(?<!\d)-|-(?!\d)/g, '');
  out = out.replace(/[\s·•、,，.。()（）【】[\]—_:：]+/g, '');
  return out;
}

function normalizeTalkEntityForDedup(job: Job): string {
  const fromCompany = normalizeCompanyName(job.company);
  if (fromCompany.length >= 2) return fromCompany.toLowerCase();
  const rawTitle = (job.title || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/^[【[（(][^】\]）)]{1,12}[】\]）)]/g, '')
    .replace(
      /(?:20\d{2}年?(?:度)?(?:春季|秋季|校园|校招)?)?(?:专场)?(?:线下|线上|空中)?(?:招聘宣讲会|校园宣讲会|宣讲会|宣讲|招聘会|双选会|面试|笔试|招聘(?:公告|简章)?)$/,
      '',
    );
  const fromTitle = normalizeCompanyName(rawTitle);
  return fromTitle.length >= 2 ? fromTitle.toLowerCase() : '';
}

function agendaSemanticKey(job: Job, event: TalkEvent): string {
  const entity = normalizeTalkEntityForDedup(job);
  const school = (event.school || '').trim();
  const venueKey = normalizeVenueForDedup(event.venue, event.school);
  const startTime = (event.start_time || '').trim();
  if (!entity || !school || !event.date || (!startTime && !venueKey)) {
    return `id:${event.id}`;
  }
  return [
    entity,
    school,
    event.date,
    startTime,
    event.status || 'scheduled',
    event.mode || 'unknown',
    event.event_type || 'unknown',
    venueKey,
  ].join('|');
}

function agendaEntryScore(
  entry: { job: Job; event: TalkEvent; hasParent: boolean; rawJob: Job },
  saved: EventPersonal,
): [number, number, number, number, number, string] {
  const isSaved = saved[entry.event.id]?.saved ? 1 : 0;
  const hasParent = entry.hasParent ? 1 : 0;
  const isVerifiedDetail = entry.rawJob.listing_facts?.detail_pending
    ? 0
    : entry.rawJob.details_available !== false
      ? 1
      : 0;
  const richness =
    (entry.event.registration_url ? 1 : 0) +
    (entry.event.access_policy ? 1 : 0) +
    (entry.event.end_time ? 1 : 0);
  const venueLen = sanitizeVenueDisplay(entry.event.venue, entry.event.school).length;
  const freshness =
    entry.rawJob.last_verified_at || entry.rawJob.updated_at || entry.rawJob.first_seen_at || '';
  return [isSaved, hasParent, isVerifiedDetail, richness, venueLen, freshness];
}

function isBetterAgendaEntry(
  candidate: { job: Job; event: TalkEvent; hasParent: boolean; rawJob: Job },
  current: { job: Job; event: TalkEvent; hasParent: boolean; rawJob: Job },
  saved: EventPersonal,
): boolean {
  const a = agendaEntryScore(candidate, saved);
  const b = agendaEntryScore(current, saved);
  for (let i = 0; i < 5; i += 1) {
    if (a[i] !== b[i]) return (a[i] as number) > (b[i] as number);
  }
  return a[5] > b[5];
}

export function agendaEntries(jobs: Job[], personal: Personal, filters: AgendaFilters, now: number, saved: EventPersonal = {}, onlySaved = false) {
  const entries = new Map<string, { job: Job; event: TalkEvent; hasParent: boolean; rawJob: Job }>();
  const seenEventIds = new Set<string>();
  const parents = new Map(jobs.map((job) => [job.id, job]));
  for (const job of [...jobs].sort((a, b) => Number(!!a.talk_attached_to) - Number(!!b.talk_attached_to))) {
    const parent = job.talk_attached_to ? parents.get(job.talk_attached_to) : undefined;
    if (!onlySaved && (personalFor(job, personal).hidden || (parent && personalFor(parent, personal).hidden))) continue;
    for (const event of job.talk_events ?? (job.talk_event ? [job.talk_event] : [])) {
      if (onlySaved && !saved[event.id]?.saved) continue;
      if (!onlySaved && (event.status === 'cancelled' || Date.parse(`${event.date}T${event.end_time || '23:59'}:00+08:00`) < now)) continue;
      const eventCity = effectiveEventCity(event);
      if (filters.city !== '全部城市' && eventCity !== filters.city && !(filters.includeOnline && event.mode === 'online')) continue;
      if (filters.school && event.school !== filters.school) continue;
      if (filters.mode !== 'all' && (event.mode || 'unknown') !== filters.mode) continue;
      if (filters.eventType !== 'all' && (event.event_type || 'unknown') !== filters.eventType) continue;
      const today = shanghaiDay(now);
      const from = filters.range === 'today' || filters.range === 'week' ? today : filters.range === 'custom' ? filters.dateFrom : '';
      const to = filters.range === 'today' ? today : filters.range === 'week' ? shanghaiDay(now + 6 * 86400000) : filters.range === 'custom' ? filters.dateTo : '';
      if ((from && event.date < from) || (to && event.date > to)) continue;
      if (seenEventIds.has(event.id)) continue;
      seenEventIds.add(event.id);
      const normalizedEvent = eventCity && !event.city ? { ...event, city: eventCity } : event;
      const candidate = {
        job: parent || job,
        event: normalizedEvent,
        hasParent: Boolean(parent),
        rawJob: job,
      };
      const dedupKey = onlySaved ? `id:${event.id}` : agendaSemanticKey(candidate.job, normalizedEvent);
      const existing = entries.get(dedupKey);
      if (!existing || isBetterAgendaEntry(candidate, existing, saved)) {
        entries.set(dedupKey, candidate);
      }
    }
  }
  return [...entries.values()]
    .map(({ job, event }) => ({ job, event }))
    .sort((a, b) => `${a.event.date}T${a.event.start_time || '23:59'}`.localeCompare(`${b.event.date}T${b.event.start_time || '23:59'}`));
}

export function eventChanged(event: TalkEvent, record: EventPersonal[string] | undefined): boolean {
  const old = record?.observed;
  return Boolean(old && (old.date !== event.date || (old.start_time || null) !== (event.start_time || null) || old.venue !== event.venue || (old.status || 'scheduled') !== (event.status || 'scheduled')));
}
