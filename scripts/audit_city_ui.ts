import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { defaultFilters, filterJobs, mergeDuplicateOpportunities } from '../lib/jobs.ts';
import type { Snapshot } from '../lib/jobs.ts';
import { upcomingTalks } from '../lib/workspace.ts';

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const directory = args.get('--public-dir');
const output = args.get('--output');
const now = Date.parse(args.get('--as-of') || '');
if (!directory || !output || !Number.isFinite(now)) throw Error('Expected --public-dir, --as-of and --output');
const root = resolve(directory);
const raw = await readFile(resolve(root, 'jobs.json'));
const manifest = JSON.parse(await readFile(resolve(root, 'snapshot-manifest.json'), 'utf8'));
if (createHash('sha256').update(raw).digest('hex') !== manifest.index_sha256) throw Error('Manifest mismatch');
const snapshot: Snapshot = JSON.parse(raw.toString('utf8'));
if (snapshot.index_shards?.length) {
  snapshot.jobs = [];
  for (const path of snapshot.index_shards) {
    const match = /^\/job-assets\/index-([0-9a-f]{20})\.json$/.exec(path);
    if (!match) throw Error('Invalid index path');
    const bytes = await readFile(resolve(root, path.slice(1)));
    if (createHash('sha256').update(bytes).digest('hex').slice(0, 20) !== match[1]) throw Error('Index hash mismatch');
    snapshot.jobs.push(...JSON.parse(bytes.toString('utf8')).jobs);
  }
  if (snapshot.jobs.length !== snapshot.index_count) throw Error('Incomplete index');
}
const jobs = mergeDuplicateOpportunities(snapshot.jobs);
const cities = snapshot.cities.map((city) => {
  const visible = filterJobs(jobs, { ...defaultFilters, type: '全部', year: '全部', city }, {}, null, now);
  return { city, list_cards: visible.length, concrete_positions: visible.filter((j) => j.kind === '具体岗位').length,
    upcoming_events: upcomingTalks(jobs, {}, city, now).length };
});
await mkdir(dirname(resolve(output)), { recursive: true });
await writeFile(output, JSON.stringify({ as_of: new Date(now).toISOString(), generated_at: snapshot.generated_at, cities }, null, 2));
console.log(`Verified ${snapshot.jobs.length} index entries and ${cities.length} cities`);
