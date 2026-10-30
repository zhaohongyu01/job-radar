// Repeatable offline coverage measurement against a real frozen job snapshot.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { gzipSync } from 'node:zlib';
import { resolveEmployer } from '../lib/employers.ts';
import { currentReputationScore, matchReputation, validateReputationEntity, validateReputationIndex } from '../lib/reputation.ts';

const [snapshotFile, indexFile, output] = process.argv.slice(2);
if (!snapshotFile || !indexFile || !output) throw Error('Usage: audit_reputation.mjs snapshot/jobs.json reputation/index.json report.json');
const snapshot = JSON.parse(readFileSync(snapshotFile, 'utf8')), root = dirname(resolve(snapshotFile));
let jobs = snapshot.jobs;
if (snapshot.index_shards) jobs = snapshot.index_shards.flatMap(path => {
  if (!/^\/job-assets\/index-[a-f0-9]{20}\.json$/.test(path)) throw Error('Unexpected job index asset');
  const target = resolve(root, path.slice(1)), rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) throw Error('Snapshot asset escaped its directory');
  return JSON.parse(readFileSync(target, 'utf8')).jobs;
});
const before = createHash('sha256').update(JSON.stringify(jobs)).digest('hex');
const rawIndex = readFileSync(indexFile), index = validateReputationIndex(JSON.parse(rawIndex));
const entities = index.entities.map(item => {
  const raw = readFileSync(resolve(dirname(indexFile), item.file));
  assert.ok(item.file.endsWith(createHash('sha256').update(raw).digest('hex').slice(0, 20) + '.json'));
  return validateReputationEntity(JSON.parse(raw));
});
const matches = jobs.map(job => matchReputation(resolveEmployer(job), index));
const direct = matches.filter(match => match && !match.reference), reference = matches.filter(match => match?.reference);
const report = { snapshot_generated_at: snapshot.generated_at, measured_at: new Date().toISOString(), opportunities: jobs.length,
  source_companies: entities.length, companies_with_content: entities.filter(row => row.records.length).length,
  experiences: index.entities.reduce((sum, row) => sum + row.experience_count, 0), recent_experiences: index.entities.reduce((sum, row) => sum + row.recent_experience_count, 0),
  interviews: index.entities.reduce((sum, row) => sum + row.interview_count, 0), questions: index.entities.reduce((sum, row) => sum + row.question_count, 0),
  directly_matched_jobs: direct.length, reference_only_jobs: reference.length,
  jobs_with_scored_employer: matches.filter(match => currentReputationScore(match, Date.now()) !== null).length,
  index_bytes: rawIndex.byteLength, index_gzip_bytes: gzipSync(rawIndex).byteLength, source_requests: 0,
  job_records_unchanged: before === createHash('sha256').update(JSON.stringify(jobs)).digest('hex'),
  note: 'Historical job snapshot; exact-name/reference matches do not imply sufficient employee reviews or full platform coverage.' };
writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
