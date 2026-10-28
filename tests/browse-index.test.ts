import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { projectBrowsingJobs, validateBrowsingJob } from '../lib/browse-index.ts';
import { buildBrowseIndex } from '../scripts/build_browse_index.mjs';
import { defaultFilters, filterJobs, getLifecycleStage, hasRecentJobChange, mergeDuplicateOpportunities, parseSalaryRange, personalFor } from '../lib/jobs.ts';
import type { Job, Snapshot } from '../lib/jobs.ts';
import { extractSalary } from '../lib/salary-display.ts';
import { loadIndexSnapshot } from '../lib/snapshot-loader.ts';
import { fixtureJob } from './fixtures/job.ts';

const at = Date.parse('2026-10-28T12:00:00+08:00');
const base = { ...defaultFilters, city: '全部城市', workCities: [], year: '全部' };
const rich = fixtureJob({ excerpt: '招聘公告🙂'.repeat(40) + ' 薪资：20万/年以上 长期招聘 面试名单公示',
  classification_note: '仅核实官方日程', duplicate_sources: [{ title: '第二来源', url: 'https://example.org/repost' }],
  timeline: [{ date: '2026-10-27', type: 'positions_updated', title: '岗位调整', detail: '专业范围调整' }] });

await test('browsing abbreviates only presentation; salary/stage/change facts retain full-excerpt semantics', () => {
  const variants = [rich, ...['薪资：8k-12k', '薪资：400元/天', '流程：面试安排另行通知', '招满为止', ''].map((excerpt, i) =>
    fixtureJob({ id: `case-${i}`, title: `岗位 ${i}`, excerpt: '长摘要'.repeat(80) + excerpt }))];
  const untouched = structuredClone(variants);
  const { jobs, excerpts } = projectBrowsingJobs(variants);
  assert.deepEqual(variants, untouched);
  for (let i = 0; i < jobs.length; i++) {
    const projected = JSON.parse(JSON.stringify(jobs[i])) as Job;
    validateBrowsingJob(projected);
    assert.equal(projected.timeline, undefined);
    assert.equal(projected.duplicate_sources, undefined);
    assert.ok(Array.from(projected.excerpt).length <= 120);
    assert.equal(excerpts[projected.id], variants[i].excerpt);
    assert.deepEqual(parseSalaryRange(projected), parseSalaryRange(variants[i]));
    assert.deepEqual(extractSalary(projected), extractSalary(variants[i]));
    for (const now of [at, at + 60 * 86400000]) {
      assert.deepEqual(getLifecycleStage(projected, now), getLifecycleStage(variants[i], now));
      assert.equal(hasRecentJobChange(projected, now), hasRecentJobChange(variants[i], now));
    }
  }
});

await test('premerging preserves duplicate IDs, personal state and source counts without merging a partial preview again', () => {
  const input = [fixtureJob({ id: 'one', title: '甲集团2027校园招聘', company: '甲集团', kind: '招聘公告' }),
    fixtureJob({ id: 'two', title: '甲集团2027校园招聘简章', company: '甲集团有限公司', kind: '招聘公告', source_url: 'https://example.org/two' })];
  const expected = mergeDuplicateOpportunities(structuredClone(input));
  const { jobs } = projectBrowsingJobs(input);
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0].duplicate_ids, expected[0].duplicate_ids);
  assert.equal(personalFor(jobs[0], { two: { saved: true } }).saved, true);
  assert.equal(jobs[0].listing_facts?.source_names?.length, expected[0].duplicate_sources?.length);
  assert.deepEqual(mergeDuplicateOpportunities(jobs), jobs);
});

await test('generic readiness and boilerplate are excluded from recent changes while position filtering retains its original rule', () => {
  const input = [fixtureJob({ timeline: [
    { date: '2026-10-27', type: 'positions_updated', title: '首次提取完成', detail: '就绪' },
    { date: '2026-10-27', type: 'content_updated', title: '内容更新', detail: '招聘公告正文或附件内容已同步最新变动' },
  ] })];
  const { jobs } = projectBrowsingJobs(input);
  assert.equal(hasRecentJobChange(jobs[0], at), false);
  for (const changeType of ['有变更', '岗位调整', '考核阶段', '截止延期'] as const)
    assert.deepEqual(filterJobs(jobs, { ...base, changeType }, {}, null, at).map(j => j.id),
      filterJobs(input, { ...base, changeType }, {}, null, at).map(j => j.id));
});

await test('incomplete source labels retain the channel count without invalidating the browsing projection', () => {
  const { jobs } = projectBrowsingJobs([fixtureJob({ duplicate_sources: [{ title: '', url: 'https://example.org/unknown' }] })]);
  validateBrowsingJob(jobs[0]);
  assert.equal(jobs[0].listing_facts?.source_names?.length, 1);
});

const sha = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
function cleanup(root: string) {
  const target = realpathSync(root);
  assert.equal(dirname(target), realpathSync(tmpdir()));
  assert.ok(basename(target).startsWith('job-radar-browse-'));
  rmSync(target, { recursive: true, force: true });
}
function fixtureDirectory() {
  const root = mkdtempSync(join(tmpdir(), 'job-radar-browse-'));
  mkdirSync(join(root, 'job-assets'));
  const asset = (kind: string, payload: unknown) => {
    const bytes = JSON.stringify(payload), path = `/job-assets/${kind}-${sha(bytes).slice(0, 20)}.json`;
    writeFileSync(join(root, path), bytes); return path;
  };
  const index = asset('index', { jobs: [rich] });
  const search = asset('search', { jobs: { [rich.id]: '完整正文' } });
  const original = { schema_version: 3, generated_at: '2026-10-26', jobs: [], sources: [], index_count: 1,
    index_shards: [index], search_url: search, detail_shards: {} };
  const bytes = JSON.stringify(original);
  writeFileSync(join(root, 'jobs.json'), bytes);
  writeFileSync(join(root, 'snapshot-manifest.json'), JSON.stringify({ index_sha256: sha(bytes), generated_at: original.generated_at }));
  return { root, original };
}

await test('builder retains canonical assets and history, preserves full search text and is idempotent', () => {
  const { root, original } = fixtureDirectory();
  try {
    const bytes = readFileSync(join(root, original.index_shards[0]));
    const report = buildBrowseIndex(root);
    assert.equal(report.network_requests, 0);
    const first = readFileSync(join(root, 'jobs.json'));
    const metadata = JSON.parse(first.toString()) as Snapshot;
    assert.equal(metadata.generated_at, original.generated_at);
    assert.deepEqual(metadata.index_shards, original.index_shards);
    assert.deepEqual(readFileSync(join(root, original.index_shards[0])), bytes);
    const index = JSON.parse(readFileSync(join(root, metadata.browse_index!.shards[0]), 'utf8')).jobs as Job[];
    const search = Object.assign({}, ...metadata.browse_index!.search_shards.map(path => JSON.parse(readFileSync(join(root, path), 'utf8')).jobs));
    assert.equal(search[rich.id], `完整正文\n${rich.excerpt}`);
    assert.equal(filterJobs(index.map(j => ({ ...j, search_text: search[j.id] })), { ...base, query: '长期招聘' }, {}, null, at).length, 1);
    buildBrowseIndex(root);
    assert.deepEqual(readFileSync(join(root, 'jobs.json')), first);
    assert.equal(JSON.parse(readFileSync(join(root, 'snapshot-manifest.json'), 'utf8')).index_sha256, sha(first));
  } finally { cleanup(root); }
});

await test('corrupt canonical input refuses projection and leaves entry metadata unchanged', () => {
  const { root, original } = fixtureDirectory();
  try {
    const before = readFileSync(join(root, 'jobs.json'));
    writeFileSync(join(root, original.index_shards[0]), '{"jobs":[]}');
    assert.throws(() => buildBrowseIndex(root), /corrupt/);
    assert.deepEqual(readFileSync(join(root, 'jobs.json')), before);
  } finally { cleanup(root); }
});

await test('client prefers supported browsing contract, falls back for future versions, and rejects incomplete facts', async () => {
  const old = '/job-assets/index-00000000000000000001.json', lean = '/job-assets/index-00000000000000000002.json';
  const metadata = { schema_version: 3, jobs: [], sources: [], index_count: 1, index_shards: [old],
    browse_index: { version: 1, count: 1, shards: [lean], search_shards: ['/job-assets/search-00000000000000000003.json'] } } as unknown as Snapshot;
  const projected = projectBrowsingJobs([rich]).jobs;
  const previous = globalThis.fetch, requested: string[] = [];
  try {
    globalThis.fetch = async (path) => { assert.equal(typeof path, 'string'); requested.push(path as string); return new Response(JSON.stringify({ jobs: path === lean ? projected : [rich] })); };
    assert.deepEqual(await loadIndexSnapshot(metadata), projected);
    assert.deepEqual(requested, [lean]);
    requested.length = 0;
    assert.deepEqual(await loadIndexSnapshot({ ...metadata, browse_index: { ...metadata.browse_index!, version: 99 } }), [rich]);
    assert.deepEqual(requested, [old]);
    await assert.rejects(loadIndexSnapshot({ ...metadata, browse_index: { ...metadata.browse_index!, count: 2 } }), /不完整/);
    globalThis.fetch = async () => new Response(JSON.stringify({ jobs: [rich] }));
    await assert.rejects(loadIndexSnapshot(metadata), /筛选依据/);
  } finally { globalThis.fetch = previous; }
});
