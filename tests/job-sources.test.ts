import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyActiveChannel,
  extractJobChannels,
  findMissingSiblingIds,
  mergeDetailRecords,
} from '../lib/job-sources.ts';
import type { Job } from '../lib/jobs.ts';
import { fixtureJob } from './fixtures/job.ts';

void test('findMissingSiblingIds and mergeDetailRecords hydrate all cross-shard merged sources and body facts', () => {
  const browseJob: Job = fixtureJob({
    id: '8b2ad81270c384f7655c',
    company: '山东冠龙医疗用品有限公司',
    title: '山东冠龙医疗用品有限公司（冠龙医疗集团）2026/2027届校园招聘公告',
    source_name: '齐鲁工业大学 · 招聘公告',
    source_url: 'https://qlu.example/gl-1',
    duplicate_ids: ['ba54da580a077e75234a', '16fbbafb1c2dbee87a3d', 'c1cb8334a6824647bbd7'],
    listing_facts: {
      version: 1,
      source_names: ['山东师范大学 · 招聘公告', '山东第一医科大学 · 招聘公告', '青岛大学 · 招聘公告'],
    },
  });

  const primaryDetail: Job = fixtureJob({
    id: '8b2ad81270c384f7655c',
    company: '山东冠龙医疗用品有限公司',
    title: '山东冠龙医疗用品有限公司（冠龙医疗集团）面向我校招聘',
    source_name: '齐鲁工业大学 · 招聘公告',
    source_url: 'https://qlu.example/gl-1',
    body: '齐鲁工业大学版本正文',
    duplicate_ids: ['ba54da580a077e75234a'],
    duplicate_sources: [
      {
        id: 'ba54da580a077e75234a',
        source_name: '山东师范大学 · 招聘公告',
        title: '山东师范大学 · 招聘公告',
        announcement_title: '山东冠龙面向我校招聘（山师）',
        url: 'https://sdnu.example/gl-2',
        published_at: '2026-11-25',
        facts: { body: '山师版本正文' },
      },
    ],
  });

  const siblingDetail: Job = fixtureJob({
    id: '16fbbafb1c2dbee87a3d',
    company: '山东冠龙医疗用品有限公司',
    title: '山东冠龙医疗用品有限公司（冠龙医疗集团）2026/2027届校园招聘公告',
    source_name: '山东第一医科大学 · 招聘公告',
    source_url: 'https://sdfmu.example/gl-3',
    published_at: '2026-11-25',
    body: '山一大版本正文',
    duplicate_ids: ['c1cb8334a6824647bbd7'],
    duplicate_sources: [
      {
        id: 'c1cb8334a6824647bbd7',
        source_name: '青岛大学 · 招聘公告',
        title: '青岛大学 · 招聘公告',
        announcement_title: '山东冠龙（青大专版）2026/2027届校园招聘公告',
        url: 'https://qdu.example/gl-4',
        published_at: '2026-11-24',
        application_url: 'https://apply.guanlong.example/qdu',
        facts: { body: '青大版本完整正文' },
      },
    ],
  });

  const missing = findMissingSiblingIds(browseJob, primaryDetail);
  assert.deepEqual(missing, ['16fbbafb1c2dbee87a3d', 'c1cb8334a6824647bbd7']);

  const hydrated = mergeDetailRecords(browseJob, primaryDetail, [siblingDetail]);
  assert.equal(hydrated.title, '山东冠龙医疗用品有限公司（冠龙医疗集团）2026/2027届校园招聘公告');

  const channels = extractJobChannels(hydrated);
  assert.equal(channels.length, 4);
  assert.deepEqual(
    channels.map((c) => c.sourceName),
    [
      '齐鲁工业大学 · 招聘公告',
      '山东师范大学 · 招聘公告',
      '山东第一医科大学 · 招聘公告',
      '青岛大学 · 招聘公告',
    ],
  );
  assert.equal(channels[2].body, '山一大版本正文');
  assert.equal(channels[3].title, '山东冠龙（青大专版）2026/2027届校园招聘公告');
  assert.equal(channels[3].body, '青大版本完整正文');

  // Switching to Qingdao University channel projects its URL/title/body without mutating canonical id.
  const switched = applyActiveChannel(hydrated, 'https://qdu.example/gl-4');
  assert.equal(switched.activeChannel.isPrimary, false);
  assert.equal(switched.jobView.id, hydrated.id);
  assert.equal(switched.jobView.source_name, '青岛大学 · 招聘公告');
  assert.equal(switched.jobView.source_url, 'https://qdu.example/gl-4');
  assert.equal(switched.jobView.application_url, 'https://apply.guanlong.example/qdu');
  assert.equal(switched.jobView.body, '青大版本完整正文');
  assert.equal(hydrated.source_url, 'https://qlu.example/gl-1');
});

void test('extractJobChannels falls back to preview source names before detail shard loads', () => {
  const browseOnly: Job = fixtureJob({
    id: 'browse-1',
    source_name: '齐鲁工业大学 · 招聘公告',
    source_url: 'https://qlu.example/1',
    duplicate_sources: undefined,
    listing_facts: {
      version: 1,
      source_names: ['青岛大学 · 招聘公告', '烟台大学 · 招聘公告'],
    },
  });

  const channels = extractJobChannels(browseOnly);
  assert.equal(channels.length, 3);
  assert.equal(channels[0].isPrimary, true);
  assert.equal(channels[0].previewOnly, undefined);
  assert.equal(channels[1].previewOnly, true);
  assert.equal(channels[1].sourceName, '青岛大学 · 招聘公告');
  assert.equal(channels[2].previewOnly, true);
  assert.equal(channels[2].sourceName, '烟台大学 · 招聘公告');

  // Selecting a preview-only entry safely stays on primary until detail URLs hydrate.
  const unchanged = applyActiveChannel(browseOnly, channels[1].key);
  assert.equal(unchanged.activeChannel.isPrimary, true);
  assert.equal(unchanged.jobView.source_url, 'https://qlu.example/1');
});
