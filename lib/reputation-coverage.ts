import type { Job } from './jobs.ts';
import { isExpired } from './jobs.ts';
import { resolveEmployer } from './employers.ts';
import { matchReputation, currentReputationScore } from './reputation.ts';
import type { ReputationIndex } from './reputation.ts';
import policy from '../config/reputation-policy.json' with { type: 'json' };

/** Audit public employers, never personal bookmarks/notes. Counts distinguish
 * source records from actual recent employee evidence and score eligibility. */
export function auditEmployerCoverage(jobs: Job[], index: ReputationIndex, now: number) {
  const employers = new Map<string, { profile: NonNullable<ReturnType<typeof resolveEmployer>>; active_jobs: number }>();
  let unidentified = 0;
  for (const job of jobs) {
    if (job.kind === '宣讲会' || isExpired(job, now)) continue;
    const profile = resolveEmployer(job);
    if (!profile) { unidentified++; continue; }
    const old = employers.get(profile.id);
    employers.set(profile.id, { profile, active_jobs: (old?.active_jobs || 0) + 1 });
  }
  const rows = [...employers.values()].map(({ profile, active_jobs }) => {
    const match = matchReputation(profile, index);
    const items = match?.items || [];
    const fresh = items.filter(item => Date.parse(item.collected_at) <= now + 300000 && Date.parse(item.collected_at) + policy.max_source_age_days * 86400000 > now);
    const recent = fresh.reduce((n, item) => n + item.recent_experience_count, 0);
    const content = items.reduce((n, item) => n + item.experience_count + item.interview_count + item.question_count, 0);
    const score = currentReputationScore(match, now);
    const gap = !match ? 'unmapped_or_ambiguous' : match.reference ? 'reference_only' : !content ? 'no_content' :
      !fresh.length ? 'source_stale' : !recent ? 'no_recent_employee_experience' : score === null ? 'insufficient_score_evidence' : 'scored';
    return { id: profile.id, name: profile.name, scope: profile.scope, active_jobs, gap,
      sources: items.map(item => item.id), recent_employee_experiences: recent, score };
  }).sort((a, b) => b.active_jobs - a.active_jobs || a.id.localeCompare(b.id));
  const gaps: Record<string, number> = {};
  for (const row of rows) gaps[row.gap] = (gaps[row.gap] || 0) + 1;
  return { schema_version: 1, as_of: new Date(now).toISOString(), active_employers: rows.length,
    unidentified_active_jobs: unidentified, gaps, employers: rows };
}
