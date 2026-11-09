import { isPendingApplication, personalFor } from './jobs.ts';
import type { Job, Personal } from './jobs.ts';

export type PersonalCounts = {
  pending: number;
  savedAll: number;
  hidden: number;
  tracking: number;
  appliedTotal: number;
  dueSoon: number;
};

const TRACKING_STAGES = new Set(['applied', 'test', 'interview', 'offer']);

export function computePersonalCounts(
  jobs: Job[],
  personal: Personal,
  now: number,
): PersonalCounts {
  let pending = 0;
  let savedAll = 0;
  let hidden = 0;
  let tracking = 0;
  let appliedTotal = 0;
  let dueSoon = 0;

  for (const job of jobs) {
    const record = personalFor(job, personal);
    if (record.hidden) {
      hidden++;
    }
    if (record.saved) {
      savedAll++;
    }
    if (record.applied) {
      appliedTotal++;
    }
    if (isPendingApplication(job, record, now)) {
      pending++;
      if (job.deadline && Date.parse(job.deadline) - now < 7 * 86400000) {
        dueSoon++;
      }
    }
    const stage = record.application_stage || (record.applied ? 'applied' : undefined);
    if (!record.hidden && stage && TRACKING_STAGES.has(stage)) {
      tracking++;
    }
  }

  return { pending, savedAll, hidden, tracking, appliedTotal, dueSoon };
}
