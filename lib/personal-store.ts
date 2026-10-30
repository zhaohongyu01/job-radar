import { personalFor, validatePersonal } from './jobs.ts';
import type { Job, Personal, PersonalRecord } from './jobs.ts';
import { PERSONAL_STORAGE } from './personal-backup.ts';

/** Shared with backup imports so two pages cannot interleave read/modify/write. */
export async function withPersonalLock<T>(operation: () => T | Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request)
    return navigator.locks.request('job-radar-personal-v1', { mode: 'exclusive' }, operation);
  return operation();
}

export function readPersonalRecords(storage: Pick<Storage, 'getItem'>): Personal {
  return validatePersonal(JSON.parse(storage.getItem(PERSONAL_STORAGE) || '{}'));
}

/** Read at commit time, never overwrite storage with a stale React snapshot. */
export function commitPersonalRecords(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  update: (latest: Personal) => Personal,
): Personal {
  const next = validatePersonal(update(readPersonalRecords(storage)));
  storage.setItem(PERSONAL_STORAGE, JSON.stringify(next));
  return next;
}

export function patchPersonalRecord(
  latest: Personal, job: Job, patch: PersonalRecord, stamp: string, expected?: PersonalRecord,
): Personal {
  const current = personalFor(job, latest);
  for (const key of Object.keys(patch) as (keyof PersonalRecord)[]) {
    if (key !== 'personal_updated_at' && expected && current[key] !== expected[key])
      throw Error('这条记录刚在其他页面更新，编辑内容已保留，请核对冲突后保存。');
  }
  // personalFor omits a null read marker for display. Keep that explicit clear
  // in storage so an unrelated edit cannot revive a duplicate's old read time.
  return { ...latest, [job.id]: { ...latest[job.id], ...current, ...patch, personal_updated_at: stamp } };
}
