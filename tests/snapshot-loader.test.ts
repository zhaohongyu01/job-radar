import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadIndexSnapshot, loadSnapshotParts } from '../lib/snapshot-loader.ts';
import type { SnapshotIndexCache } from '../lib/snapshot-loader.ts';
import type { Snapshot } from '../lib/jobs.ts';
import { fixtureJob } from './fixtures/job.ts';

await test('snapshot parts retain order, bound concurrency and reject missing parts', async () => {
  const previous = globalThis.fetch;
  const paths = Array.from({ length: 9 }, (_, i) => `/job-assets/index-${i.toString(16).padStart(20, '0')}.json`);
  let active = 0, peak = 0;
  try {
    globalThis.fetch = async (input) => {
      peak = Math.max(peak, ++active);
      await Promise.resolve();
      active--;
      return new Response(JSON.stringify({ path: input }));
    };
    const parts = await loadSnapshotParts<{ path: string }>(paths, 'index');
    assert.deepEqual(parts.map((p) => p.path), paths);
    assert.ok(peak <= 4);
    globalThis.fetch = async () => new Response('', { status: 404 });
    await assert.rejects(loadSnapshotParts(paths, 'index'));
    await assert.rejects(loadSnapshotParts(['https://example.org/index.json'], 'index'));
  } finally {
    globalThis.fetch = previous;
  }
});

const paths = Array.from({ length: 3 }, (_, i) => `/job-assets/index-${(i + 1).toString(16).padStart(20, '0')}.json`);
const snapshot = (count = 3): Snapshot => ({ schema_version: 3, generated_at: '2026-10-28T10:00:00+08:00',
  last_success_at: null, schedule_enabled: true, cities: [], sources: [], jobs: [], index_count: count, index_shards: paths });

await test('a page cache reuses only a fully validated immutable index and retains no extra snapshot generations', async () => {
  const previous = globalThis.fetch, cache: { current: SnapshotIndexCache | null } = { current: null };
  let calls = 0;
  const rows = paths.map((_, i) => fixtureJob({ id: `cached-${i}` }));
  try {
    globalThis.fetch = async input => { calls++; const path = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return Response.json({ jobs: [rows[paths.indexOf(path)]] }); };
    const first = await loadIndexSnapshot(snapshot(), undefined, undefined, cache);
    assert.equal(calls, 3);
    const again = await loadIndexSnapshot({ ...snapshot(), generated_at: '2026-10-30T00:00:00Z' }, undefined, undefined, cache);
    assert.equal(first, again); assert.equal(calls, 3);
    const abort = new AbortController(); abort.abort();
    await assert.rejects(loadIndexSnapshot(snapshot(), abort.signal, undefined, cache));
    globalThis.fetch = async () => Response.json({ jobs: [rows[0]] });
    await assert.rejects(loadIndexSnapshot({ ...snapshot(), index_shards: [...paths].reverse() }, undefined, undefined, cache));
    assert.equal(cache.current!.jobs, first);
  } finally { globalThis.fetch = previous; }
});

await test('index previews use separate arrays and complete only after every record validates', async () => {
  const previous = globalThis.fetch;
  const jobs = paths.map((_, i) => fixtureJob({ id: `record-${i}` }));
  const previews: string[][] = [];
  try {
    globalThis.fetch = async (path) => new Response(JSON.stringify({ jobs: [jobs[paths.indexOf(path as string)]] }));
    const full = await loadIndexSnapshot(snapshot(), undefined, (partial, total) => {
      assert.equal(total, 3);
      previews.push(partial.map((job) => job.id));
      partial.pop(); // An observer cannot mutate the loader's accumulated array.
    });
    assert.deepEqual(previews, [['record-0'], ['record-0', 'record-1', 'record-2']]);
    assert.deepEqual(full, jobs);
  } finally { globalThis.fetch = previous; }
});

await test('invalid later batches never publish their records or return a partial index', async () => {
  const previous = globalThis.fetch;
  const first = fixtureJob({ id: 'first' });
  const cases = [
    { jobs: [first] }, // Duplicate from an earlier batch.
    { jobs: [fixtureJob({ id: 'second' }), fixtureJob({ id: 'second' })] },
    { jobs: [null] }, { jobs: [{ id: '' }] }, { jobs: [{ id: 42 }] },
    { jobs: 'invalid' }, null,
    { jobs: [fixtureJob({ id: 'second' }), fixtureJob({ id: 'third' }), fixtureJob({ id: 'fourth' })] },
  ];
  try {
    for (const invalid of cases) {
      const published: string[][] = [];
      globalThis.fetch = async (path) => new Response(JSON.stringify(path === paths[0] ? { jobs: [first] }
        : path === paths[1] ? invalid : { jobs: [] }));
      await assert.rejects(loadIndexSnapshot(snapshot(), undefined, (jobs) => published.push(jobs.map((job) => job.id))));
      assert.deepEqual(published, [['first']]);
    }
    globalThis.fetch = async (path) => path === paths[0]
      ? new Response(JSON.stringify({ jobs: [first] })) : new Response('', { status: 503 });
    await assert.rejects(loadIndexSnapshot(snapshot()), /读取失败/);
    globalThis.fetch = async () => new Response(JSON.stringify({ jobs: [] }));
    await assert.rejects(loadIndexSnapshot(snapshot()), /不完整/);
    await assert.rejects(loadIndexSnapshot({ ...snapshot(), index_count: 0 }), /声明异常/);
    await assert.rejects(loadIndexSnapshot({ ...snapshot(), index_shards: [] }), /声明异常/);
  } finally { globalThis.fetch = previous; }
});

await test('aborted loads and rejected preview validation cannot continue publishing', async () => {
  const previous = globalThis.fetch;
  const controller = new AbortController();
  let previews = 0;
  try {
    globalThis.fetch = async () => {
      controller.abort();
      return new Response(JSON.stringify({ jobs: [fixtureJob()] }));
    };
    await assert.rejects(loadIndexSnapshot(snapshot(), controller.signal, () => previews++), { name: 'AbortError' });
    assert.equal(previews, 0);
    globalThis.fetch = async () => new Response(JSON.stringify({ jobs: [fixtureJob()] }));
    await assert.rejects(loadIndexSnapshot(snapshot(), undefined, () => { throw Error('preview validation'); }), /preview validation/);
  } finally { globalThis.fetch = previous; }
});

await test('snapshot parts support progressive loading through onProgress callback', async () => {
  const previous = globalThis.fetch;
  const paths = Array.from({ length: 6 }, (_, i) => `/job-assets/index-${i.toString(16).padStart(20, '0')}.json`);
  const progressCalls: { batchCount: number; loaded: number; total: number }[] = [];
  try {
    globalThis.fetch = async (input) => new Response(JSON.stringify({ path: input }));
    const parts = await loadSnapshotParts<{ path: string }>(
      paths,
      'index',
      undefined,
      (batch, loaded, total) => {
        progressCalls.push({ batchCount: batch.length, loaded, total });
      },
    );
    assert.equal(parts.length, 6);
    // 1st batch size is 1 for instant response, subsequent batch size is 4 then 1
    assert.deepEqual(progressCalls, [
      { batchCount: 1, loaded: 1, total: 6 },
      { batchCount: 4, loaded: 5, total: 6 },
      { batchCount: 1, loaded: 6, total: 6 },
    ]);
  } finally {
    globalThis.fetch = previous;
  }
});
