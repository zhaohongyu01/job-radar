import { test } from 'node:test';
import assert from 'node:assert/strict';
import { talkDateLabel, talkEventsForCity } from '../lib/talk-events.ts';
import { agendaEntries, defaultAgenda } from '../lib/agenda.ts';
import { projectBrowsingJobs } from '../lib/browse-index.ts';
import { defaultFilters, effectiveEventCity, filterJobs, mergeDuplicateOpportunities } from '../lib/jobs.ts';
import type { Job, TalkEvent } from '../lib/jobs.ts';

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
  // Legacy preferences explicitly opt into local talks; expired talks no longer
  // keep an unrelated work city visible forever.
  const visible = filterJobs(merged, { ...defaultFilters, city: '济南', locationScope: 'exact', includeRelatedTalks: true }, {}, null, Date.parse('2026-09-22T12:00:00+08:00'));
  assert.deepEqual(visible.map((row) => row.id), ['campaign']);
  assert.deepEqual(filterJobs(merged, { ...defaultFilters, city: '北京', locationScope: 'exact' }, {}, null), []);
});

await test('Qingdao Agricultural University Chengyang campus resolves to Qingdao while SDU air talks stay online', () => {
  const now = Date.parse('2026-11-25T10:00:00+08:00');
  const qauChengyang: TalkEvent = {
    id: 'qau-cy',
    date: '2026-11-28',
    start_time: '14:00',
    end_time: '16:00',
    city: null,
    school: '青岛农业大学',
    venue: '文经楼 A102【城阳校区】',
    mode: 'offline',
    url: 'https://example.org/qau-cy',
  };
  const qauLaiyang: TalkEvent = {
    id: 'qau-ly',
    date: '2026-11-29',
    start_time: '09:30',
    end_time: '11:30',
    city: null,
    school: '青岛农业大学',
    venue: '教学楼201【莱阳校区】',
    mode: 'offline',
    url: 'https://example.org/qau-ly',
  };
  const sduOnline: TalkEvent = {
    id: 'sdu-air',
    date: '2026-11-28',
    start_time: '19:00',
    end_time: '20:30',
    city: null,
    school: '山东大学',
    venue: '空中宣讲',
    mode: 'online',
    url: 'https://example.org/sdu-air',
  };

  assert.equal(effectiveEventCity(qauChengyang), '青岛');
  assert.equal(effectiveEventCity(qauLaiyang), '烟台');
  assert.equal(effectiveEventCity(sduOnline), null);

  const talkJobs: Job[] = [
    {
      ...job,
      id: 'qau-talk-job',
      title: '某牧业集团校园宣讲会',
      company: '某牧业集团',
      source_id: 'qau-talks',
      source_name: '青岛农业大学 · 宣讲会',
      source_url: 'https://example.org/qau-cy',
      kind: '宣讲会',
      cities: [],
      location_evidence: [],
      types: ['校招'],
      graduation_years: ['2027'],
      sectors: ['企业 / 其他'],
      directions: [],
      education: '本科',
      deadline: null,
      published_at: '2026-11-20',
      excerpt: '宣讲日程',
      first_seen_at: '2026-11-20T00:00:00Z',
      updated_at: '2026-11-20T00:00:00Z',
      last_verified_at: '2026-11-20T00:00:00Z',
      revision: 1,
      application_url: null,
      deadline_precision: null,
      talk_event: qauChengyang,
      talk_events: [qauChengyang, qauLaiyang],
    },
    {
      ...job,
      id: 'sdu-air-job',
      title: '某科技集团空中宣讲会',
      company: '某科技集团',
      source_id: 'sdu-talks',
      source_name: '山东大学 · 宣讲会',
      source_url: 'https://example.org/sdu-air',
      kind: '宣讲会',
      cities: [],
      location_evidence: [],
      types: ['校招'],
      graduation_years: ['2027'],
      sectors: ['企业 / 其他'],
      directions: [],
      education: '本科',
      deadline: null,
      published_at: '2026-11-20',
      excerpt: '线上宣讲',
      first_seen_at: '2026-11-20T00:00:00Z',
      updated_at: '2026-11-20T00:00:00Z',
      last_verified_at: '2026-11-20T00:00:00Z',
      revision: 1,
      application_url: null,
      deadline_precision: null,
      talk_event: sduOnline,
      talk_events: [sduOnline],
    },
  ];

  const qdEntries = agendaEntries(talkJobs, {}, defaultAgenda('青岛'), now);
  assert.deepEqual(qdEntries.map((entry) => entry.event.id), ['qau-cy']);
  assert.equal(qdEntries[0].event.city, '青岛');

  const jnEntries = agendaEntries(talkJobs, {}, defaultAgenda('济南'), now);
  assert.deepEqual(jnEntries, []);

  const { jobs: projected } = projectBrowsingJobs(talkJobs);
  assert.equal(projected[0].talk_event?.city, '青岛');
  assert.equal(projected[1].talk_event?.city, null);
});
