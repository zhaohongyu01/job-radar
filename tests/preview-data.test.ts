import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { previewFilePath, previewDataProxy } from '../vite.preview-data.ts';

await test('an isolated local preview cannot escape its directory or fall back on a missing shard', async () => {
  const root = await mkdtemp(join(tmpdir(), 'job-preview-'));
  try {
    await mkdir(join(root, 'job-assets'));
    await writeFile(join(root, 'jobs.json'), '{}');
    assert.ok(previewFilePath(root, '/jobs.json').endsWith('jobs.json'));
    assert.throws(() => previewFilePath(root, '/job-assets/../../private.json'));
    assert.throws(() => previewFilePath(root, '/job-assets/%2e%2e/jobs.json'));
    assert.throws(() => previewFilePath(root, '/job-assets/index-deadbeef.json'));
    assert.equal(previewDataProxy('local'), undefined);
  } finally {
    assert.match(relative(tmpdir(), root), /^job-preview-[^/\\]+$/);
    await rm(root, { recursive: true, force: true });
  }
});
