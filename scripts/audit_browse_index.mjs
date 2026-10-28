// Offline acceptance: compare actual frontend behavior on one canonical snapshot.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { defaultFilters, filterJobs, getLifecycleStage, hasRecentJobChange, parseSalaryRange,
  mergeDuplicateOpportunities, duplicateSourceNames, UNKNOWN_SECTOR } from '../lib/jobs.ts';
import { extractSalary } from '../lib/salary-display.ts';
import { agendaEntries, defaultAgenda } from '../lib/agenda.ts';

export function auditBrowseIndex(directory) {
  const load = (path) => JSON.parse(readFileSync(join(directory, path)));
  const snapshot = load('jobs.json'), browse = snapshot.browse_index;
  assert.equal(browse?.version, 1);
  const canonical = snapshot.index_shards?.length ? snapshot.index_shards.flatMap(path => load(path).jobs) : snapshot.jobs;
  const before = mergeDuplicateOpportunities(structuredClone(canonical));
  const after = browse.shards.flatMap(path => load(path).jobs);
  assert.equal(after.length, browse.count);
  assert.deepEqual(after.map(j => j.id), before.map(j => j.id));
  const search = (paths) => Object.assign({}, ...paths.map(path => load(path).jobs));
  const originalText = search([snapshot.search_url, ...(snapshot.search_shards || [])]);
  const browsingText = search(browse.search_shards);
  const now = Date.parse(snapshot.generated_at);
  for (let i = 0; i < before.length; i++) {
    const a = before[i], b = after[i];
    assert.deepEqual(parseSalaryRange(b), parseSalaryRange(a), `${a.id}: salary filter`);
    assert.deepEqual(extractSalary(b), extractSalary(a), `${a.id}: salary display`);
    assert.deepEqual(duplicateSourceNames(b), duplicateSourceNames(a), `${a.id}: sources`);
    assert.deepEqual(b.duplicate_ids, a.duplicate_ids, `${a.id}: personal identities`);
    assert.ok(browsingText[b.id].includes(a.excerpt || ''), `${a.id}: complete excerpt remains searchable`);
    for (const time of [now, now + 86400000 * 45]) {
      assert.deepEqual(getLifecycleStage(b, time), getLifecycleStage(a, time), `${a.id}: lifecycle`);
      assert.equal(hasRecentJobChange(b, time), hasRecentJobChange(a, time), `${a.id}: recent change`);
    }
  }
  const base = { ...defaultFilters, city: '全部城市', workCities: [], year: '全部' };
  const cases = [base, { ...base, workCities: ['北京', '上海'], major: '计算机', education: '本科' }];
  for (const city of ['济南', '青岛', '北京', '上海', '深圳', '成都'])
    for (const locationScope of ['exact', 'possible', 'unknown']) cases.push({ ...base, city, workCities: [city], locationScope });
  for (const sector of [UNKNOWN_SECTOR, '企业 / 其他', '国企', '银行']) cases.push({ ...base, sector });
  for (const salary of ['6K以上', '10K以上', '20K以上']) cases.push({ ...base, salary });
  for (const validity of ['confirmed_open', 'unconfirmed', 'long_term']) cases.push({ ...base, validity });
  for (const changeType of ['有变更', '截止延期', '补录招募', '岗位调整', '考核阶段']) cases.push({ ...base, changeType });
  for (const sort of ['newest', 'deadline_asc', 'salary_desc']) cases.push({ ...base, sort });
  for (const filters of cases)
    assert.deepEqual(filterJobs(after, filters, {}, null, now).map(j => j.id), filterJobs(before, filters, {}, null, now).map(j => j.id), JSON.stringify(filters));
  const searchedBefore = before.map(j => ({ ...j, search_text: originalText[j.id] }));
  const searchedAfter = after.map(j => ({ ...j, search_text: browsingText[j.id] }));
  for (const query of ['计算机', '财务', '银行', '长期招聘', '海信', '薪资', '面试', '软件 本科'])
    assert.deepEqual(filterJobs(searchedAfter, { ...base, query }, {}, null, now).map(j => j.id),
      filterJobs(searchedBefore, { ...base, query }, {}, null, now).map(j => j.id), query);
  for (const city of ['全部城市', '济南', '青岛', '北京', '天津', '上海', '深圳', '成都'])
    assert.deepEqual(agendaEntries(after, {}, defaultAgenda(city), now).map(e => e.event), agendaEntries(before, {}, defaultAgenda(city), now).map(e => e.event), city);
  const metrics = (paths) => {
    const sizes = paths.map(path => { const bytes = readFileSync(join(directory, path)); return { raw: bytes.length, gzip: gzipSync(bytes).length }; });
    return { shards: paths.length, raw_bytes: sizes.reduce((n, x) => n + x.raw, 0), gzip_bytes: sizes.reduce((n, x) => n + x.gzip, 0), first: sizes[0] };
  };
  return { generated_at: snapshot.generated_at, canonical_records: canonical.length, browsing_records: after.length,
    per_record_facts_equal: true, filter_cases: cases.length, search_cases: 8, agenda_cities: 8,
    canonical: snapshot.index_shards?.length ? metrics(snapshot.index_shards) : null, browsing: metrics(browse.shards), network_requests: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--public-dir' || args[2] !== '--report') throw Error('Use --public-dir DIR --report FILE');
  const result = auditBrowseIndex(args[1]);
  writeFileSync(args[3], JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
