import type { Job, Personal } from './jobs.ts';
import { personalFor } from './jobs.ts';
import { deadlineTime } from './opportunity-validity.ts';
import type { ExamAnnouncement, ExamPersonalStore } from './exams.ts';
import { isTerminalTrackStatus } from './exams.ts';

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

export interface ExamReminderEntry {
  exam: ExamAnnouncement;
  time: number;
  label: string;
  isFollowup: boolean;
}

export function buildExamPersonalReminders(
  exams: ExamAnnouncement[],
  examPersonal: ExamPersonalStore,
  now: number,
): ExamReminderEntry[] {
  if (!now || exams.length === 0) return [];
  const out: ExamReminderEntry[] = [];
  for (const exam of exams) {
    const rec = examPersonal[exam.id];
    if (!rec || rec.hidden || isTerminalTrackStatus(rec.status)) continue;
    const isTrackedOrSaved = Boolean(rec.saved || (rec.status && rec.status !== 'none'));
    if (!isTrackedOrSaved) continue;

    const s = exam.schedule || {};
    const checks: [string | null | undefined, string, number, boolean][] = [
      [s.reg_end, '考编报名截止', 5 * 86400000, false],
      [s.payment_end, '考编缴费截止', 5 * 86400000, true],
      [s.admit_card_start, '准考证打印', 5 * 86400000, true],
      [s.written_exam_date, '考编笔试', 7 * 86400000, true],
      [rec.interviewDate || s.interview_date, '考编面试', 7 * 86400000, true],
    ];

    for (const [dateStr, label, windowMs, isFollowup] of checks) {
      if (!dateStr) continue;
      const t = deadlineTime(dateStr.slice(0, 10));
      if (Number.isFinite(t) && t >= now && t <= now + windowMs) {
        out.push({ exam, time: t, label, isFollowup });
      }
    }
  }
  return out.sort((a, b) => a.time - b.time);
}
