import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionHealth, latestPublication } from '../lib/data-health.ts';
import type { Job, Snapshot } from '../lib/jobs.ts';

void test('freshness distinguishes the global publication date, future outliers and source list reads', () => {
  const now = Date.parse('2026-10-22T12:00:00+08:00');
  const jobs = [
    { published_at: '2026-09-11' },
    { published_at: '2026-10-22' },
    { published_at: '2027-01-17' },
  ] as Job[];
  assert.equal(latestPublication(jobs, now), '2026-10-22');
  const health = collectionHealth(
    {
      jobs,
      sources: [
        {
          id: 'old',
          status: 'failed',
          last_success_at: '2026-09-11T12:00:00+08:00',
        },
        {
          id: 'partial',
          status: 'partial',
          last_list_read_at: '2026-10-22T10:00:00+08:00',
          pending_details: 35,
        },
        {
          id: 'deferred',
          status: 'deferred',
          pages: 0,
          last_attempt_at: '2026-10-22T11:00:00+08:00',
        },
      ],
    } as Snapshot,
    now,
  );
  assert.equal(health.checked, 1);
  assert.equal(health.pending, 35);
  assert.equal(health.incomplete, 2);
});
