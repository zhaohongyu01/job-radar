import type { Personal, PersonalRecord } from './jobs.ts';

export const APPLICATION_STAGES = { planned: '准备投递', applied: '已投递', test: '笔试 / 测评', interview: '面试中', offer: '已获 Offer', rejected: '未通过', withdrawn: '主动结束' };
export const PERSONAL_DETAIL_FIELDS = ['application_stage', 'applied_at', 'next_action_at', 'next_action_note', 'notes', 'personal_updated_at'] as const;
export function validIso(value: unknown): value is string {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const day = value.slice(0, 10);
  return new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
}
export function validatePersonalDetails(row: Record<string, unknown>): Partial<PersonalRecord> {
  const result: Partial<PersonalRecord> = {};
  if (Object.hasOwn(row, 'application_stage')) {
    if (typeof row.application_stage !== 'string' || !Object.hasOwn(APPLICATION_STAGES, row.application_stage)) throw Error('投递阶段不正确');
    result.application_stage = row.application_stage as keyof typeof APPLICATION_STAGES;
  }
  for (const key of ['applied_at', 'next_action_at', 'personal_updated_at'] as const) {
    if (!Object.hasOwn(row, key)) continue;
    if (row[key] !== null && !validIso(row[key])) throw Error('个人任务时间不正确');
    result[key] = row[key] as string | null;
  }
  for (const key of ['notes', 'next_action_note'] as const) {
    if (!Object.hasOwn(row, key)) continue;
    if (typeof row[key] !== 'string' || row[key].length > (key === 'notes' ? 2000 : 200)) throw Error('备注超出长度或格式不正确');
    result[key] = row[key];
  }
  return result;
}

export function personalConflicts(current: Personal, imported: Personal): string[] {
  return Object.entries(imported).filter(([id, record]) => {
    const old = current[id];
    return old && (!old.personal_updated_at || !record.personal_updated_at) && PERSONAL_DETAIL_FIELDS.some((field) => field !== 'personal_updated_at' && Object.hasOwn(old, field) && Object.hasOwn(record, field) && old[field] !== record[field]);
  }).map(([id]) => id);
}

export function mergePersonalRecords(current: Personal, imported: Personal, preferImportedUntimed = false): Personal {
  const result = { ...current };
  for (const [id, record] of Object.entries(imported)) {
    const old = current[id];
    const merged = { ...old, ...record };
    const olderImport = old && (old.personal_updated_at && record.personal_updated_at
      ? Date.parse(old.personal_updated_at) > Date.parse(record.personal_updated_at) : !preferImportedUntimed);
    if (olderImport) for (const field of PERSONAL_DETAIL_FIELDS) {
      if (Object.hasOwn(old, field)) Object.assign(merged, { [field]: old[field] });
    }
    if (merged.application_stage) merged.applied = merged.application_stage !== 'planned';
    result[id] = merged;
  }
  return result;
}
