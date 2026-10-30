import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureJob } from './fixtures/job.ts';
import { isUnread, personalFor, validatePersonal } from '../lib/jobs.ts';
import type { Personal } from '../lib/jobs.ts';
import { PERSONAL_STORAGE, validateBackup } from '../lib/personal-backup.ts';
import { commitPersonalRecords, patchPersonalRecord, readPersonalRecords } from '../lib/personal-store.ts';
import { mergePersonalRecords, personalConflicts } from '../lib/personal-records.ts';
import { buildPersonalReminders } from '../lib/reminders.ts';
import { buildActionQueue } from '../lib/workspace.ts';

const A = 'aaaaaaaaaaaaaaaaaaa1', B = 'bbbbbbbbbbbbbbbbbbb2', OLD = 'ccccccccccccccccccc3';
const job = fixtureJob({ id: A });
const earlier = '2026-10-28T02:00:00.000Z', later = '2026-10-29T02:00:00.000Z';
function memory(records: Personal = {}) {
  const values = new Map([[PERSONAL_STORAGE, JSON.stringify(records)]]);
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
}

await test('commit reads the latest persisted records and patches only edited fields', () => {
  const storage = memory();
  commitPersonalRecords(storage, (latest) => patchPersonalRecord(latest, job, { saved: true }, earlier));
  commitPersonalRecords(storage, (latest) => patchPersonalRecord(latest, fixtureJob({ id: B }), { saved: true }, later));
  commitPersonalRecords(storage, (latest) => patchPersonalRecord(latest, job,
    { applied: true, application_stage: 'interview', applied_at: earlier }, later));
  const before = readPersonalRecords(storage);
  const after = commitPersonalRecords(storage, (latest) => patchPersonalRecord(latest, job,
    { notes: '只补备注' }, later, personalFor(job, before)));
  assert.equal(after[A].saved, true);
  assert.equal(after[B].saved, true);
  assert.equal(after[A].application_stage, 'interview');
  assert.equal(after[A].applied, true);
  assert.equal(after[A].applied_at, earlier);
  assert.equal(after[A].notes, '只补备注');
});

await test('unrelated edits retain explicit unread clears and duplicate identity', () => {
  const folded = { ...job, duplicate_ids: [OLD] };
  const storage = memory({ [OLD]: { saved: true, readAt: earlier }, [A]: { saved: false, readAt: null } });
  const next = commitPersonalRecords(storage, (latest) => patchPersonalRecord(latest, folded, { notes: '新草稿' }, later));
  assert.equal(next[A].readAt, null);
  assert.equal(next[A].saved, false);
  assert.equal(next[OLD].saved, true);
  assert.equal(isUnread(folded, next), true);
});

await test('a commit rejects a late conflict without losing either page’s input', () => {
  const storage = memory({ [A]: { notes: '原备注', saved: true } });
  const expected = personalFor(job, readPersonalRecords(storage));
  commitPersonalRecords(storage, (latest) => patchPersonalRecord(latest, job, { notes: '另一页的新备注' }, later));
  const raw = storage.getItem(PERSONAL_STORAGE);
  assert.throws(() => commitPersonalRecords(storage, (latest) =>
    patchPersonalRecord(latest, job, { notes: '本页草稿' }, later, expected)), /其他页面更新/);
  assert.equal(storage.getItem(PERSONAL_STORAGE), raw);
  const next = commitPersonalRecords(storage, (latest) =>
    patchPersonalRecord(latest, job, { next_action_note: '不同字段可以保存' }, later, expected));
  assert.equal(next[A].notes, '另一页的新备注');
  assert.equal(next[A].next_action_note, '不同字段可以保存');
});

await test('invalid storage and quota errors fail without destroying existing data', () => {
  const storage = memory();
  storage.values.set(PERSONAL_STORAGE, '{broken');
  assert.throws(() => commitPersonalRecords(storage, () => ({})));
  assert.equal(storage.getItem(PERSONAL_STORAGE), '{broken');
  storage.values.set(PERSONAL_STORAGE, JSON.stringify({ [A]: { saved: true } }));
  const raw = storage.getItem(PERSONAL_STORAGE);
  assert.throws(() => commitPersonalRecords({ ...storage, setItem: () => { throw Error('quota'); } },
    (latest) => patchPersonalRecord(latest, job, { saved: false }, later)), /quota/);
  assert.equal(storage.getItem(PERSONAL_STORAGE), raw);
});

await test('older backups cannot roll back any newer personal field, including false and null', () => {
  const current = validatePersonal({ [A]: { saved: false, hidden: false, applied: false, readAt: null,
    application_stage: 'planned', applied_at: null, next_action_at: null, next_action_note: '', notes: '新备注', personal_updated_at: later } });
  const imported = validatePersonal({ [A]: { saved: true, hidden: true, applied: true, readAt: earlier,
    application_stage: 'interview', applied_at: earlier, next_action_at: earlier, next_action_note: '旧安排', notes: '旧备注', personal_updated_at: earlier } });
  for (const prefer of [false, true]) {
    assert.deepEqual(mergePersonalRecords(current, imported, prefer), current);
    assert.deepEqual(mergePersonalRecords(imported, current, prefer), current);
  }
});

await test('untimed and equal-instant status conflicts follow the explicitly selected side', () => {
  for (const [oldTime, newTime] of [[undefined, undefined], [later, undefined], [undefined, later],
    [later, '2026-10-29T10:00:00+08:00']]) {
    const current = { [A]: { saved: true, hidden: false, readAt: later, personal_updated_at: oldTime } };
    const imported = { [A]: { saved: false, hidden: true, readAt: null, personal_updated_at: newTime } };
    assert.deepEqual(personalConflicts(current, imported), [A]);
    const keep = mergePersonalRecords(current, imported)[A];
    assert.equal(keep.saved, true); assert.equal(keep.hidden, false); assert.equal(keep.readAt, later);
    const replace = mergePersonalRecords(current, imported, true)[A];
    assert.equal(replace.saved, false); assert.equal(replace.hidden, true); assert.equal(replace.readAt, null);
  }
});

await test('a newer legacy applied flag survives an inherited contradictory stage', () => {
  const oldInterview = { [A]: { applied: true, application_stage: 'interview' as const, applied_at: earlier, personal_updated_at: earlier } };
  const cancel = { [A]: { applied: false, personal_updated_at: later } };
  for (const [current, imported] of [[oldInterview, cancel], [cancel, oldInterview]]) {
    const merged = validatePersonal(mergePersonalRecords(current, imported))[A];
    assert.equal(merged.applied, false);
    assert.equal(merged.application_stage, undefined);
    assert.equal(merged.applied_at, null);
  }
  for (const version of [1, 2]) {
    const legacy = validateBackup({ version, records: { [A]: { applied: true, saved: false } } });
    const merged = validatePersonal(mergePersonalRecords({ [A]: { application_stage: 'planned' } }, legacy.records, true))[A];
    assert.equal(merged.applied, true);
    assert.equal(merged.application_stage, undefined);
    assert.equal(merged.saved, false);
  }
});

await test('date-only deadlines stay in reminders through the whole Beijing day', () => {
  const row = fixtureJob({ deadline: '2026-10-29', deadline_precision: 'date' });
  const records = { [row.id]: { saved: true } };
  for (const time of ['07:59:59', '08:00:00', '12:00:00', '23:59:59']) {
    const reminders = buildPersonalReminders([row], records, Date.parse(`2026-10-29T${time}+08:00`));
    assert.equal(reminders.length, 1, time);
    assert.equal(reminders[0].time, Date.parse('2026-10-29T23:59:59.999+08:00'));
  }
  assert.equal(buildPersonalReminders([row], records, Date.parse('2026-10-30T00:00:00+08:00')).length, 0);
});

await test('explicit deadline times, hidden/applied states and follow-up reminders remain precise', () => {
  const row = fixtureJob({ deadline: '2026-10-29T12:00:00+08:00' });
  const at = Date.parse('2026-10-29T12:00:01+08:00');
  assert.equal(buildPersonalReminders([row], { [row.id]: { saved: true } }, at).length, 0);
  const records = { [row.id]: { saved: true, applied: true, next_action_at: '2026-10-29T11:00:00+08:00', next_action_note: '面试准备' } };
  const reminders = buildPersonalReminders([row], records, at);
  assert.equal(reminders.length, 1); assert.equal(reminders[0].label, '面试准备');
  assert.equal(reminders[0].isFollowup, true);
  assert.equal(buildPersonalReminders([row], { [row.id]: { ...records[row.id], hidden: true } }, at).length, 0);
  assert.equal(buildPersonalReminders([{ ...row, deadline: 'bad' }], { [row.id]: { saved: true } }, at).length, 0);
});

await test('action queue and reminders sort date-only deadlines after explicit same-day times', () => {
  const rows = [fixtureJob({ id: A, deadline: '2026-10-29' }), fixtureJob({ id: B, deadline: '2026-10-29T14:00:00+08:00' })];
  const records = { [A]: { saved: true }, [B]: { saved: true } };
  const at = Date.parse('2026-10-29T12:00:00+08:00');
  assert.deepEqual(buildActionQueue(rows, records, at).map(row => row.id), [B, A]);
  assert.deepEqual(buildPersonalReminders(rows, records, at).map(entry => entry.job.id), [B, A]);
});
