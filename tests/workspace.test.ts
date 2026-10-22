import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildActionQueue,
  personalViewFilters,
  upcomingTalks,
} from '../lib/workspace.ts';
import {
  defaultFilters,
  filterJobs,
  mergeDuplicateOpportunities,
} from '../lib/jobs.ts';
import { computeRadarMetrics } from '../lib/radar.ts';
import type { Job, Personal, TalkEvent } from '../lib/jobs.ts';

const now = Date.parse('2026-10-22T10:00:00+08:00');
const base: Job = {
  id: 'job',
  title: '研发工程师',
  company: '示例企业',
  source_id: 'school',
  source_name: '高校就业网',
  source_url: 'https://example.org/job',
  kind: '具体岗位',
  published_at: '2026-10-20',
  cities: ['济南'],
  location_evidence: [],
  types: ['校招'],
  graduation_years: ['2027'],
  sectors: [],
  directions: [],
  education: '本科',
  deadline: null,
  deadline_precision: null,
  application_url: null,
  excerpt: '',
  first_seen_at: '2026-10-20T00:00:00Z',
  updated_at: '2026-10-20T00:00:00Z',
  last_verified_at: '2026-10-20T00:00:00Z',
  revision: 1,
};

void test('saved jobs in another city and expired jobs remain reachable from personal views', () => {
  const job = {
    ...base,
    cities: ['青岛'],
    deadline: '2026-10-01T00:00:00+08:00',
  };
  const personal = { job: { saved: true } };
  assert.equal(
    filterJobs([job], defaultFilters, personal, null, now).length,
    0,
  );
  assert.deepEqual(
    filterJobs([job], personalViewFilters('saved'), personal, null, now).map(
      (j) => j.id,
    ),
    ['job'],
  );
});

void test('action queue prioritizes deadlines and respects duplicate saved state, applied, hidden and expired records', () => {
  const jobs = mergeDuplicateOpportunities(
    [
      { ...base, id: 'unknown' },
      {
        ...base,
        id: 'soon',
        duplicate_ids: ['old-source'],
        deadline: '2026-10-23T10:00:00+08:00',
      },
      { ...base, id: 'later', deadline: '2026-10-30T10:00:00+08:00' },
      { ...base, id: 'applied' },
      { ...base, id: 'hidden' },
      { ...base, id: 'expired', deadline: '2026-10-21T10:00:00+08:00' },
    ].map((job) => ({
      ...job,
      title: `${job.id}岗位`,
      source_url: `https://example.org/${job.id}`,
    })),
  );
  const personal: Personal = {
    unknown: { saved: true },
    'old-source': { saved: true },
    later: { saved: true },
    applied: { saved: true, applied: true },
    hidden: { saved: true, hidden: true },
    expired: { saved: true },
  };
  assert.deepEqual(
    buildActionQueue(jobs, personal, now).map((j) => j.id),
    ['soon', 'later', 'unknown'],
  );
});

void test('campus agenda uses event city, hides ended sessions and deduplicates attached sources', () => {
  const event: TalkEvent = {
    id: 'talk',
    date: '2026-10-22',
    start_time: '14:00',
    end_time: '16:00',
    city: '济南',
    school: '示例大学',
    venue: '报告厅',
    url: 'https://example.org/talk',
  };
  const campaign = {
    ...base,
    cities: ['北京'],
    talk_events: [
      event,
      { ...event, id: 'past', date: '2026-10-21' },
      { ...event, id: 'other', city: '青岛' },
    ],
  };
  const source = {
    ...base,
    id: 'source',
    talk_attached_to: 'job',
    talk_event: event,
  };
  const agenda = upcomingTalks([source, campaign], {}, '济南', now);
  assert.equal(agenda.length, 1);
  assert.equal(agenda[0].job.id, 'job');
  assert.equal(upcomingTalks([campaign], {}, '北京', now).length, 0);
  assert.equal(
    upcomingTalks([campaign], { job: { hidden: true } }, '济南', now).length,
    0,
  );
});

void test('radar totals and results agree for UTC timestamps across midnight in China and metadata-only supplements', () => {
  const jobs = [
    { ...base, id: 'today', first_seen_at: '2026-10-21T17:00:00Z' },
    { ...base, id: 'yesterday', first_seen_at: '2026-10-21T15:00:00Z' },
    { ...base, id: 'supplement', lifecycle_stage: 'supplemental' as const },
  ];
  const metrics = computeRadarMetrics(jobs, now);
  assert.equal(metrics.todayCount, 1);
  assert.equal(metrics.supplementCount, 1);
  for (const [focus, count] of [
    ['today', metrics.todayCount],
    ['supplement', metrics.supplementCount],
  ] as const) {
    assert.equal(
      filterJobs(jobs, { ...defaultFilters, radarFocus: focus }, {}, null, now)
        .length,
      count,
    );
  }
});
