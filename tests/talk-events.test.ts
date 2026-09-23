import { test } from 'node:test';
import assert from 'node:assert/strict';
import { talkDateLabel, talkEventsForCity } from '../lib/talk-events.ts';
import { defaultFilters, filterJobs, mergeDuplicateOpportunities } from '../lib/jobs.ts';
import type { Job } from '../lib/jobs.ts';

const job = {
  talk_events: [
    { id: 'a', date: '2026-09-22', start_time: '14:00', end_time: '15:00', city: '济南', school: '山东财经大学', venue: '舜耕校区', url: 'https://example.org/a' },
    { id: 'b', date: '2026-09-24', start_time: '15:30', end_time: '17:20', city: '济南', school: '山东财经大学', venue: '燕山校区', url: 'https://example.org/b' },
    { id: 'c', date: '2026-09-23', start_time: '09:00', end_time: '10:00', city: '青岛', school: '青岛大学', venue: '报告厅', url: 'https://example.org/c' },
  ],
} as Job;

await test('talk events follow selected city and put upcoming dates before ended ones', () => {
  const now = Date.parse('2026-09-23T12:00:00+08:00');
  assert.deepEqual(talkEventsForCity(job, '济南', now).map((event) => event.id), ['b', 'a']);
  assert.deepEqual(talkEventsForCity(job, '青岛', now).map((event) => event.id), ['c']);
  assert.deepEqual(talkEventsForCity(job, '北京', now), []);
  assert.equal(talkDateLabel(job.talk_events![1]), '2026年9月24日 15:30–17:20');
});

await test('attached talks collapse to a campaign and an event city can match independently of work city', () => {
  const campaign = {
    ...job, id: 'campaign', title: '中国重汽秋招', company: '中国重汽',
    source_id: 'offerjack', source_url: 'https://example.org/jobs', kind: '招聘公告',
    cities: ['青岛'], location_evidence: ['工作地点：青岛'],
    types: ['校招'], graduation_years: ['2027'], sectors: ['国企'], directions: [],
    education: '本科', deadline: null, published_at: '2026-09-20',
    first_seen_at: '2026-09-20T00:00:00Z', updated_at: '2026-09-20T00:00:00Z',
  } as Job;
  const talk = { ...campaign, id: 'talk', title: '中国重汽宣讲会',
    source_id: 'jobsdufe-talks', talk_events: undefined, talk_attached_to: 'campaign' };
  const merged = mergeDuplicateOpportunities([campaign, talk]);
  assert.equal(merged.length, 2);
  const visible = filterJobs(merged, { ...defaultFilters, city: '济南', locationScope: 'exact' }, {}, null);
  assert.deepEqual(visible.map((row) => row.id), ['campaign']);
  assert.deepEqual(filterJobs(merged, { ...defaultFilters, city: '北京', locationScope: 'exact' }, {}, null), []);
});
