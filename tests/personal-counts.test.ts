import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureJob } from './fixtures/job.ts';
import { computePersonalCounts } from '../lib/personal-counts.ts';
import type { Personal } from '../lib/jobs.ts';

const now = Date.parse('2026-10-20T10:00:00+08:00');

void test('computePersonalCounts computes pending, savedAll, hidden, tracking, appliedTotal, and dueSoon', () => {
  const jobs = [
    fixtureJob({ id: 'pending-due', deadline: '2026-10-23T23:59:59+08:00' }),
    fixtureJob({ id: 'pending-later', deadline: '2026-11-10T23:59:59+08:00' }),
    fixtureJob({ id: 'saved-expired', deadline: '2026-10-01T23:59:59+08:00' }),
    fixtureJob({ id: 'applied-legacy' }),
    fixtureJob({ id: 'stage-interview' }),
    fixtureJob({ id: 'stage-rejected' }),
    fixtureJob({ id: 'hidden-job' }),
  ];

  const personal: Personal = {
    'pending-due': { saved: true },
    'pending-later': { saved: true },
    'saved-expired': { saved: true },
    'applied-legacy': { saved: true, applied: true },
    'stage-interview': { applied: true, application_stage: 'interview' },
    'stage-rejected': { applied: true, application_stage: 'rejected' },
    'hidden-job': { saved: true, hidden: true },
  };

  const counts = computePersonalCounts(jobs, personal, now);
  assert.equal(counts.pending, 2);
  assert.equal(counts.dueSoon, 1);
  assert.equal(counts.savedAll, 5);
  assert.equal(counts.hidden, 1);
  assert.equal(counts.tracking, 2);
  assert.equal(counts.appliedTotal, 3);
});
