import type { Job } from './jobs.ts';
import policy from '../config/opportunity-policy.json' with { type: 'json' };

export type ValidityStatus = 'closed' | 'confirmed_open' | 'long_term' | 'unconfirmed';
export function deadlineTime(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const day = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== value) return Number.NaN;
    return Date.parse(`${value}T23:59:59.999+08:00`);
  }
  return Date.parse(value);
}
export function assessOpportunityValidity(job: Job, now: number) {
  const checkedAt = job.availability_evidence?.checked_at || job.last_verified_at || null;
  const age = checkedAt ? now - Date.parse(checkedAt) : Number.POSITIVE_INFINITY;
  const deadline = deadlineTime(job.deadline);
  if (job.listing_status === 'withdrawn' || (Number.isFinite(deadline) && deadline < now)) {
    return { status: 'closed' as ValidityStatus, label: '已截止 / 撤回', reason: '来源明确撤回或报名截止已过', checkedAt };
  }
  const evidence = job.availability_evidence;
  if (evidence?.verified && evidence.kind === 'long_term') return { status: 'long_term' as ValidityStatus, label: '原文长期招聘', reason: '具体岗位仍请核对原公告', checkedAt };
  if (evidence?.verified && evidence.kind === 'open' && age >= 0 && age <= policy.recent_evidence_days * 86400000) return { status: 'confirmed_open' as ValidityStatus, label: '近期核验在招', reason: evidence.text, checkedAt };
  return { status: 'unconfirmed' as ValidityStatus, label: age > policy.stale_evidence_days * 86400000 ? '较久未核验' : '有效性待核实', reason: '缺少近期仍开放的明确证据；无截止日不代表已关闭', checkedAt };
}
