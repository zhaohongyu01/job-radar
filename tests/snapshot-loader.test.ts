import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSnapshotParts } from '../lib/snapshot-loader.ts';

test('snapshot parts retain order, bound concurrency and reject missing parts', async () => {
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
