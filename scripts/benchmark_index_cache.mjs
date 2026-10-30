// Offline parse/cache benchmark against a frozen real snapshot. No source or
// production writes; a warm result must be the exact validated jobs array.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { loadIndexSnapshot } from '../lib/snapshot-loader.ts';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: benchmark_index_cache.mjs public/jobs.json report.json');
const root = dirname(resolve(input)), snapshot = JSON.parse(readFileSync(input, 'utf8'));
const previous = globalThis.fetch, cache = { current: null };
let calls = 0;
try {
  globalThis.fetch = async path => { calls++; if (!/^\/job-assets\/index-[a-f0-9]{20}\.json$/.test(path)) throw Error('Unexpected immutable index path');
    return new Response(readFileSync(resolve(root, path.slice(1)))); };
  const begin = performance.now(), jobs = await loadIndexSnapshot(snapshot, undefined, undefined, cache);
  const firstMs = performance.now() - begin, firstCalls = calls;
  const warmMs = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now(), warm = await loadIndexSnapshot(snapshot, undefined, undefined, cache);
    warmMs.push(performance.now() - start); assert.equal(warm, jobs);
  }
  assert.equal(calls, firstCalls);
  const report = { snapshot_generated_at: snapshot.generated_at, records: jobs.length, first_parse_ms: firstMs,
    first_asset_reads: firstCalls, warm_ms: warmMs, warm_asset_reads: calls - firstCalls,
    shared_validated_array: true, source_requests: 0, note: 'Offline Node filesystem/JSON benchmark, not browser network first-screen time.' };
  writeFileSync(output, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { globalThis.fetch = previous; }
