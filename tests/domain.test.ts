import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  filterJobs,
  defaultFilters,
  validatePersonal,
  externalUrl,
  locationMatch,
  personalFor,
} from '../lib/jobs.ts';
import type { Job } from '../lib/jobs.ts';
const job = {
  id: '0123456789abcdef0123',
  title: '财务',
  company: '某单位',
  body: '经济学',
  cities: ['济南'],
  possible_cities: [],
  province_possible: false,
  types: ['校招'],
  graduation_years: ['2027'],
  education: '本科',
  sectors: ['国企'],
  directions: ['财务 / 经济'],
  deadline: null,
  published_at: '2026-09-01',
  first_seen_at: '2026-09-02T00:00:00Z',
  updated_at: '2026-09-02T00:00:00Z',
} as unknown as Job;
void test('repost folding preserves personal records and supports clearing them', () => {
  const folded={...job, duplicate_ids:['old-copy']};
  const personal={'old-copy':{saved:true}};
  assert.equal(filterJobs([folded],{...defaultFilters,view:'saved'},personal,null).length,1);
  assert.equal(personalFor(folded,personal).saved,true);
  assert.equal(personalFor(folded,{...personal,[folded.id]:{saved:false}}).saved,false);
});
void test('third-party metadata can be excluded without losing primary sources', () => {
  const secondary={...job,provenance:'第三方线索'};
  assert.equal(filterJobs([secondary],{...defaultFilters,provenance:'高校 / 政府'}, {}, null).length,0);
  assert.equal(filterJobs([job],{...defaultFilters,provenance:'高校 / 政府'}, {}, null).length,1);
});
void test('newest publication comes first; unknown date last', () => {
  const newer = { ...job, id: 'newer', published_at: '2026-09-09' };
  const undated = { ...job, id: 'undated', published_at: null };
  assert.deepEqual(
    filterJobs([job, undated, newer], defaultFilters, {}, null).map(
      (j) => j.id,
    ),
    ['newer', job.id, 'undated'],
  );
});
void test('city scope is independent of unknown qualifications', () => {
  const unknown = { ...job, cities: [], location_evidence: [], types: [] };
  assert.equal(filterJobs([unknown], defaultFilters, {}, null).length, 0);
  assert.equal(
    filterJobs(
      [unknown],
      { ...defaultFilters, locationScope: 'unknown' },
      {},
      null,
    ).length,
    1,
  );
  const regional = {
    ...unknown,
    location_evidence: ['工作地点：山东省分行辖属各分支机构'],
  };
  assert.equal(locationMatch(regional, '济南'), 'possible');
  assert.equal(locationMatch(regional, '青岛'), 'possible');
  assert.equal(locationMatch(regional, '广州'), 'none');
  assert.equal(
    filterJobs(
      [regional],
      { ...defaultFilters, locationScope: 'possible' },
      {},
      null,
    ).length,
    1,
  );
});
void test('headquarters and unrelated city mentions never imply recruitment location', () => {
  const elsewhere = {
    ...job,
    cities: ['北京'],
    possible_cities: ['济南'],
    province_possible: true,
    location_evidence: ['工作地点：北京'],
  };
  assert.equal(locationMatch(elsewhere, '济南'), 'none');
  assert.equal(
    locationMatch({ ...elsewhere, cities: [], location_evidence: [] }, '济南'),
    'unknown',
  );
});
void test('real snapshot: Guangdong excluded from every Jinan scope; bank remains unconfirmed', () => {
  const { jobs } = JSON.parse(
    readFileSync(new URL('../public/jobs.json', import.meta.url), 'utf8'),
  ) as { jobs: Job[] };
  const tor = jobs.find((j) => j.title === '图拉斯 2027校园招聘')!;
  const bank = jobs.find(
    (j) => j.title === '中国工商银行股份有限公司威海分行招聘',
  )!;
  assert.ok(tor);
  assert.ok(bank);
  assert.equal(locationMatch(tor, '济南'), 'none');
  assert.equal(locationMatch(tor, '广州'), 'possible');
  assert.equal(locationMatch(bank, '济南'), 'possible');
  for (const locationScope of ['exact', 'possible', 'unknown'] as const) {
    assert.equal(
      filterJobs([tor], { ...defaultFilters, locationScope }, {}, null).length,
      0,
    );
  }
  const matched = filterJobs(jobs, defaultFilters, {}, null);
  assert.ok(matched.length > 0);
  assert.ok(matched.every((j) => j.cities.includes('济南')));
});
void test('default shows opportunities without requesting personal qualifications', () =>
  assert.equal(filterJobs([job], defaultFilters, {}, null).length, 1));
void test('province inside a specific address does not imply other cities', () => {
  for (const address of ['山东威海', '山东省青岛市崂山区国际创新园', '山东 威海']) {
    assert.equal(locationMatch({ ...job, cities: ['威海','青岛'], location_evidence: [`工作地点：${address}`] }, '济南'), 'none');
  }
  assert.equal(locationMatch({ ...job, cities: ['北京','南京'], location_evidence: ['北京市 / 山东省 / 江苏省', '工作地点\n北京、南京'] }, '济南'), 'none');
  assert.equal(locationMatch({ ...job, cities: [], location_evidence: ['山东省 / 广东省'] }, '济南'), 'possible');
});
void test('campus cohort and social switch respect classification', () => {
  assert.equal(
    filterJobs(
      [job],
      { ...defaultFilters, type: '校招', year: '2026' },
      {},
      null,
    ).length,
    0,
  );
  assert.equal(
    filterJobs([job], { ...defaultFilters, type: '社招' }, {}, null).length,
    0,
  );
});
void test('unknown eligibility remains visible when requested', () => {
  const unknown = { ...job, types: [], graduation_years: [] };
  assert.equal(
    filterJobs([unknown], { ...defaultFilters, type: '校招' }, {}, null).length,
    1,
  );
  assert.equal(
    filterJobs(
      [unknown],
      { ...defaultFilters, type: '校招', includeUncertain: false },
      {},
      null,
    ).length,
    0,
  );
});
void test('expired announcement is not shown as open', () => {
  assert.equal(
    filterJobs(
      [{ ...job, deadline: '2026-01-01T00:00:00+08:00' }],
      defaultFilters,
      {},
      null,
      Date.parse('2026-09-09'),
    ).length,
    0,
  );
});
void test('hidden opportunities remain recoverable', () => {
  const personal = { [job.id]: { hidden: true } };
  assert.equal(filterJobs([job], defaultFilters, personal, null).length, 0);
  assert.equal(
    filterJobs([job], { ...defaultFilters, view: 'hidden' }, personal, null)
      .length,
    1,
  );
});
void test('import rejects malicious or invalid properties', () => {
  assert.throws(() =>
    validatePersonal(JSON.parse('{"__proto__":{"saved":true}}')),
  );
  assert.throws(() => validatePersonal({ [job.id]: { saved: 'yes' } }));
  assert.deepEqual(validatePersonal({ [job.id]: { saved: true } })[job.id], {
    saved: true,
    applied: false,
    hidden: false,
  });
});
void test('unsafe application URL never renders as executable link', () => {
  assert.equal(externalUrl('javascript:alert(1)'), undefined);
  assert.equal(
    externalUrl('https://example.com/apply'),
    'https://example.com/apply',
  );
});
