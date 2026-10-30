import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fixtureJob } from './fixtures/job.ts';
import { defaultFilters, filterJobs } from '../lib/jobs.ts';
import type { Personal } from '../lib/jobs.ts';
import { buildActionQueue, personalViewFilters } from '../lib/workspace.ts';
import { buildEmployerCatalog, employerEvents } from '../lib/employer-catalog.ts';
import { resolveEmployer } from '../lib/employers.ts';
import { parseUrlState, formatUrlQuery, restoreBrowsing } from '../lib/browsing.ts';
import { buildReputationQueue } from '../lib/reputation-queue.ts';
import { matchReputation, summarizeReputation, validateReputationEntity, validateReputationIndex, currentReputationScore } from '../lib/reputation.ts';
import type { ReputationEntity, ReputationIndex } from '../lib/reputation.ts';

const now = Date.parse('2026-10-30T04:00:00Z');
await test('pending count and view use identical duplicate-aware criteria and deadline ordering', () => {
  const rows = ['soon', 'later', 'applied', 'hidden', 'ended', 'overseas', 'alias'].map((id, i) => fixtureJob({ id,
    deadline: i === 4 ? '2026-10-01' : i === 0 ? '2026-10-30' : null,
    ...(i === 5 ? { domestic_status: 'overseas' as const } : {}), ...(i === 6 ? { duplicate_ids: ['old'] } : {}) }));
  const records: Personal = Object.fromEntries(rows.filter(row => row.id !== 'alias').map(row => [row.id, { saved: true }]));
  records.old = { saved: true }; records.applied.applied = true; records.hidden.hidden = true;
  assert.deepEqual(filterJobs(rows, personalViewFilters('planned'), records, null, now), buildActionQueue(rows, records, now));
  assert.equal(buildActionQueue(rows, records, now)[0].id, 'soon');
  assert.equal(filterJobs(rows, personalViewFilters('saved'), records, null, now).length, 7);
});

await test('pipeline stages include expired tracked jobs and allow both legacy applied and stage records', () => {
  const rows = [fixtureJob({ id: 'stage-1', deadline: '2020-01-01' }), fixtureJob({ id: 'stage-2' }), fixtureJob({ id: 'untracked' })];
  const personal: Personal = { 'stage-1': { applied: true, application_stage: 'interview' }, 'stage-2': { applied: true } };
  const filters = personalViewFilters('pipeline');
  assert.equal(filterJobs(rows, filters, personal, null, now).length, 2);
  assert.deepEqual(filterJobs(rows, { ...filters, applicationStage: 'interview' }, personal, null, now).map(row => row.id), ['stage-1']);
  assert.equal(restoreBrowsing({ filters: { view: 'pipeline', applicationStage: 'interview' } }).filters.applicationStage, 'interview');
});

await test('employer links restore an exact conservative identity without exposing personal notes', () => {
  const profile = resolveEmployer(fixtureJob({ company: '示例公司有限公司' }))!;
  const filters = { ...defaultFilters, view: 'planned' };
  const query = formatUrlQuery(filters, null, profile.id);
  assert.equal(parseUrlState(query).employerId, profile.id);
  assert.equal(parseUrlState(query).filters?.view, 'planned');
  assert.equal(parseUrlState('?employer=javascript:alert(1)').employerId, undefined);
  assert.throws(() => formatUrlQuery(filters, null, 'untrusted identity'));
  assert.doesNotMatch(query, /notes|rating/);
});

await test('catalog retains every job, isolates branches and source abbreviations, and deduplicates event IDs only', () => {
  const event = { id: 'talk-1', date: '2026-11-01', school: '示例大学', venue: '大厅', city: '北京', url: 'https://example.org/talk', status: 'scheduled' as const };
  const rows = [fixtureJob({ company: '示例公司有限公司', talk_events: [event] }),
    fixtureJob({ id: 'second', company: '示例公司有限公司', talk_events: [event] }),
    fixtureJob({ id: 'branch', company: '示例公司有限公司济南分公司' })];
  const catalog = buildEmployerCatalog(rows);
  assert.equal(catalog.size, 2); assert.equal(catalog.get(resolveEmployer(rows[0])!.id)?.jobs.length, 2);
  assert.equal(employerEvents(rows).length, 1);
});

await test('public employer queue honors verified aliases, surfaces unknown mappings and skips expired opportunities', () => {
  const seeds = [{ id: 1, expected_names: ['海尔'] }, { id: 2, expected_names: ['其他科技有限公司'] }];
  const rows = [fixtureJob({ company: '海尔集团', source_id: 'haier-campus' }), fixtureJob({ company: '尚待对应科技有限公司' }),
    fixtureJob({ company: '其他科技有限公司', deadline: '2020-01-01' })];
  const queue = buildReputationQueue(rows, seeds, {}, now, { 海尔: ['海尔集团'] });
  assert.equal(queue.matched_enterprises, 1); assert.equal(queue.enterprises[0].id, 1);
  assert.equal(queue.enterprises[0].active_jobs, 1); assert.equal(queue.needs_mapping[0].name, '尚待对应科技有限公司');
  assert.ok(!JSON.stringify(queue).includes('notes'));
});

await test('queue aging creates eventual opportunities for less popular firms without fuzzy identity merges', () => {
  const seeds = [{ id: 1, expected_names: ['热门有限公司'] }, { id: 2, expected_names: ['冷门有限公司'] }];
  const rows = Array.from({ length: 100 }, (_, i) => fixtureJob({ id: String(i), company: '热门有限公司' }));
  const state = { '1': { last_attempt_at: '2026-10-30T03:00:00Z' }, '2': { last_attempt_at: '2026-10-01T00:00:00Z' } };
  assert.equal(buildReputationQueue(rows, seeds, state, now).enterprises[0].id, 2);
  assert.equal(buildReputationQueue([fixtureJob({ company: '热门有限公司济南分公司' })], seeds, {}, now).matched_enterprises, 0);
});

await test('multi-source records stay separate with native platform scores distinct from text reference scores', () => {
  const entity: ReputationEntity = { id: 'maimai:company123', provider: 'maimai', name: '示例公司有限公司', legal_name: '示例公司有限公司',
    names: ['示例公司有限公司'], source_url: 'https://maimai.cn/company?cid=123', collected_at: '2026-10-30T04:00:00Z', status: 'partial', partial: true,
    records: [], platform_score: { value: 8.5, scale: 10, samples: 120, checked_at: '2026-10-30T04:00:00Z', url: 'https://maimai.cn/company?cid=123' } };
  validateReputationEntity(entity);
  const native = { ...entity, provider: 'nowcoder' as const, id: 'nowcoder:1', source_url: 'https://www.nowcoder.com/enterprise/1/discussion', platform_score: undefined };
  const data: ReputationIndex = { schema_version: 2, policy_version: 1, generated_at: entity.collected_at, entities: [native, entity].map(({ records, ...rest }) => ({ ...rest,
    ...summarizeReputation(records, now), file: `${rest.provider === 'nowcoder' ? 'entity-1' : 'entity-maimai-company123'}-${createHash('sha256').update(rest.id).digest('hex').slice(0, 20)}.json` })) };
  validateReputationIndex(data);
  const match = matchReputation(resolveEmployer(fixtureJob({ company: entity.name })), data)!;
  assert.equal(match.items.length, 2); assert.equal(match.item.provider, 'nowcoder');
  assert.equal(currentReputationScore(match, now), null);
  assert.throws(() => validateReputationEntity({ ...entity, platform_score: { ...entity.platform_score, value: 11 } }));
  assert.throws(() => validateReputationEntity({ ...entity, source_url: 'https://evil.test/company/123' }));
});
