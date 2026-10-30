import { readFileSync, writeFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { buildReputationQueue } from '../lib/reputation-queue.ts';
import sources from '../config/reputation-sources.json' with { type: 'json' };

const [snapshotFile, stateFile, output] = process.argv.slice(2);
if (!snapshotFile || !stateFile || !output) throw Error('Usage: build_reputation_queue.mjs jobs.json state.json queue.json');
const snapshot = JSON.parse(readFileSync(snapshotFile, 'utf8'));
if (!Array.isArray(snapshot.jobs) || snapshot.jobs.some(job => !job || typeof job.company !== 'string' || typeof job.id !== 'string' || !Array.isArray(job.cities)))
  throw Error('Invalid public opportunity snapshot');
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
const queue = buildReputationQueue(snapshot.jobs, [...sources.enterprises, ...Object.values(state.discovered_enterprises || {}).filter(row => Number.isSafeInteger(row.id) && Array.isArray(row.expected_names) && !sources.enterprises.some(seed => seed.id === row.id))], state.enterprises || {}, Date.now(), sources.pinned_names);
writeFileSync(output, JSON.stringify({ ...queue, snapshot_generated_at: snapshot.generated_at || null, input_error: snapshot.input_error || null }));
console.log(JSON.stringify({ input_opportunities: queue.input_opportunities, matched_enterprises: queue.matched_enterprises,
  unmatched_enterprises: queue.unmatched_enterprises, registered: queue.enterprises.length, input_error: snapshot.input_error || null }));
