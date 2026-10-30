'use client';
import { useState } from 'react';
import type { Job, PersonalRecord } from '@/lib/jobs';
import { APPLICATION_STAGES } from '@/lib/personal-records';

const localDate = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16) : '';
const labels = { stage: '投递阶段', appliedAt: '投递时间', nextAt: '下一步时间', nextNote: '下一步安排', notes: '备注' };
type Field = keyof typeof labels;
type Edits = Partial<Record<Field, { value: string; base: string }>>;

export function ApplicationTracker({ job, record, onSave }: {
  job: Job; record: PersonalRecord;
  onSave: (job: Job, patch: PersonalRecord, expected?: PersonalRecord) => boolean | Promise<boolean>;
}) {
  const [edits, setEdits] = useState<Edits>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  // Pristine fields follow quick actions/other pages; dirty fields keep their
  // input and original value so external changes cannot silently replace them.
  const saved: Record<Field, string> = {
    stage: record.application_stage || (record.applied ? 'applied' : 'planned'),
    appliedAt: localDate(record.applied_at), nextAt: localDate(record.next_action_at),
    nextNote: record.next_action_note || '', notes: record.notes || '',
  };
  const value = (field: Field) => edits[field]?.value ?? saved[field];
  const conflicts = (Object.keys(edits) as Field[]).filter((field) => {
    const edit = edits[field]!;
    return saved[field] !== edit.base && saved[field] !== edit.value;
  });
  const change = (field: Field, input: string) => setEdits((current) => {
    const next = { ...current };
    if (input === saved[field]) delete next[field];
    else next[field] = { value: input, base: current[field]?.base ?? saved[field] };
    return next;
  });
  const submit = async (overwriteConflict = false) => {
    if (saving || (conflicts.length && !overwriteConflict)) return;
    const fields = (Object.keys(edits) as Field[]).filter((field) => value(field) !== saved[field]);
    if (!fields.length) { setEdits({}); setMessage('没有需要保存的修改'); return; }
    setSaving(true);
    try {
      const patch: PersonalRecord = {};
      if (fields.includes('stage')) {
        patch.application_stage = value('stage') as NonNullable<PersonalRecord['application_stage']>;
        patch.applied = patch.application_stage !== 'planned';
      }
      if (fields.includes('appliedAt')) patch.applied_at = value('appliedAt') ? new Date(`${value('appliedAt')}:00+08:00`).toISOString() : null;
      if (fields.includes('nextAt')) patch.next_action_at = value('nextAt') ? new Date(`${value('nextAt')}:00+08:00`).toISOString() : null;
      if (fields.includes('nextNote')) patch.next_action_note = value('nextNote');
      if (fields.includes('notes')) patch.notes = value('notes');
      if (await onSave(job, patch, overwriteConflict ? undefined : record)) {
        setEdits({}); setMessage('跟进记录已保存');
      } else setMessage('尚未保存，编辑内容已保留；请核对最新记录或存储状态后重试。');
    } catch { setMessage('尚未保存，请核对时间格式后重试；编辑内容已保留。'); }
    finally { setSaving(false); }
  };
  return <section className="application-tracker">
    <h3>我的投递跟进</h3><p className="small muted">只记录在当前浏览器；标记阶段不会向企业提交申请。旧投递时间不明时留空。</p>
    <div className="agenda-dates"><label>投递阶段<select aria-label="投递阶段" disabled={saving} value={value('stage')} onChange={(event) => change('stage', event.target.value)}>
      {Object.entries(APPLICATION_STAGES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select></label><label>投递时间（北京时间）<input disabled={saving} type="datetime-local" value={value('appliedAt')} onChange={(event) => change('appliedAt', event.target.value)} /></label></div>
    <label>下一步时间（北京时间）<input disabled={saving} type="datetime-local" value={value('nextAt')} onChange={(event) => change('nextAt', event.target.value)} /></label>
    <label>下一步安排<input disabled={saving} value={value('nextNote')} maxLength={200} placeholder="例如：准备技术面试材料" onChange={(event) => change('nextNote', event.target.value)} /></label>
    <label>备注<textarea disabled={saving} value={value('notes')} maxLength={2000} rows={3} placeholder="联系人、面试准备或个人记录" onChange={(event) => change('notes', event.target.value)} /></label>
    {!!conflicts.length && <div role="alert"><p>其他页面更新了{conflicts.map((field) => labels[field]).join('、')}，当前输入已保留。请选择保留哪一份内容。</p>
      <button type="button" className="btn btn-outline" disabled={saving} onClick={() => { setEdits({}); setMessage('已读取最新保存内容'); }}>重新读取已保存内容</button>
      <button type="button" className="btn btn-outline" disabled={saving} onClick={() => void submit(true)}>以当前输入覆盖冲突</button>
    </div>}
    <button type="button" className="btn btn-outline" disabled={saving || !!conflicts.length} onClick={() => void submit()}>{saving ? '正在保存…' : '保存跟进记录'}</button><output>{message}</output>
  </section>;
}
