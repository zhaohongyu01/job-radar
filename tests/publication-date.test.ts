import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicationDate, publicationText } from '../lib/jobs.ts';
import type { Job } from '../lib/jobs.ts';

const now = Date.parse('2026-09-18T09:00:00+08:00');
const job = (published_at: string | null) => ({ published_at }) as Job;

test('future publication is excluded from publication ordering without changing raw date', () => {
  const future = job('2026-10-12');
  assert.equal(publicationDate(future, now), '');
  assert.equal(publicationText(future, now), '日期异常待核实');
  assert.equal(future.published_at, '2026-10-12');
  const rows = [future, job('2026-09-17'), job('2026-09-18')];
  rows.sort((a, b) => publicationDate(b, now).localeCompare(publicationDate(a, now)));
  assert.deepEqual(rows.map(x => x.published_at), ['2026-09-18', '2026-09-17', '2026-10-12']);
});

test('missing and invalid dates differ and China midnight uses the new local day', () => {
  assert.equal(publicationText(job(null), now), '日期未明确');
  assert.equal(publicationText(job('invalid'), now), '日期异常待核实');
  const midnight = Date.parse('2026-09-17T16:00:00Z');
  assert.equal(publicationDate(job('2026-09-18'), midnight), '2026-09-18');
  assert.equal(publicationDate(job('2026-09-19'), midnight), '');
});
