import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupJobs } from '../lib/grouping.ts';
import { defaultFilters, filterJobs } from '../lib/jobs.ts';
import type { Job } from '../lib/jobs.ts';

const base = { id: 'a', company: '某银行济南分行', title: '某银行2027届校园招聘', types: ['校招'],
  graduation_years: ['2027'], published_at: '2026-09-10', cities: ['济南'], location_evidence: ['工作地点：济南'],
  sectors: [], directions: [], education: '', deadline: null, domestic_status: 'domestic',
} as unknown as Job;

void test('grouping retains all records, URLs and newest-first group order', () => {
  const jobs = [base, { ...base, id: 'b', company: '另一企业' }, { ...base, id: 'c', source_url: 'https://example.com/apply', published_at: '2026-09-09' }];
  const groups = groupJobs(jobs);
  assert.deepEqual(groups.map((g) => g.jobs.map((j) => j.id)), [['a', 'c'], ['b']]);
  assert.equal(groups[0].jobs[1].source_url, 'https://example.com/apply');
  assert.equal(groupJobs(jobs, false).length, 3);
  assert.equal(jobs.length, 3);
});
void test('branches, cohorts, explicit phases and uncertain identities remain separate', () => {
  const jobs = [base, { ...base, id: 'b', company: '某银行青岛分行' }, { ...base, id: 'c', title: '2026届校园招聘' },
    { ...base, id: 'd', title: '2027届秋招' }, { ...base, id: 'e', company: '' },
    { ...base, id: 'f', title: '校园招聘', graduation_years: [] }, { ...base, id: 'g', types: ['社招'] }];
  assert.equal(groupJobs(jobs).length, jobs.length);
});
void test('city and personal filtering happens before grouping, so other records cannot leak in', () => {
  const jobs = [base, { ...base, id: 'b', cities: ['青岛'], location_evidence: ['工作地点：青岛'] }, { ...base, id: 'c' }];
  const filtered = filterJobs(jobs, defaultFilters, { c: { hidden: true } }, null);
  assert.deepEqual(groupJobs(filtered).flatMap((g) => g.jobs.map((j) => j.id)), ['a']);
});
