import type { Job, Personal } from './jobs.ts';
import { personalFor } from './jobs.ts';
import { deadlineTime } from './opportunity-validity.ts';

export function buildPersonalReminders(jobs: Job[], personal: Personal, now: number) {
  return jobs.flatMap((job) => {
    const record = personalFor(job, personal);
    if (record.hidden) return [];
    const entries: { job: Job; time: number; label: string; isFollowup: boolean }[] = [];
    const next = Date.parse(record.next_action_at || '');
    if (Number.isFinite(next) && next <= now + 86400000)
      entries.push({ job, time: next, label: record.next_action_note || '跟进安排', isFollowup: true });
    const deadline = deadlineTime(job.deadline);
    if (record.saved && !record.applied && deadline >= now && deadline <= now + 3 * 86400000)
      entries.push({ job, time: deadline, label: '报名即将截止', isFollowup: false });
    return entries;
  }).sort((a, b) => a.time - b.time);
}
