// Offline identity pilot: no source requests, no changes to jobs or reviews.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { performance } from 'node:perf_hooks';
import { resolveEmployer, employerFromId, employerLabel, employerResearchLinks } from '../lib/employers.ts';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: node --experimental-strip-types scripts/audit_employers.mjs snapshot/jobs.json report.json');
const root = dirname(resolve(input)), snapshot = JSON.parse(readFileSync(input, 'utf8'));
let jobs = snapshot.jobs || [];
if (snapshot.index_shards) jobs = snapshot.index_shards.flatMap(path => {
  if (!/^\/job-assets\/index-[0-9a-f]{20}\.json$/.test(path)) throw Error('Unexpected index asset');
  const target = resolve(root, path.slice(1)), rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) throw Error('Asset escaped snapshot');
  return JSON.parse(readFileSync(target, 'utf8')).jobs;
});
assert.ok(jobs.length >= 50, 'Pilot requires at least 50 real opportunities');
const original = JSON.stringify(jobs);
const start = performance.now();
const profiles = jobs.map(job => resolveEmployer(job));
const elapsed = performance.now() - start;
assert.equal(JSON.stringify(jobs), original, 'Job IDs, aliases, times and records remain untouched');
const unique = new Map(profiles.filter(Boolean).map(profile => [profile.id, profile]));
const selected = [...unique.values()].filter(profile => profile.scope === 'name').slice(0, 50);
assert.equal(selected.length, 50, '50 complete employer names required');
for (const profile of selected) {
  assert.equal(employerFromId(profile.id).id, profile.id);
  assert.equal(employerResearchLinks(profile.name).length, 3);
}
const report = { snapshot_generated_at: snapshot.generated_at, opportunities: jobs.length,
  resolved: profiles.filter(Boolean).length, unique_profiles: unique.size, offline_identity_ms: elapsed,
  additional_source_requests: 0, job_records_unchanged: true,
  note: 'Historical real names test identity and source entrances, not review availability or legal registration.',
  pilot: selected.map(profile => ({ id: profile.id, name: employerLabel(profile), scope: profile.scope,
    source_example: jobs.find(job => resolveEmployer(job)?.id === profile.id)?.source_url })) };
writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, pilot: `${selected.length} names (see output)` }, null, 2));
