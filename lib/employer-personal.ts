import { employerFromId } from './employers.ts';
import { validIso } from './personal-records.ts';

export const EMPLOYER_PERSONAL_STORAGE = 'job-radar-employer-personal-v1';
export type EmployerRecord = { rating: number | null; notes: string; updated_at: string };
export type EmployerRecords = Record<string, EmployerRecord>;
export type EmployerPatch = Partial<Pick<EmployerRecord, 'rating' | 'notes'>>;

export function validateEmployerRecords(input: unknown): EmployerRecords {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('企业个人记录格式不正确');
  const entries = Object.entries(input);
  if (entries.length > 10000) throw Error('企业个人记录不能超过10,000条');
  const result: EmployerRecords = {};
  for (const [id, value] of entries) {
    employerFromId(id);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('企业个人记录格式不正确');
    const row = value as Record<string, unknown>;
    if (Object.keys(row).some(key => !['rating', 'notes', 'updated_at'].includes(key)) ||
        !(row.rating === null || (typeof row.rating === 'number' && Number.isInteger(row.rating) && row.rating >= 1 && row.rating <= 5)) ||
        typeof row.notes !== 'string' || row.notes.length > 2000 || !validIso(row.updated_at))
      throw Error('企业意向评分、备注或时间不正确');
    result[id] = { rating: row.rating, notes: row.notes, updated_at: row.updated_at } as EmployerRecord;
  }
  return result;
}

export function readEmployerRecords(storage: Pick<Storage, 'getItem'>) {
  return validateEmployerRecords(JSON.parse(storage.getItem(EMPLOYER_PERSONAL_STORAGE) || '{}'));
}

/** Caller holds the same Web Lock as job-personal updates and backup import. */
export function commitEmployerPatch(storage: Pick<Storage, 'getItem' | 'setItem'>, id: string,
  patch: EmployerPatch, stamp: string, expected?: EmployerRecord, overwrite = false): EmployerRecords {
  employerFromId(id);
  const latest = readEmployerRecords(storage), current = latest[id];
  for (const key of Object.keys(patch) as (keyof EmployerPatch)[]) {
    const fallback = key === 'rating' ? null : '';
    if (!overwrite && (current?.[key] ?? fallback) !== (expected?.[key] ?? fallback))
      throw Error('其他页面刚更新了这项评分或备注，草稿已保留，请核对后重试。');
  }
  const next = validateEmployerRecords({ ...latest, [id]: {
    rating: current?.rating ?? null, notes: current?.notes || '', ...patch, updated_at: stamp,
  } });
  storage.setItem(EMPLOYER_PERSONAL_STORAGE, JSON.stringify(next));
  return next;
}

export function employerRecordConflicts(current: EmployerRecords, imported: EmployerRecords): string[] {
  return Object.keys(imported).filter(id => current[id] &&
    Date.parse(current[id].updated_at) === Date.parse(imported[id].updated_at) &&
    (current[id].rating !== imported[id].rating || current[id].notes !== imported[id].notes));
}

export function mergeEmployerRecords(current: EmployerRecords, imported: EmployerRecords, preferImported = false): EmployerRecords {
  const result = { ...current };
  for (const [id, record] of Object.entries(imported)) {
    const old = result[id];
    const delta = old ? Date.parse(record.updated_at) - Date.parse(old.updated_at) : 1;
    if (!old || delta > 0 || (delta === 0 && preferImported)) result[id] = record;
  }
  return result;
}
