import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restoreBrowsing } from '../lib/browsing.ts';
import { defaultFilters, filterJobs, isUnread, mergePersonal, personalFor, validatePersonal } from '../lib/jobs.ts';
import type { Job } from '../lib/jobs.ts';

const job = {
  id: '0123456789abcdef0123', title: '财务', company: '某单位', kind: '具体岗位',
  cities: ['济南'], types: ['校招'], graduation_years: ['2027'], education: '本科',
  sectors: [], directions: [], deadline: null, published_at: '2026-09-01',
  updated_at: '2026-09-01T00:00:00.000Z', first_seen_at: '2026-09-01T00:00:00.000Z',
} as unknown as Job;

void test('read status survives a backup round trip; updates become unread', () => {
  const records = validatePersonal(JSON.parse(JSON.stringify({ [job.id]: { saved: true, readAt: '2026-09-02T00:00:00.000Z' } })));
  assert.equal(isUnread(job, records), false);
  assert.equal(isUnread({ ...job, updated_at: '2026-09-03T00:00:00.000Z' }, records), true);
  assert.equal(filterJobs([job], { ...defaultFilters, onlyUnread: true }, records, null).length, 0);
  assert.equal(filterJobs([job], defaultFilters, records, null).length, 1);
  const unread = validatePersonal({ [job.id]: { ...records[job.id], readAt: null } });
  assert.equal(isUnread(job, unread), true);
  assert.equal(unread[job.id].saved, true);
});
void test('legacy records and folded sources retain expected reading state', () => {
  assert.equal(isUnread(job, validatePersonal({ [job.id]: { saved: true } })), true);
  const folded = { ...job, duplicate_ids: ['old-copy'] };
  const records = { 'old-copy': { saved: true, readAt: '2026-09-02T00:00:00.000Z' } };
  assert.equal(isUnread(folded, records), false);
  assert.equal(personalFor(folded, records).saved, true);
  assert.equal(isUnread(folded, { ...records, [job.id]: { readAt: null } }), true);
  assert.throws(() => validatePersonal({ [job.id]: { readAt: 'not-a-date' } }));
  assert.throws(() => validatePersonal({ [job.id]: { readAt: true } }));
  const existing = { [job.id]: { saved: true, readAt: '2026-09-02T00:00:00.000Z' } };
  assert.equal(isUnread(job, mergePersonal(existing, validatePersonal({ [job.id]: { saved: false } }))), false);
  assert.equal(isUnread(job, mergePersonal(existing, validatePersonal({ [job.id]: { readAt: null } }))), true);
});
void test('browsing preferences restore all filters without letting malformed fields through', () => {
  const filters = { ...defaultFilters, city: '青岛', type: '社招', query: '审计', onlyUnread: true };
  assert.deepEqual(restoreBrowsing({ filters, viewMode: 'table' }), { filters, viewMode: 'table' });
  assert.deepEqual(restoreBrowsing(null).filters, defaultFilters);
  const restored = restoreBrowsing({ filters: { type: 'bad', onlyUnread: 'true', city: [], year: 'bad', query: 'x'.repeat(500), __proto__: { view: 'hidden' } }, viewMode: 'invalid' });
  assert.equal(restored.filters.type, '全部');
  assert.equal(restored.filters.onlyUnread, false);
  assert.equal(restored.filters.city, '济南');
  assert.equal(restored.filters.query.length, 200);
  assert.equal(restored.viewMode, 'cards');
  assert.equal(restored.filters.view, 'all');
});
