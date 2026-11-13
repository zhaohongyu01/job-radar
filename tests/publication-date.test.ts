import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  applyPersonalView,
  compareJobsByNewest,
  defaultFilters,
  effectiveNewestDate,
  isSubstantiveReopenChange,
  isTodayOpportunity,
  publicationDate,
  publicationText,
} from '../lib/jobs.ts';
import type { Job, Snapshot } from '../lib/jobs.ts';
import { buildBrowseIndex } from '../scripts/build_browse_index.mjs';
import { fixtureJob } from './fixtures/job.ts';

const now = Date.parse('2026-09-18T09:00:00+08:00');
const job = (published_at: string | null) => ({ published_at }) as Job;

void test('future publication is excluded from publication ordering without changing raw date', () => {
  const future = job('2026-10-12');
  assert.equal(publicationDate(future, now), '');
  assert.equal(publicationText(future, now), '日期异常待核实');
  assert.equal(future.published_at, '2026-10-12');
  const rows = [future, job('2026-09-17'), job('2026-09-18')];
  rows.sort((a, b) => publicationDate(b, now).localeCompare(publicationDate(a, now)));
  assert.deepEqual(rows.map(x => x.published_at), ['2026-09-18', '2026-09-17', '2026-10-12']);
});

void test('missing and invalid dates differ and China midnight uses the new local day', () => {
  assert.equal(publicationText(job(null), now), '日期未明确');
  assert.equal(publicationText(job('invalid'), now), '日期异常待核实');
  const midnight = Date.parse('2026-09-17T16:00:00Z');
  assert.equal(publicationDate(job('2026-09-18'), midnight), '2026-09-18');
  assert.equal(publicationDate(job('2026-09-19'), midnight), '');
});

void test('ATS daily PostDate refresh on an older verified job heals back to first_seen_at and stops hogging newest rank', () => {
  const checkNow = Date.parse('2026-11-13T22:00:00+08:00');
  const hisenseBumped = fixtureJob({
    id: '00000000000000000001',
    company: '海信集团',
    title: '销售经理（全国）',
    published_at: '2026-11-13',
    first_seen_at: '2026-09-15T09:20:59+08:00',
    updated_at: '2026-11-08T20:34:50+08:00',
    last_verified_at: '2026-11-13T18:10:15+08:00',
    recent_change: {
      type: 'content_updated',
      label: '入口更新',
      date: '2026-11-08',
      detail: '网申投递入口已更新为最新链接',
    },
  });
  const genuineNew = fixtureJob({
    id: 'ffffffffffffffffffff',
    company: '真实新发国企',
    title: '财务管理岗',
    published_at: '2026-11-13',
    first_seen_at: '2026-11-13T14:00:00+08:00',
    updated_at: '2026-11-13T14:00:00+08:00',
    last_verified_at: '2026-11-13T14:00:00+08:00',
  });

  assert.equal(publicationDate(hisenseBumped, checkNow), '2026-09-15');
  assert.equal(effectiveNewestDate(hisenseBumped, checkNow), '2026-09-15');
  assert.equal(isTodayOpportunity(hisenseBumped, checkNow), false);
  assert.equal(isTodayOpportunity(genuineNew, checkNow), true);

  const sorted = applyPersonalView(
    [hisenseBumped, genuineNew],
    { ...defaultFilters, city: '全部城市', workCities: [], year: '全部', sort: 'newest' },
    {},
    checkNow,
  );
  assert.deepEqual(sorted.map((item) => item.id), [genuineNew.id, hisenseBumped.id]);
});

void test('only genuine expansion/supplemental/extension changes boost effectiveNewestDate', () => {
  const checkNow = Date.parse('2026-11-13T22:00:00+08:00');
  const baseOld = {
    published_at: '2026-11-13',
    first_seen_at: '2026-09-15T09:00:00+08:00',
    updated_at: '2026-11-12T10:00:00+08:00',
    last_verified_at: '2026-11-13T18:00:00+08:00',
  };

  const supplemental = fixtureJob({
    ...baseOld,
    id: 'supp',
    recent_change: { type: 'supplemental', label: '补录招募', date: '2026-11-12', detail: '招聘变更为补录 / 追加招聘批次' },
  });
  const extended = fixtureJob({
    ...baseOld,
    id: 'ext',
    recent_change: { type: 'deadline_extended', label: '截止延期', date: '2026-11-12', detail: '报名截止时间延长至 2026-12-10（原截止时间：2026-11-20）' },
  });
  const shortened = fixtureJob({
    ...baseOld,
    id: 'short',
    recent_change: { type: 'deadline_extended', label: '截止调整', date: '2026-11-12', detail: '报名截止时间调整为 2026-11-15（原截止时间：2026-11-20）' },
  });
  const readyOnly = fixtureJob({
    ...baseOld,
    id: 'ready',
    recent_change: { type: 'positions_updated', label: '岗位表就绪', date: '2026-11-12', detail: '首次提取 10 个岗位' },
  });
  const zeroPos = fixtureJob({
    ...baseOld,
    id: 'zero',
    recent_change: { type: 'positions_updated', label: '岗位表更新', date: '2026-11-12', detail: '岗位需求变动为 0 个职位' },
  });
  const expandedPos = fixtureJob({
    ...baseOld,
    id: 'pos-up',
    recent_change: { type: 'positions_updated', label: '岗位表更新', date: '2026-11-12', detail: '岗位需求变动为 25 个职位，新增专业：会计学' },
  });
  const addedCity = fixtureJob({
    ...baseOld,
    id: 'city-up',
    recent_change: { type: 'content_updated', label: '地点调整', date: '2026-11-12', detail: '工作地点新增「青岛」' },
  });

  assert.equal(isSubstantiveReopenChange(supplemental.recent_change), true);
  assert.equal(isSubstantiveReopenChange(extended.recent_change), true);
  assert.equal(isSubstantiveReopenChange(shortened.recent_change), false);
  assert.equal(isSubstantiveReopenChange(readyOnly.recent_change), false);
  assert.equal(isSubstantiveReopenChange(zeroPos.recent_change), false);
  assert.equal(isSubstantiveReopenChange(expandedPos.recent_change), true);
  assert.equal(isSubstantiveReopenChange(addedCity.recent_change), true);

  assert.equal(publicationDate(supplemental, checkNow), '2026-09-15');
  assert.equal(effectiveNewestDate(supplemental, checkNow), '2026-11-12');
  assert.equal(effectiveNewestDate(extended, checkNow), '2026-11-12');
  assert.equal(effectiveNewestDate(shortened, checkNow), '2026-09-15');
  assert.equal(effectiveNewestDate(readyOnly, checkNow), '2026-09-15');
  assert.equal(effectiveNewestDate(zeroPos, checkNow), '2026-09-15');
  assert.equal(effectiveNewestDate(expandedPos, checkNow), '2026-11-12');
  assert.equal(effectiveNewestDate(addedCity, checkNow), '2026-11-12');
});

void test('same-day newest tie-breaking orders by first_seen_at descending instead of minimum hex id', () => {
  const checkNow = Date.parse('2026-11-13T22:00:00+08:00');
  const earlierSmallId = fixtureJob({
    id: '00000000000000000001',
    published_at: '2026-11-13',
    first_seen_at: '2026-11-13T08:00:00+08:00',
    last_verified_at: '2026-11-13T08:00:00+08:00',
  });
  const laterLargeId = fixtureJob({
    id: 'ffffffffffffffffffff',
    published_at: '2026-11-13',
    first_seen_at: '2026-11-13T18:30:00+08:00',
    last_verified_at: '2026-11-13T18:30:00+08:00',
  });
  assert.ok(compareJobsByNewest(laterLargeId, earlierSmallId, checkNow) < 0);

  const sorted = applyPersonalView(
    [earlierSmallId, laterLargeId],
    { ...defaultFilters, city: '全部城市', workCities: [], year: '全部', sort: 'newest' },
    {},
    checkNow,
  );
  assert.deepEqual(sorted.map((item) => item.id), [laterLargeId.id, earlierSmallId.id]);
});

void test('buildBrowseIndex puts genuine new jobs before ATS-bumped stale jobs and stays idempotent', () => {
  const sha = (buf: string | Buffer) => createHash('sha256').update(buf).digest('hex');
  const root = mkdtempSync(join(tmpdir(), 'job-radar-pub-order-'));
  try {
    mkdirSync(join(root, 'job-assets'));
    const bumpedOld = fixtureJob({
      id: '00000000000000000002',
      title: '老岗位刷日期',
      company: '大厂A',
      published_at: '2026-11-13',
      first_seen_at: '2026-09-15T09:00:00+08:00',
      updated_at: '2026-10-01T09:00:00+08:00',
      last_verified_at: '2026-11-13T18:00:00+08:00',
    });
    const fresh = fixtureJob({
      id: 'fffffffffffffffffff1',
      title: '今日新发岗位',
      company: '单位B',
      published_at: '2026-11-13',
      first_seen_at: '2026-11-13T16:00:00+08:00',
      updated_at: '2026-11-13T16:00:00+08:00',
      last_verified_at: '2026-11-13T16:00:00+08:00',
    });
    const idxBytes = JSON.stringify({ jobs: [bumpedOld, fresh] });
    const idxPath = `/job-assets/index-${sha(idxBytes).slice(0, 20)}.json`;
    writeFileSync(join(root, idxPath), idxBytes);
    const searchBytes = JSON.stringify({ jobs: { [bumpedOld.id]: '老岗位', [fresh.id]: '新岗位' } });
    const searchPath = `/job-assets/search-${sha(searchBytes).slice(0, 20)}.json`;
    writeFileSync(join(root, searchPath), searchBytes);

    const meta = {
      schema_version: 3,
      generated_at: '2026-11-13T21:53:22+08:00',
      jobs: [],
      sources: [],
      index_count: 2,
      index_shards: [idxPath],
      search_url: searchPath,
      detail_shards: {},
    };
    const metaBytes = JSON.stringify(meta);
    writeFileSync(join(root, 'jobs.json'), metaBytes);
    writeFileSync(join(root, 'snapshot-manifest.json'), JSON.stringify({ index_sha256: sha(metaBytes), generated_at: meta.generated_at }));

    buildBrowseIndex(root);
    const firstSnap = readFileSync(join(root, 'jobs.json'));
    const parsed = JSON.parse(firstSnap.toString()) as Snapshot;
    const shard = JSON.parse(readFileSync(join(root, parsed.browse_index!.shards[0]), 'utf8')) as { jobs: Job[] };
    assert.deepEqual(shard.jobs.map((j) => j.id), [fresh.id, bumpedOld.id]);

    buildBrowseIndex(root);
    assert.deepEqual(readFileSync(join(root, 'jobs.json')), firstSnap);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
