import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureJob } from './fixtures/job.ts';
import { employerFromId, employerLabel, employerResearchLinks, resolveEmployer } from '../lib/employers.ts';
import { commitEmployerPatch, EMPLOYER_PERSONAL_STORAGE, employerRecordConflicts,
  mergeEmployerRecords, readEmployerRecords, validateEmployerRecords } from '../lib/employer-personal.ts';
import { createBackup, PERSONAL_STORAGE, validateBackup, writeBackup } from '../lib/personal-backup.ts';
import type { EmployerRecord } from '../lib/employer-personal.ts';

const entity = resolveEmployer(fixtureJob({ company: '示例科技有限公司' }))!;
const earlier = '2026-10-28T00:00:00Z', later = '2026-10-29T00:00:00Z';
const record: EmployerRecord = { rating: 4, notes: '确认双休再投递', updated_at: later };
function memory() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

await test('full employer names share across sources but preserve branch and company suffix identity', () => {
  const base = fixtureJob({ company: '示例科技有限公司' });
  const original = JSON.stringify(base);
  assert.equal(resolveEmployer(base)?.id, resolveEmployer({ ...base, source_id: 'other' })?.id);
  for (const company of ['示例科技股份有限公司', '示例科技有限公司济南分公司', '示例科技有限公司青岛分公司'])
    assert.notEqual(resolveEmployer({ ...base, company })?.id, entity.id);
  assert.equal(JSON.stringify(base), original);
  assert.deepEqual(employerFromId(entity.id), entity);
});

await test('abbreviations and conflicting identities remain scoped to the recruitment source', () => {
  for (const company of ['示例科技', '全球营销中心-中国区']) {
    const a = resolveEmployer(fixtureJob({ company, source_id: 'school-a' }))!;
    const b = resolveEmployer(fixtureJob({ company, source_id: 'school-b' }))!;
    assert.equal(a.scope, 'source'); assert.notEqual(a.id, b.id);
  }
  const conflicting = resolveEmployer(fixtureJob({ company: entity.name, company_conflict: true }))!;
  assert.equal(conflicting.scope, 'source'); assert.notEqual(conflicting.id, entity.id);
  for (const company of ['', '企业名称待核实', '招聘单位见原页面']) assert.equal(resolveEmployer(fixtureJob({ company })), null);
  for (const company of ['甲有限公司 & 乙有限公司', '甲有限公司、乙有限公司', '多家企业联合招聘'])
    assert.equal(resolveEmployer(fixtureJob({ company })), null);
});

await test('registered official brand and departments keep independent scores and stable source aliases', () => {
  const department = resolveEmployer(fixtureJob({ source_id: 'hisense-campus', company: '全球营销中心-中国区' }))!;
  const anotherSource = resolveEmployer(fixtureJob({ source_id: 'hisense-social', company: '全球营销中心-中国区' }))!;
  const brand = resolveEmployer(fixtureJob({ source_id: 'hisense-campus', company: '海信集团' }))!;
  assert.equal(department.scope, 'department'); assert.equal(department.id, anotherSource.id);
  assert.notEqual(department.id, brand.id);
  assert.equal(employerLabel(employerFromId(department.id)), '海信集团 · 全球营销中心-中国区');
  assert.equal(resolveEmployer(fixtureJob({ source_id: 'hisense-campus', company: '海信集团有限公司' }))?.scope, 'name');
  assert.notEqual(resolveEmployer(fixtureJob({ source_id: 'hisense-campus', company: '海信集团有限公司' }))?.id, brand.id);
});

await test('research URLs are escaped searches on fixed sites and do not pretend to be company matches', () => {
  const links = employerResearchLinks('示例公司 "A&B" <script>');
  assert.equal(links.length, 3);
  for (const source of links) {
    const url = new URL(source.url);
    assert.equal(url.origin, 'https://www.bing.com');
    assert.ok(url.searchParams.get('q')?.startsWith(`site:${source.domain} `));
    assert.match(url.searchParams.get('q')!, /A&B/);
  }
  assert.deepEqual(employerResearchLinks('  '), []);
  assert.throws(() => employerFromId('employer:v1:["name","","示例公司"] trailing'));
  assert.throws(() => employerFromId('employer:v1:["source","","示例公司"]'));
});

await test('company patches read latest storage, preserve other employers and merge unedited fields', () => {
  const storage = memory();
  const other = resolveEmployer(fixtureJob({ company: '其他公司有限公司' }))!;
  commitEmployerPatch(storage, entity.id, { rating: 4 }, earlier);
  const old = readEmployerRecords(storage)[entity.id];
  commitEmployerPatch(storage, other.id, { rating: 5 }, later);
  commitEmployerPatch(storage, entity.id, { notes: '面试后补充' }, later, old);
  assert.equal(readEmployerRecords(storage)[entity.id].rating, 4);
  assert.equal(readEmployerRecords(storage)[other.id].rating, 5);
  const withNote = readEmployerRecords(storage)[entity.id];
  commitEmployerPatch(storage, entity.id, { rating: 5 }, later, withNote);
  commitEmployerPatch(storage, entity.id, { notes: '只改备注' }, later, withNote);
  assert.equal(readEmployerRecords(storage)[entity.id].rating, 5);
});

await test('late same-field conflicts reject a write until explicitly overwritten', () => {
  const storage = memory();
  commitEmployerPatch(storage, entity.id, { rating: 4, notes: '原备注' }, earlier);
  const old = readEmployerRecords(storage)[entity.id];
  commitEmployerPatch(storage, entity.id, { notes: '另一页备注' }, later, old);
  assert.throws(() => commitEmployerPatch(storage, entity.id, { notes: '本页草稿' }, later, old), /草稿已保留/);
  assert.equal(readEmployerRecords(storage)[entity.id].notes, '另一页备注');
  commitEmployerPatch(storage, entity.id, { notes: '本页草稿' }, later, old, true);
  assert.equal(readEmployerRecords(storage)[entity.id].notes, '本页草稿');
});

await test('corrupt data and invalid ratings never replace existing employer records', () => {
  for (const rating of [-1, 0, 6, 2.5, '5', undefined])
    assert.throws(() => validateEmployerRecords({ [entity.id]: { ...record, rating } }));
  assert.throws(() => validateEmployerRecords({ [entity.id]: { ...record, notes: 'x'.repeat(2001) } }));
  assert.throws(() => validateEmployerRecords({ [entity.id]: { ...record, updated_at: '2026-02-30T00:00:00Z' } }));
  const storage = memory(); storage.setItem(EMPLOYER_PERSONAL_STORAGE, '{broken');
  assert.throws(() => commitEmployerPatch(storage, entity.id, { rating: 4 }, later));
  assert.equal(storage.getItem(EMPLOYER_PERSONAL_STORAGE), '{broken');
});

await test('newer clears survive old backups; equal timestamps obey the selected conflict side', () => {
  const current = { [entity.id]: { rating: null, notes: '', updated_at: later } };
  const old = { [entity.id]: { ...record, updated_at: earlier } };
  assert.deepEqual(mergeEmployerRecords(current, old, true), current);
  assert.deepEqual(mergeEmployerRecords(old, current), current);
  const equal = { [entity.id]: { ...record, updated_at: '2026-10-29T08:00:00+08:00' } };
  assert.deepEqual(employerRecordConflicts(current, equal), [entity.id]);
  assert.deepEqual(mergeEmployerRecords(current, equal), current);
  assert.deepEqual(mergeEmployerRecords(current, equal, true), equal);
});

await test('v4 exports company notes and accepts v1/v2/v3 without clearing existing company records', () => {
  const storage = memory(); storage.setItem(EMPLOYER_PERSONAL_STORAGE, JSON.stringify({ [entity.id]: record }));
  const exported = createBackup({}, storage);
  assert.equal(exported.version, 4); assert.deepEqual(exported.employer_records, { [entity.id]: record });
  const restored = memory(); writeBackup(validateBackup(JSON.parse(JSON.stringify(exported))), restored);
  assert.deepEqual(readEmployerRecords(restored), { [entity.id]: record });
  for (const version of [1, 2, 3]) {
    writeBackup(validateBackup({ version, records: {} }), storage);
    assert.deepEqual(readEmployerRecords(storage), { [entity.id]: record });
  }
  assert.throws(() => validateBackup({ version: 3, records: {}, employer_records: { [entity.id]: record } }));
});

await test('an atomic backup failure restores both job and company records', () => {
  const storage = memory(); storage.setItem(PERSONAL_STORAGE, '{}');
  storage.setItem(EMPLOYER_PERSONAL_STORAGE, JSON.stringify({ [entity.id]: record }));
  const before = new Map(storage.values); let failed = false;
  const flaky = { ...storage, setItem: (key: string, value: string) => {
    if (key === EMPLOYER_PERSONAL_STORAGE && !failed) { failed = true; throw Error('quota'); }
    storage.setItem(key, value);
  } };
  assert.throws(() => writeBackup(validateBackup({ version: 4, records: { '0123456789abcdef0123': { saved: true } },
    employer_records: { [entity.id]: { ...record, rating: 1 } } }), flaky), /quota/);
  assert.deepEqual(storage.values, before);
});
