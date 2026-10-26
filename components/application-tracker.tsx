'use client';
import { useState } from 'react';
import type { Job, PersonalRecord } from '@/lib/jobs';
import { APPLICATION_STAGES } from '@/lib/personal-records';

const localDate = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16) : '';
export function ApplicationTracker({ job, record, onSave }: { job: Job; record: PersonalRecord; onSave: (job: Job, record: PersonalRecord) => boolean }) {
  const [stage, setStage] = useState(record.application_stage || (record.applied ? 'applied' : 'planned'));
  const [appliedAt, setAppliedAt] = useState(localDate(record.applied_at));
  const [nextAt, setNextAt] = useState(localDate(record.next_action_at));
  const [nextNote, setNextNote] = useState(record.next_action_note || '');
  const [notes, setNotes] = useState(record.notes || '');
  const [message, setMessage] = useState('');
  return <section className="application-tracker">
    <h3>我的投递跟进</h3><p className="small muted">只记录在当前浏览器；标记阶段不会向企业提交申请。旧投递时间不明时留空。</p>
    <div className="agenda-dates"><label>投递阶段<select value={stage} onChange={(event) => setStage(event.target.value as typeof stage)}>
      {Object.entries(APPLICATION_STAGES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label><label>投递时间（北京时间）<input type="datetime-local" value={appliedAt} onChange={(event) => setAppliedAt(event.target.value)} /></label></div>
    <label>下一步时间（北京时间）<input type="datetime-local" value={nextAt} onChange={(event) => setNextAt(event.target.value)} /></label>
    <label>下一步安排<input value={nextNote} maxLength={200} placeholder="例如：准备技术面试材料" onChange={(event) => setNextNote(event.target.value)} /></label>
    <label>备注<textarea value={notes} maxLength={2000} rows={3} placeholder="联系人、面试准备或个人记录" onChange={(event) => setNotes(event.target.value)} /></label>
    <button type="button" className="btn btn-outline" onClick={() => {
      const next = { ...record, application_stage: stage, applied: stage !== 'planned', applied_at: appliedAt ? new Date(`${appliedAt}:00+08:00`).toISOString() : null,
        next_action_at: nextAt ? new Date(`${nextAt}:00+08:00`).toISOString() : null, next_action_note: nextNote, notes, personal_updated_at: new Date().toISOString() };
      setMessage(onSave(job, next) ? '跟进记录已保存' : '尚未保存，请保留当前编辑内容后导出备份。');
    }}>保存跟进记录</button><output>{message}</output>
  </section>;
}
