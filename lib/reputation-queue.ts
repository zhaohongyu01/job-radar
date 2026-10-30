import { resolveEmployer } from './employers.ts';
import { isExpired } from './jobs.ts';
import type { Job } from './jobs.ts';

type Seed = { id: number; expected_names: string[] };
type Past = { last_attempt_at?: string; retry_after?: number; channels?: Record<string, { names: string[] }> };
const canonical = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ');
/** Queue priority uses public opportunities only, never a user's local records. */
export function buildReputationQueue(jobs: Job[], seeds: Seed[], state: Record<string, Past>, now: number, pinned: Record<string, string[]> = {}) {
  const byName = new Map<string, Set<number>>();
  for (const seed of seeds) {
    const names = [...seed.expected_names, ...Object.values(state[String(seed.id)]?.channels || {}).flatMap(page => page.names)];
    for (const name of names.concat(names.flatMap(name => pinned[name] || []))) {
      const key = canonical(name), ids = byName.get(key) || new Set<number>(); ids.add(seed.id); byName.set(key, ids);
    }
  }
  const counts = new Map<number, number>(), unresolved = new Map<string, { name: string; jobs: number; scope: string }>();
  for (const job of jobs) {
    if (isExpired(job, now)) continue;
    const profile = resolveEmployer(job);
    if (!profile) continue;
    const candidates = byName.get(canonical(profile.name)) || (profile.brand ? byName.get(canonical(profile.brand)) : undefined);
    if (candidates?.size === 1) {
      const id = [...candidates][0]; counts.set(id, (counts.get(id) || 0) + 1);
    } else {
      const old = unresolved.get(profile.id); unresolved.set(profile.id, { name: profile.name, jobs: (old?.jobs || 0) + 1, scope: profile.scope });
    }
  }
  const enterprises = seeds.map(seed => {
    const prior = state[String(seed.id)];
    const last = prior?.last_attempt_at ? Date.parse(prior.last_attempt_at) : Number.NaN;
    const active = counts.get(seed.id) || 0;
    const age = Number.isFinite(last) ? Math.max(0, (now - last) / 86400000) : active ? 7 : 0;
    return { id: seed.id, expected_names: seed.expected_names, active_jobs: active,
      priority: Math.round((Math.min(14, age) * 8 + Math.min(32, Math.log2(1 + active) * 4)) * 100) / 100,
      last_attempt_at: prior?.last_attempt_at || null, cooling: (prior?.retry_after || 0) * 1000 > now };
  }).sort((a, b) => b.priority - a.priority || a.id - b.id);
  return { schema_version: 1, generated_at: new Date(now).toISOString(), input_opportunities: jobs.length,
    matched_enterprises: counts.size, unmatched_enterprises: unresolved.size, enterprises,
    needs_mapping: [...unresolved.values()].sort((a, b) => b.jobs - a.jobs || a.name.localeCompare(b.name)).slice(0, 200) };
}
