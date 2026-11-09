import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackup, validateBackup, writeBackup, PERSONAL_STORAGE } from '../lib/personal-backup.ts';
import { EVENT_PERSONAL_STORAGE } from '../lib/agenda.ts';
import { personalConflicts, mergePersonalRecords } from '../lib/personal-records.ts';
import { EXAM_PERSONAL_STORAGE, EXAM_PROFILE_STORAGE, DEFAULT_EXAM_PROFILE } from '../lib/exams.ts';

const id = '0123456789abcdef0123';
await test('v1/v2 imports remain compatible; v3 preserves notes, tasks and event bookmarks', () => {
  for (const version of [1, 2]) {
    const value = validateBackup({ version, records: { [id]: { applied: true, saved: true } } });
    assert.equal(value.records[id].applied, true); assert.equal(value.records[id].applied_at, undefined);
  }
  const data = { version: 3, records: { [id]: { applied: true, application_stage: 'interview', notes: '中文\n备注', personal_updated_at: '2026-10-25T00:00:00Z' } }, event_records: { event: { saved: true } } };
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  writeBackup(validateBackup(data), storage);
  assert.deepEqual(createBackup(validateBackup(data).records, storage), validateBackup(data));
  assert.throws(() => validateBackup({ version: 3, records: { [id]: { next_action_at: '2026-02-30T00:00:00Z' } } }));
  assert.throws(() => validateBackup({ version: 3, records: { [id]: { notes: 'a'.repeat(2001) } } }));
});
await test('untimed conflicts require explicit resolution and failed writes restore all old values', () => {
  const current = { [id]: { notes: '本机记录' } }, imported = { [id]: { notes: '备份记录' } };
  assert.deepEqual(personalConflicts(current, imported), [id]);
  assert.equal(mergePersonalRecords(current, imported)[id].notes, '本机记录');
  assert.equal(mergePersonalRecords(current, imported, true)[id].notes, '备份记录');
  const values = new Map([[PERSONAL_STORAGE, JSON.stringify(current)], [EVENT_PERSONAL_STORAGE, '{}']]);
  const before = new Map(values); let failed = false;
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { if (key === EVENT_PERSONAL_STORAGE && !failed) { failed = true; throw Error('quota'); } values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  assert.throws(() => writeBackup(validateBackup({ version: 3, records: imported, event_records: { event: { saved: true } } }), storage));
  assert.deepEqual(values, before);
});
await test('v5 backup round-trip preserves exam_records and exam_profile', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const examRecords = { 'exam-sd-2026': { saved: true, status: 'registered' as const, savedPositionIds: ['pos-1'], targetRowId: 'pos-1', notes: '省考报名' } };
  const examProfile = { ...DEFAULT_EXAM_PROFILE, education: '本科' as const, majorQuery: '计算机', hukouCity: '济南', onlyMatchProfile: true };
  storage.setItem(EXAM_PERSONAL_STORAGE, JSON.stringify(examRecords));
  storage.setItem(EXAM_PROFILE_STORAGE, JSON.stringify(examProfile));
  const backup = createBackup({}, storage);
  assert.equal(backup.version, 5);
  assert.deepEqual(backup.exam_records, examRecords);
  assert.deepEqual(backup.exam_profile, examProfile);

  const restored = new Map<string, string>();
  const restoredStorage = { getItem: (key: string) => restored.get(key) ?? null, setItem: (key: string, value: string) => { restored.set(key, value); }, removeItem: (key: string) => { restored.delete(key); } };
  writeBackup(validateBackup(JSON.parse(JSON.stringify(backup))), restoredStorage);
  assert.deepEqual(JSON.parse(restoredStorage.getItem(EXAM_PERSONAL_STORAGE) || '{}'), examRecords);
  assert.deepEqual(JSON.parse(restoredStorage.getItem(EXAM_PROFILE_STORAGE) || '{}'), examProfile);
});
await test('importing v4 legacy backup succeeds and preserves existing exam personal data', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const existingExam = { 'exam-01': { saved: true, status: 'paid' as const } };
  storage.setItem(EXAM_PERSONAL_STORAGE, JSON.stringify(existingExam));
  const v4 = validateBackup({ version: 4, records: { [id]: { saved: true } } });
  assert.equal(v4.version, 5);
  assert.equal(v4.exam_records, undefined);
  writeBackup(v4, storage);
  assert.deepEqual(JSON.parse(storage.getItem(EXAM_PERSONAL_STORAGE) || '{}'), existingExam);
});
await test('invalid exam_records in v5 backup are rejected', () => {
  assert.throws(() => validateBackup({ version: 5, records: {}, exam_records: { 'exam-01': { status: 'xx' } } }), /报考进度不正确/);
  assert.throws(() => validateBackup({ version: 5, records: {}, exam_records: { 'exam-01': { notes: 'x'.repeat(2001) } } }), /考编备注过长/);
});
