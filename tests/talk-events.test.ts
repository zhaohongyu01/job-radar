import { test } from 'node:test';
import assert from 'node:assert/strict';
import { talkDateLabel, talkEventsForCity } from '../lib/talk-events.ts';
import { agendaEntries, defaultAgenda, normalizeVenueForDedup } from '../lib/agenda.ts';
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

await test('agendaEntries deduplicates equivalent campus rooms while keeping distinct parallel rooms separate', () => {
  const now = Date.parse('2026-11-27T09:20:00+08:00');
  assert.equal(
    normalizeVenueForDedup('舜耕校区6号教学楼114教室', '山东财经大学'),
    normalizeVenueForDedup('舜耕校区6教114教室', '山东财经大学'),
  );
  assert.equal(
    normalizeVenueForDedup('舜耕校区第六教学楼114', '山东财经大学'),
    normalizeVenueForDedup('舜耕校区6教114室', '山东财经大学'),
  );
  assert.notEqual(
    normalizeVenueForDedup('面试专用-就业中心401-1室【主校区】', '济南大学'),
    normalizeVenueForDedup('面试专用-就业中心401-2室【主校区】', '济南大学'),
  );

  const makeTalkJob = (
    id: string,
    title: string,
    school: string,
    venue: string,
    eventType: TalkEvent['event_type'],
    company = '',
  ): Job => ({
    ...job,
    id,
    title,
    company,
    source_id: 'jobsdufe-talks',
    source_name: `${school} · 宣讲会招聘`,
    source_url: `https://example.org/${id}`,
    kind: '招聘公告',
    cities: [],
    location_evidence: [],
    types: ['校招'],
    graduation_years: ['2027'],
    sectors: ['保险'],
    directions: [],
    education: '本科',
    deadline: null,
    published_at: '2026-11-25',
    excerpt: '宣讲会',
    first_seen_at: '2026-11-25T23:19:00+08:00',
    updated_at: '2026-11-26T22:53:00+08:00',
    last_verified_at: '2026-11-26T22:53:00+08:00',
    revision: 1,
    application_url: null,
    deadline_precision: null,
    talk_events: undefined,
    talk_event: {
      id,
      date: '2026-11-30',
      start_time: '14:00',
      end_time: '16:00',
      city: '济南',
      school,
      venue,
      mode: 'offline',
      event_type: eventType,
      status: 'scheduled',
      url: `https://example.org/${id}`,
    },
  });

  // Duplicate Fuze Life talks at SDUFE (6号教学楼114教室 vs 6教114教室)
  const fuzeFull = makeTalkJob(
    'fuze-full',
    '富泽人寿保险股份有限公司宣讲会',
    '山东财经大学',
    '舜耕校区6号教学楼114教室',
    'talk',
  );
  const fuzeShort = makeTalkJob(
    'fuze-short',
    '富泽人寿保险股份有限公司宣讲会',
    '山东财经大学',
    '舜耕校区6教114教室',
    'talk',
  );

  // Parallel distinct interview rooms at UJN (401-1 vs 401-2) MUST both remain visible
  const ujnRoom1 = makeTalkJob(
    'ujn-r1',
    '（面试）山东铂源药业股份有限公司',
    '济南大学',
    '面试专用-就业中心401-1室【主校区】',
    'interview',
    '山东铂源药业股份有限公司',
  );
  const ujnRoom2 = makeTalkJob(
    'ujn-r2',
    '（面试）山东铂源药业股份有限公司',
    '济南大学',
    '面试专用-就业中心401-2室【主校区】',
    'interview',
    '山东铂源药业股份有限公司',
  );

  // Default preference: collapses Fuze duplicate and keeps fuller venue description
  const sdufeEntries = agendaEntries(
    [fuzeShort, fuzeFull],
    {},
    { ...defaultAgenda('济南'), school: '山东财经大学' },
    now,
  );
  assert.equal(sdufeEntries.length, 1);
  assert.equal(sdufeEntries[0].event.id, 'fuze-full');
  assert.equal(sdufeEntries[0].event.venue, '舜耕校区6号教学楼114教室');

  // If user saved the shorter variant earlier, keep the saved event ID so bookmark stays active
  const sdufeWithSaved = agendaEntries(
    [fuzeFull, fuzeShort],
    {},
    { ...defaultAgenda('济南'), school: '山东财经大学' },
    now,
    { 'fuze-short': { saved: true } },
  );
  assert.equal(sdufeWithSaved.length, 1);
  assert.equal(sdufeWithSaved[0].event.id, 'fuze-short');

  // Distinct interview rooms are NOT merged
  const ujnEntries = agendaEntries(
    [ujnRoom1, ujnRoom2],
    {},
    { ...defaultAgenda('济南'), school: '济南大学' },
    now,
  );
  assert.deepEqual(
    ujnEntries.map((entry) => entry.event.id).sort(),
    ['ujn-r1', 'ujn-r2'],
  );

  // talkEventsForCity also collapses equivalent rooms attached to one parent job
  const mergedCampaign = {
    ...fuzeFull,
    talk_events: [fuzeShort.talk_event!, fuzeFull.talk_event!],
  } as Job;
  const cityEvents = talkEventsForCity(mergedCampaign, '济南', now);
  assert.equal(cityEvents.length, 1);
  assert.equal(cityEvents[0].venue, '舜耕校区6号教学楼114教室');
});
