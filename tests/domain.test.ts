import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterJobs,
  defaultFilters,
  validatePersonal,
  externalUrl,
} from '../lib/jobs.ts';
import type { Job } from '../lib/jobs.ts';
const job = {
  id: '0123456789abcdef0123',
  title: '财务',
  company: '某单位',
  body: '经济学',
  cities: ['济南'],
  possible_cities: [],
  province_possible: false,
  types: ['校招'],
  graduation_years: ['2027'],
  education: '本科',
  sectors: ['国企'],
  directions: ['财务 / 经济'],
  deadline: null,
  published_at: '2026-09-01',
  first_seen_at: '2026-09-02T00:00:00Z',
  updated_at: '2026-09-02T00:00:00Z',
} as unknown as Job;
void test('newest publication comes first even with uncertain location; unknown date last', () => {
  const newer = { ...job, id: 'newer', published_at: '2026-09-09', cities: [] };
  const undated = { ...job, id: 'undated', published_at: null };
  assert.deepEqual(
    filterJobs([job, undated, newer], defaultFilters, {}, null).map(
      (j) => j.id,
    ),
    ['newer', job.id, 'undated'],
  );
});
void test('default shows opportunities without requesting personal qualifications', () =>
  assert.equal(filterJobs([job], defaultFilters, {}, null).length, 1));
void test('campus cohort and social switch respect classification', () => {
  assert.equal(
    filterJobs(
      [job],
      { ...defaultFilters, type: '校招', year: '2026' },
      {},
      null,
    ).length,
    0,
  );
  assert.equal(
    filterJobs([job], { ...defaultFilters, type: '社招' }, {}, null).length,
    0,
  );
});
void test('unknown eligibility remains visible when requested', () => {
  const unknown = { ...job, types: [], graduation_years: [] };
  assert.equal(
    filterJobs([unknown], { ...defaultFilters, type: '校招' }, {}, null).length,
    1,
  );
  assert.equal(
    filterJobs(
      [unknown],
      { ...defaultFilters, type: '校招', includeUncertain: false },
      {},
      null,
    ).length,
    0,
  );
});
void test('expired announcement is not shown as open', () => {
  assert.equal(
    filterJobs(
      [{ ...job, deadline: '2026-01-01T00:00:00+08:00' }],
      defaultFilters,
      {},
      null,
      Date.parse('2026-09-09'),
    ).length,
    0,
  );
});
void test('hidden opportunities remain recoverable', () => {
  const personal = { [job.id]: { hidden: true } };
  assert.equal(filterJobs([job], defaultFilters, personal, null).length, 0);
  assert.equal(
    filterJobs([job], { ...defaultFilters, view: 'hidden' }, personal, null)
      .length,
    1,
  );
});
void test('import rejects malicious or invalid properties', () => {
  assert.throws(() =>
    validatePersonal(JSON.parse('{"__proto__":{"saved":true}}')),
  );
  assert.throws(() => validatePersonal({ [job.id]: { saved: 'yes' } }));
  assert.deepEqual(validatePersonal({ [job.id]: { saved: true } })[job.id], {
    saved: true,
    applied: false,
    hidden: false,
  });
});
void test('unsafe application URL never renders as executable link', () => {
  assert.equal(externalUrl('javascript:alert(1)'), undefined);
  assert.equal(
    externalUrl('https://example.com/apply'),
    'https://example.com/apply',
  );
});
