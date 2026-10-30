import { validatePersonal } from './jobs.ts';
import type { Personal } from './jobs.ts';
import { restoreBrowsing } from './browsing.ts';
import { restoreAgenda, validateEventPersonal, AGENDA_STORAGE, EVENT_PERSONAL_STORAGE } from './agenda.ts';
import type { AgendaFilters, EventPersonal } from './agenda.ts';
import { RADAR_PRESETS_STORAGE, RADAR_ACTIVE_PRESET_STORAGE } from './radar.ts';
import type { RadarPreset } from './radar.ts';
import { EMPLOYER_PERSONAL_STORAGE, validateEmployerRecords } from './employer-personal.ts';
import type { EmployerRecords } from './employer-personal.ts';

export const PERSONAL_STORAGE = 'quancheng-personal-v1';
export const BROWSING_STORAGE = 'job-radar-browsing-v1';
export type PersonalBackup = { version: 4; records: Personal; agenda?: AgendaFilters; event_records?: EventPersonal; employer_records?: EmployerRecords;
  browsing?: ReturnType<typeof restoreBrowsing>; radar_presets?: RadarPreset[]; active_preset?: string | null; reminders_enabled?: boolean };

export function validateBackup(input: unknown): PersonalBackup {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('备份格式不正确');
  const value = input as Record<string, unknown>;
  if (![1, 2, 3, 4].includes(value.version as number)) throw Error('不支持此备份版本');
  if (value.version !== 4 && value.employer_records !== undefined) throw Error('包含企业个人记录的备份必须使用v4格式');
  const result: PersonalBackup = { version: 4, records: validatePersonal(value.records) };
  if (value.version === 4 && value.employer_records !== undefined) result.employer_records = validateEmployerRecords(value.employer_records);
  if (value.version === 3 || value.version === 4) {
    if (value.reminders_enabled !== undefined) {
      if (typeof value.reminders_enabled !== 'boolean') throw Error('提醒设置不正确');
      result.reminders_enabled = value.reminders_enabled;
    }
    if (value.agenda) result.agenda = restoreAgenda(value.agenda, '全部城市');
    if (value.event_records) result.event_records = validateEventPersonal(value.event_records);
    if (value.browsing) result.browsing = restoreBrowsing(value.browsing);
    if (value.radar_presets !== undefined) {
      if (!Array.isArray(value.radar_presets) || value.radar_presets.length > 100) throw Error('筛选方案格式不正确');
      result.radar_presets = value.radar_presets.map((raw: unknown) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('筛选方案不正确');
        const row = raw as Record<string, unknown>;
        if (typeof row.id !== 'string' || row.id.length > 100 || typeof row.name !== 'string' || row.name.length > 100 || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) throw Error('筛选方案不正确');
        return { id: row.id, name: row.name, createdAt: row.createdAt, filters: restoreBrowsing({ filters: row.filters }).filters };
      });
      if (typeof value.active_preset === 'string' && result.radar_presets.some((preset) => preset.id === value.active_preset)) result.active_preset = value.active_preset;
    }
  }
  if (Object.keys(result.records).length + Object.keys(result.event_records || {}).length + Object.keys(result.employer_records || {}).length > 20000) throw Error('备份合计不能超过 20,000 条记录');
  return result;
}

export function createBackup(records: Personal, storage: Pick<Storage, 'getItem'>): PersonalBackup {
  const parse = (key: string) => { const raw = storage.getItem(key); return raw ? JSON.parse(raw) : undefined; };
  return validateBackup({ version: 4, records, agenda: parse(AGENDA_STORAGE), event_records: parse(EVENT_PERSONAL_STORAGE), employer_records: parse(EMPLOYER_PERSONAL_STORAGE),
    browsing: parse(BROWSING_STORAGE), radar_presets: parse(RADAR_PRESETS_STORAGE), active_preset: storage.getItem(RADAR_ACTIVE_PRESET_STORAGE), reminders_enabled: parse('job-radar-reminders-v1') });
}

/** Stage all values first; restore every old key if any browser write fails. */
export function writeBackup(backup: PersonalBackup, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
  const writes: [string, string][] = [[PERSONAL_STORAGE, JSON.stringify(backup.records)]];
  if (backup.agenda) writes.push([AGENDA_STORAGE, JSON.stringify(backup.agenda)]);
  if (backup.event_records) writes.push([EVENT_PERSONAL_STORAGE, JSON.stringify(backup.event_records)]);
  if (backup.employer_records) writes.push([EMPLOYER_PERSONAL_STORAGE, JSON.stringify(backup.employer_records)]);
  if (backup.browsing) writes.push([BROWSING_STORAGE, JSON.stringify(backup.browsing)]);
  if (backup.radar_presets) writes.push([RADAR_PRESETS_STORAGE, JSON.stringify(backup.radar_presets)]);
  if (backup.active_preset !== undefined) writes.push([RADAR_ACTIVE_PRESET_STORAGE, backup.active_preset || '']);
  if (backup.reminders_enabled !== undefined) writes.push(['job-radar-reminders-v1', String(backup.reminders_enabled)]);
  const before = writes.map(([key]) => [key, storage.getItem(key)] as const);
  try { for (const [key, value] of writes) storage.setItem(key, value); }
  catch (error) {
    let restored = true;
    for (const [key, value] of before) {
      try { if (value === null) storage.removeItem(key); else storage.setItem(key, value); }
      catch { restored = false; }
    }
    if (!restored) throw Error('浏览器存储写入及恢复失败，请保留备份文件后重新导入。');
    throw error;
  }
}
