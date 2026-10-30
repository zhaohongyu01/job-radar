import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fixtureJob } from './fixtures/job.ts';
import { defaultFilters } from '../lib/jobs.ts';
import { resolveEmployer } from '../lib/employers.ts';
import { formatUrlQuery, parseUrlState, restoreBrowsing } from '../lib/browsing.ts';
import { currentReputationScore, dedupeEvidence, filterByReputation, matchReputation, mergeReputationIndexes,
  publicReputationUrl, summarizeReputation, summarizeReputationEntity, validateReputationEntity, validateReputationIndex } from '../lib/reputation.ts';
import type { Dimension, Evidence, ReputationEntity, ReputationIndex } from '../lib/reputation.ts';
import { loadReputationFile } from '../lib/reputation-loader.ts';
import { GET } from '../app/api/reputation/route.ts';

const now = Date.parse('2026-10-29T04:00:00Z'), at = new Date(now).toISOString();
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const dimensions: Dimension[] = ['pay', 'worklife', 'growth', 'management'];
function evidence(i: number, changes: Partial<Evidence> = {}): Evidence {
  return { id: `nowcoder:${1000 + i}`, provider: 'nowcoder', url: `https://www.nowcoder.com/discuss/${1000 + i}`,
    title: `合成工作体验${i}`, excerpt: '这是隔离测试生成的体验，不属于实际企业评价。', kind: 'experience',
    published_at: '2026-10-28T00:00:00Z', collected_at: at, city: '北京', role: '工程师', department: null,
    contributor: hash(`account-${i}`).slice(0, 24), fingerprint: hash(`body-${i}`),
    signals: dimensions.map(dimension => ({ dimension, polarity: 1, quote: '合成测试表述' })), ...changes };
}
function entity(id = '1', changes: Partial<ReputationEntity> = {}): ReputationEntity {
  return { id: `nowcoder:${id}`, provider: 'nowcoder', name: '示例科技', legal_name: '示例科技有限公司',
    names: ['示例科技', '示例科技有限公司'], source_url: `https://www.nowcoder.com/enterprise/${id}/discussion`,
    status: 'ok', partial: true, collected_at: at, records: Array.from({ length: 10 }, (_, i) => evidence(i)), ...changes };
}
function index(entities = [entity()], generated = at): ReputationIndex {
  return { schema_version: 1, policy_version: 1, generated_at: generated,
    entities: entities.map(({ records, ...metadata }) => ({ ...metadata, ...summarizeReputation(records, Date.parse(generated)),
      file: `entity-${metadata.id.split(':')[1]}-${hash(JSON.stringify({ ...metadata, records })).slice(0, 20)}.json` })) };
}

await test('scores require ten known accounts per dimension and three dimensions, with small-sample smoothing', () => {
  assert.equal(summarizeReputation(entity().records.slice(0, 9), now).score, null);
  const enough = summarizeReputation(entity().records, now);
  assert.equal(enough.score, 4.3); assert.equal(enough.dimensions.worklife.contributors, 10);
  assert.equal(summarizeReputation(entity().records.map(row => ({ ...row, signals: row.signals.slice(0, 2) })), now).score, null);
  assert.equal(summarizeReputation(entity().records.map(row => ({ ...row, signals: row.signals.map(signal => ({ ...signal, polarity: -1 as const })) })), now).score, 1.7);
});

await test('uncertain employer attribution retains evidence without counting or scoring it as employee experience', () => {
  const rows = entity().records.map(row => ({ ...row, attribution: 'uncertain' as const }));
  const summary = summarizeReputation(rows, now);
  assert.equal(summary.unattributed_count, 10);
  assert.equal(summary.experience_count, 0);
  assert.equal(summary.recent_experience_count, 0);
  assert.equal(summary.score, null);
  assert.equal(summary.dimensions.pay.contributors, 0);
});

await test('duplicate posts, copy-pastes and one prolific author do not manufacture independent samples', () => {
  const rows = entity().records;
  assert.equal(dedupeEvidence([...rows, ...rows]).length, 10);
  assert.equal(dedupeEvidence([...rows, evidence(99, { fingerprint: rows[0].fingerprint })]).length, 10);
  assert.equal(summarizeReputation(rows.map(row => ({ ...row, contributor: rows[0].contributor })), now).score, null);
  const both = [...rows, evidence(100, { contributor: rows[0].contributor, signals: [{ dimension: 'pay', polarity: -1, quote: '合成反向体验' }] })];
  assert.equal(summarizeReputation(both, now).dimensions.pay.contributors, 10);
  assert.ok(summarizeReputation(both, now).dimensions.pay.score! < 4.3);
});

await test('old, undated, future, interview, question and unidentified accounts never create an employee score', () => {
  for (const change of [{ published_at: '2024-01-01T00:00:00Z' }, { published_at: null }, { published_at: '2027-01-01T00:00:00Z' },
    { kind: 'interview' as const }, { kind: 'question' as const }, { contributor: null }])
    assert.equal(summarizeReputation(entity().records.map(row => ({ ...row, ...change })), now).score, null);
  assert.equal(summarizeReputation([], now).dimensions.pay.score, null);
});

await test('a fresh interview channel cannot renew stale employee evidence and scores expire at each reading deadline', () => {
  const stale = entity().records.map(row => ({ ...row, collected_at: new Date(now - 8 * 86400000).toISOString() }));
  const source = entity('1', { collected_at: at, records: [...stale, evidence(100, { kind: 'interview', signals: [] })] });
  const summary = summarizeReputationEntity(source, now);
  assert.equal(summary.score, null);
  assert.equal(summary.recent_experience_count, 10, 'Publication recency remains distinct from read freshness');
  assert.equal(summary.dimensions.pay.contributors, 0);
  const almostStale = entity().records.map(row => ({ ...row, collected_at: new Date(now - 7 * 86400000 + 60000).toISOString() }));
  const eligible = summarizeReputation(almostStale, now);
  assert.equal(eligible.score, 4.3);
  assert.equal(Date.parse(eligible.valid_until), now + 60000);
  assert.equal(summarizeReputation(almostStale, now + 60000).score, null);
  assert.equal(summarizeReputation(entity().records.map(row => ({ ...row, collected_at: new Date(now + 600000).toISOString() })), now).score, null);
});

await test('scores expire at the next evidence age-out, never become immortal when source data is cached', () => {
  const rows = entity().records.map(row => ({ ...row, published_at: new Date(now - 365 * 86400000 + 30000).toISOString() }));
  const data = index([entity('1', { records: rows })]);
  assert.equal(Date.parse(data.entities[0].valid_until), now + 30000);
  const match = matchReputation(resolveEmployer(fixtureJob({ company: '示例科技有限公司' })), data);
  assert.equal(currentReputationScore(match, now), 4.3);
  assert.equal(currentReputationScore(match, now + 30001), null);
  assert.equal(summarizeReputationEntity(entity('1', { collected_at: '2026-10-01T00:00:00Z' }), now).score, null);
});

await test('external data is validated, bounded and restricted to attributable public source links', () => {
  validateReputationEntity(entity()); validateReputationIndex(index());
  for (const url of ['javascript:alert(1)', 'https://www.nowcoder.com.evil.test/discuss/1', 'https://user@www.nowcoder.com.evil/discuss/1',
    'https://www.nowcoder.com/search?q=xx', 'https://www.nowcoder.com/discuss/1?token=foo']) assert.equal(publicReputationUrl(url), false);
  assert.throws(() => validateReputationEntity(entity('1', { records: [evidence(1, { kind: 'interview' })] })));
  assert.throws(() => validateReputationEntity(entity('1', { source_url: 'https://www.nowcoder.com/enterprise/2/discussion' })));
  assert.throws(() => validateReputationEntity(entity('1', { records: [evidence(1, { excerpt: 'a'.repeat(101) })] })));
  const bad = index(); bad.entities[0].dimensions.pay.contributors = 1; assert.throws(() => validateReputationIndex(bad));
  const immortal = index(); immortal.entities[0].valid_until = '2028-01-01T00:00:00Z'; assert.throws(() => validateReputationIndex(immortal));
  assert.throws(() => validateReputationIndex({ ...index(), policy_version: 999 }));
});

await test('exact legal names score directly; abbreviated, grouped or ambiguous identities remain references', () => {
  const data = index();
  assert.equal(matchReputation(resolveEmployer(fixtureJob({ company: '示例科技有限公司' })), data)?.reference, false);
  assert.equal(matchReputation(resolveEmployer(fixtureJob({ company: '示例科技' })), data)?.reference, true);
  assert.equal(matchReputation(resolveEmployer(fixtureJob({ company: '示例科技有限公司济南分公司' })), data), null);
  assert.equal(matchReputation(resolveEmployer(fixtureJob({ company: '示例科技有限公司' })), index([entity(), entity('2')])), null);
  const group = index([entity('1', { name: '海信集团', legal_name: '海信集团控股股份有限公司', names: ['海信集团', '海信集团控股股份有限公司'] })]);
  const reference = matchReputation(resolveEmployer(fixtureJob({ company: '海信视像科技股份有限公司', source_id: 'hisense-campus' })), group);
  assert.equal(reference?.reference, true); assert.equal(currentReputationScore(reference, now), null);
});

await test('public filters keep unknown employers by default, stable-sort graded firms and never block jobs on data failure', () => {
  const known = fixtureJob({ company: '示例科技有限公司' }), unknown = fixtureJob({ id: 'unknown123', company: '未知公司有限公司' });
  const jobs = [unknown, known], data = index();
  assert.equal(filterByReputation(jobs, defaultFilters, data, {}, now), jobs);
  const filters = { ...defaultFilters, reputationMin: '4' as const };
  assert.deepEqual(filterByReputation(jobs, filters, data, {}, now), jobs);
  assert.deepEqual(filterByReputation(jobs, { ...filters, includeUnrated: false }, data, {}, now), [known]);
  assert.deepEqual(filterByReputation(jobs, { ...filters, includeUnrated: false }, null, {}, now), jobs);
  assert.deepEqual(filterByReputation(jobs, { ...defaultFilters, sort: 'reputation_desc' }, data, {}, now), [known, unknown]);
});

await test('private intent sorting works even when the public source is unavailable', () => {
  const a = fixtureJob({ company: '示例科技有限公司' }), b = fixtureJob({ id: 'other1234', company: '其他有限公司' });
  const records = { [resolveEmployer(b)!.id]: { rating: 5, notes: '私密信息', updated_at: at } };
  assert.deepEqual(filterByReputation([a, b], { ...defaultFilters, sort: 'employer_intent_desc', reputationMin: '4', includeUnrated: false }, null, records, now), [b, a]);
});

await test('late bundled indexes and cold partial updates preserve coverage and newest source timestamps across timezones', () => {
  const newer = index([entity('1', { collected_at: '2026-10-29T08:00:00+08:00' })]);
  const stale = index([entity('1', { collected_at: '2026-10-28T23:00:00Z' }), entity('2')], '2026-10-28T23:30:00Z');
  const merged = mergeReputationIndexes(newer, stale);
  assert.equal(merged.entities.length, 2); assert.equal(merged.entities[0].collected_at, newer.entities[0].collected_at);
  assert.equal(merged.generated_at, newer.generated_at);
});

await test('public conditions and sorting round trip through shared URLs; old saved browsing gets safe defaults', () => {
  const filters = { ...defaultFilters, reputationMin: '4' as const, includeUnrated: false, sort: 'reputation_desc' as const };
  assert.deepEqual(parseUrlState(formatUrlQuery(filters)).filters, filters);
  const old = restoreBrowsing({ filters: { sort: 'newest' } }).filters;
  assert.equal(old.reputationMin, 'all'); assert.equal(old.includeUnrated, true);
  assert.doesNotMatch(formatUrlQuery(filters), /私密|notes|rating/);
});

await test('detail loader verifies the content hash and company identity, rejects malformed assets and allows a later retry', async () => {
  const original = globalThis.fetch;
  try {
    const raw = JSON.stringify(entity()), file = `entity-1-${hash(raw).slice(0, 20)}.json`;
    globalThis.fetch = async () => new Response(raw);
    assert.equal(((await loadReputationFile(file, false)) as ReputationEntity).id, 'nowcoder:1');
    await assert.rejects(loadReputationFile(file.replace('entity-1-', 'entity-2-'), false), /标识/);
    globalThis.fetch = async () => new Response('{}'); await assert.rejects(loadReputationFile(file, false), /校验/);
    await assert.rejects(loadReputationFile('../secret.json', true), /地址/);
    globalThis.fetch = async () => new Response(raw); assert.equal(((await loadReputationFile(file, true)) as ReputationEntity).id, 'nowcoder:1');
  } finally { globalThis.fetch = original; }
});

await test('read-only delivery route cannot proxy arbitrary URLs and fails cleanly on upstream outages or invalid JSON', async () => {
  const original = globalThis.fetch, requests: string[] = [];
  try {
    globalThis.fetch = async input => { requests.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url); return Response.json(index()); };
    assert.equal((await GET(new Request('https://example.org/api/reputation?file=../../secret'))).status, 400);
    assert.deepEqual(requests, []);
    const response = await GET(new Request('https://example.org/api/reputation?file=index.json'));
    assert.equal(response.status, 200); assert.match(response.headers.get('cache-control')!, /max-age=300/);
    assert.match(requests[0], /^https:\/\/raw\.githubusercontent\.com\/zhaohongyu01\/job-radar\/reputation-data\/public\/reputation\/index.json$/);
    let fallbackCalls = 0;
    const deadlines: AbortSignal[] = [];
    globalThis.fetch = async (input, init) => {
      fallbackCalls++; deadlines.push(init!.signal!);
      assert.equal(init?.redirect, 'manual'); // Cloudflare Workers rejects redirect: 'error'.
      assert.equal(new Headers(init?.headers).get('user-agent'), 'JobRadar-Public-Reputation');
      if (fallbackCalls === 1) return new Response('unavailable', { status: 503 });
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      assert.match(url, /^https:\/\/api\.github\.com\/repos\/zhaohongyu01\/job-radar\/contents\/public\/reputation\/index.json\?ref=reputation-data$/);
      return Response.json(index());
    };
    assert.equal((await GET(new Request('https://example.org/api/reputation'))).status, 200);
    assert.equal(fallbackCalls, 2); assert.equal(deadlines[0], deadlines[1]);
    globalThis.fetch = async () => new Response('not available', { status: 404 });
    assert.equal((await GET(new Request('https://example.org/api/reputation'))).status, 503);
    globalThis.fetch = async () => new Response('<html>challenge</html>');
    assert.equal((await GET(new Request('https://example.org/api/reputation'))).status, 503);
    globalThis.fetch = async () => { throw Error('timeout'); };
    assert.equal((await GET(new Request('https://example.org/api/reputation'))).status, 503);
  } finally { globalThis.fetch = original; }
});
