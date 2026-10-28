// No npm packages or network requests: uses the exact frontend domain logic.
import { readFileSync, writeFileSync, renameSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { projectBrowsingJobs, validateBrowsingJob } from '../lib/browse-index.ts';

const hash = (buffer) => createHash('sha256').update(buffer).digest('hex');
const limit = 25 * 1024 * 1024;
const assetPattern = /^\/job-assets\/(?:index|search)-([a-f0-9]{20})\.json$/;
const within = (root, path) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../'); };

export function splitRows(rows, firstBudget = 4 * 1024 * 1024) {
  const batches = []; let batch = [], size = 32, budget = firstBudget;
  for (const row of rows) {
    const length = Buffer.byteLength(JSON.stringify(row)) + 1;
    if (batch.length && size + length > budget) { batches.push(batch); batch = []; size = 32; budget = 4 * 1024 * 1024; }
    batch.push(row); size += length;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export function buildBrowseIndex(directory) {
  const started = performance.now(), root = realpathSync(directory);
  const read = (name) => {
    const path = realpathSync(resolve(root, name));
    if (!within(root, path)) throw Error('Snapshot path escaped input directory');
    return readFileSync(path);
  };
  const indexBytes = read('jobs.json'), snapshot = JSON.parse(indexBytes), manifest = JSON.parse(read('snapshot-manifest.json'));
  if (hash(indexBytes) !== manifest.index_sha256) throw Error('Snapshot manifest mismatch');
  if (![2, 3].includes(snapshot.schema_version) || !Array.isArray(snapshot.jobs)) throw Error('Unsupported canonical snapshot');
  const loadAsset = (path) => {
    const match = typeof path === 'string' && path.match(assetPattern);
    if (!match) throw Error('Invalid canonical asset path');
    const buffer = read(path.slice(1));
    if (buffer.length > limit || hash(buffer).slice(0, 20) !== match[1]) throw Error('Canonical asset missing or corrupt');
    return JSON.parse(buffer);
  };
  const rows = snapshot.index_shards?.length ? snapshot.index_shards.flatMap((path) => {
    const part = loadAsset(path);
    if (!Array.isArray(part.jobs)) throw Error('Invalid canonical index');
    return part.jobs;
  }) : snapshot.jobs;
  if (!rows.length || new Set(rows.map((j) => j.id)).size !== rows.length ||
      (snapshot.index_shards?.length && rows.length !== snapshot.index_count)) throw Error('Canonical index incomplete');
  const search = Object.assign({}, ...[snapshot.search_url, ...(snapshot.search_shards || [])].map((path) => {
    const part = loadAsset(path);
    if (!part.jobs || Array.isArray(part.jobs) || typeof part.jobs !== 'object') throw Error('Invalid canonical search');
    return part.jobs;
  }));
  if (rows.some((row) => typeof search[row.id] !== 'string')) throw Error('Canonical search incomplete');
  const { jobs, excerpts } = projectBrowsingJobs(rows);
  jobs.forEach(validateBrowsingJob);
  mkdirSync(resolve(root, 'job-assets'), { recursive: true });
  if (!within(root, realpathSync(resolve(root, 'job-assets')))) throw Error('Asset directory escaped input directory');
  const atomic = (name, bytes) => {
    const target = resolve(root, name), temporary = target + `.tmp-${process.pid}`;
    if (!within(root, realpathSync(dirname(target)))) throw Error('Output directory escaped input');
    writeFileSync(temporary, bytes); renameSync(temporary, target);
  };
  const asset = (kind, payload) => {
    const bytes = JSON.stringify(payload);
    if (Buffer.byteLength(bytes) > limit) throw Error('Browsing asset exceeds 25 MiB');
    const path = `/job-assets/${kind}-${hash(bytes).slice(0, 20)}.json`;
    atomic(path.slice(1), bytes); return path;
  };
  const shards = splitRows(jobs, 256 * 1024).map((batch) => asset('index', { jobs: batch }));
  // Reuse canonical full text; only supplement excerpts not already present.
  // Overlay rows contain both texts so the existing dictionary loader remains
  // deterministic and never overwrites a full announcement with a short excerpt.
  const supplements = jobs.filter((job) => !search[job.id].includes(excerpts[job.id]))
    .map((job) => [job.id, `${search[job.id]}\n${excerpts[job.id]}`]);
  const searchShards = [snapshot.search_url, ...(snapshot.search_shards || []),
    ...splitRows(supplements).map((batch) => asset('search', { jobs: Object.fromEntries(batch) }))];
  const next = { ...snapshot, browse_index: { version: 1, count: jobs.length, shards, search_shards: searchShards } };
  const bytes = JSON.stringify(next);
  // All immutable assets exist before publishing the entry point. Canonical
  // index/detail/search paths and collection timestamps remain unchanged.
  atomic('jobs.json', bytes);
  atomic('snapshot-manifest.json', JSON.stringify({ ...manifest, index_sha256: hash(bytes) }));
  return { canonical_records: rows.length, browsing_records: jobs.length, shards: shards.length,
    seconds: Number(((performance.now() - started) / 1000).toFixed(3)), network_requests: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--public-dir') throw Error('Usage: node --experimental-strip-types scripts/build_browse_index.mjs --public-dir DIR');
  console.log(JSON.stringify(buildBrowseIndex(args[1])));
}
