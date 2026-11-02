import { readFileSync, writeFileSync } from 'node:fs';
import { auditEmployerCoverage } from '../lib/reputation-coverage.ts';
import { validateReputationIndex } from '../lib/reputation.ts';
const [jobsFile, indexFile, output] = process.argv.slice(2);
if (!output) throw Error('Usage: audit_employer_coverage.mjs flat-jobs.json reputation/index.json report.json');
const snapshot = JSON.parse(readFileSync(jobsFile, 'utf8'));
if (!Array.isArray(snapshot.jobs)) throw Error('Expected verified flat public opportunities');
const index = validateReputationIndex(JSON.parse(readFileSync(indexFile, 'utf8')));
const result = { ...auditEmployerCoverage(snapshot.jobs, index, Date.now()),
  input_complete: !snapshot.input_error && snapshot.jobs.length > 0,
  input_error: snapshot.input_error || null, snapshot_generated_at: snapshot.generated_at || null };
writeFileSync(output, JSON.stringify(result));
console.log(JSON.stringify({ active_employers: result.active_employers, gaps: result.gaps, input_complete: result.input_complete }));
