import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultFilters, filterJobs, personalFor, validatePersonal, locationMatch, isExpired } from '../lib/jobs.ts';
import type { Job } from '../lib/jobs.ts';
import validityCases from './fixtures/opportunity-validity.json' with { type: 'json' };
import { citiesInText, ALL_CITIES } from '../lib/cities.ts';
import { restoreBrowsing } from '../lib/browsing.ts';
import { fixtureJob } from './fixtures/job.ts';
import { assessOpportunityValidity } from '../lib/opportunity-validity.ts';
import { agendaEntries, defaultAgenda, eventChanged, restoreAgenda } from '../lib/agenda.ts';

const now = Date.parse('2026-10-25T11:52:51.364+08:00');

await test('expanded city dictionary matches explicit cities without province and campus homonyms', () => {
  for (const city of ['无锡', '常州', '南通', '泉州', '温州', '呼和浩特']) assert.ok(ALL_CITIES.includes(city));
  assert.deepEqual(citiesInText('吉林省'), []);
  assert.deepEqual(citiesInText('千佛山校区'), []);
  assert.deepEqual(citiesInText('朝阳区', true), []);
  assert.deepEqual(citiesInText('北京市大兴区', true), ['北京']);
});

await test('cached location parsing does not share mutable output or retain replaced job facts', () => {
  const first = citiesInText('工作地点：北京、上海');
  first.splice(0);
  assert.deepEqual(citiesInText('工作地点：北京、上海'), ['北京', '上海']);
  const job = fixtureJob({ cities: [], location_evidence: ['工作地点：北京'] });
  assert.equal(locationMatch(job, '上海'), 'none');
  job.location_evidence = ['工作地点：上海'];
  assert.equal(locationMatch(job, '上海'), 'exact');
});

await test('shared validity cases retain date-only China deadlines and conservative evidence semantics', () => {
  for (const entry of validityCases) {
    const job = fixtureJob(entry.job as Partial<Job>);
    const at = Date.parse(entry.now);
    assert.equal(assessOpportunityValidity(job, at).status, entry.status, entry.name);
    if (job.deadline || job.listing_status === 'withdrawn') assert.equal(isExpired(job, at), entry.status === 'closed', entry.name);
  }
});

await test('multiple work cities are OR matched without duplicates; qualification constraints use the same position', () => {
  const job = fixtureJob({ cities: ['北京', '上海'], position_matches: [
    { name: '研发', city: '北京', majors: ['计算机'], education: '本科', cohort: '2027' },
    { name: '财务', city: '上海', majors: ['会计'], education: '本科', cohort: '2027' },
  ] });
  assert.equal(filterJobs([job], { ...defaultFilters, workCities: ['北京', '上海'] }, {}, null, now).length, 1);
  assert.equal(filterJobs([job], { ...defaultFilters, workCities: ['北京'], major: '会计', includeUncertain: false }, {}, null, now).length, 0);
  assert.equal(filterJobs([job], { ...defaultFilters, workCities: ['上海'], major: '会计', includeUncertain: false }, {}, null, now).length, 1);
  const old = restoreBrowsing({ filters: { city: '青岛' } }).filters;
  assert.equal(old.city, '青岛'); assert.equal(old.includeRelatedTalks, true);
});

await test('old records without closure evidence stay unconfirmed; cache reads do not imply confirmed hiring', () => {
  const old = fixtureJob({ last_verified_at: '2025-01-01T00:00:00Z', published_at: '2025-01-01' });
  assert.equal(assessOpportunityValidity(old, now).status, 'unconfirmed');
  const open = fixtureJob({ availability_evidence: { kind: 'open', text: '招聘状态：招聘中', checked_at: '2026-10-24T00:00:00Z', verified: true } });
  assert.equal(assessOpportunityValidity(open, now).status, 'confirmed_open');
  assert.equal(assessOpportunityValidity({ ...open, listing_status: 'withdrawn' }, now).status, 'closed');
  assert.equal(assessOpportunityValidity({ ...open, deadline: '2026-10-20T23:59:00+08:00' }, now).status, 'closed');
});

await test('agenda city is independent; cancelled events remain in saved agenda and changes are visible', () => {
  const event = { id: 'event-one', date: '2026-10-27', start_time: '14:00', school: '南开大学', venue: '津南校区', city: '天津', url: 'https://example.org/event', status: 'scheduled' as const };
  const job = fixtureJob({ talk_events: [event] });
  const filters = restoreAgenda({ ...defaultAgenda('天津') }, '北京');
  assert.equal(filters.city, '天津');
  assert.equal(agendaEntries([job], {}, filters, now).length, 1);
  assert.equal(agendaEntries([job], {}, { ...filters, city: '北京' }, now).length, 0);
  const cancelled = { ...event, status: 'cancelled' as const };
  const saved = { [event.id]: { saved: true, observed: { date: event.date, start_time: event.start_time, venue: event.venue, status: 'scheduled' } } };
  assert.equal(agendaEntries([{ ...job, talk_events: [cancelled] }], {}, filters, now).length, 0);
  assert.equal(agendaEntries([{ ...job, talk_events: [cancelled] }], {}, filters, now, saved, true).length, 1);
  assert.equal(eventChanged(cancelled, saved[event.id]), true);
});

await test('duplicate IDs retain personal notes and legacy applied dates remain unknown', () => {
  const duplicate = 'abcdef0123456789abcd';
  const job = fixtureJob({ duplicate_ids: [duplicate] });
  const records = validatePersonal({ [duplicate]: { applied: true, notes: '技术面材料', application_stage: 'interview', next_action_at: '2026-10-27T06:00:00.000Z' } });
  assert.equal(personalFor(job, records).notes, '技术面材料');
  assert.equal(personalFor(job, records).applied_at, undefined);
  assert.equal(personalFor(job, records).application_stage, 'interview');
});
