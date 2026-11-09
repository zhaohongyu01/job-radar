'use client';

import { useEffect, useRef, useState } from 'react';
import type { Job, PersonalRecord } from '@/lib/jobs';
import { APPLICATION_STAGES } from '@/lib/personal-records';

const localDate = (value?: string | null) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16)
    : '';

const formatSavedTime = () =>
  new Date().toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

const labels = {
  stage: '投递阶段',
  appliedAt: '投递时间',
  nextAt: '下一步时间',
  nextNote: '下一步安排',
  notes: '备注',
};
type Field = keyof typeof labels;
type Edits = Partial<Record<Field, { value: string; base: string }>>;

export function ApplicationTracker({
  job,
  record,
  onSave,
}: {
  job: Job;
  record: PersonalRecord;
  onSave: (
    job: Job,
    patch: PersonalRecord,
    expected?: PersonalRecord,
  ) => boolean | Promise<boolean>;
}) {
  const [edits, setEdits] = useState<Edits>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [hasError, setHasError] = useState(false);
  const debounceTimerRef = useRef<number | null>(null);

  const saved: Record<Field, string> = {
    stage: record.application_stage || (record.applied ? 'applied' : 'planned'),
    appliedAt: localDate(record.applied_at),
    nextAt: localDate(record.next_action_at),
    nextNote: record.next_action_note || '',
    notes: record.notes || '',
  };

  const value = (field: Field, sourceEdits: Edits = edits) =>
    sourceEdits[field]?.value ?? saved[field];

  const conflicts = (Object.keys(edits) as Field[]).filter((field) => {
    const edit = edits[field]!;
    return saved[field] !== edit.base && saved[field] !== edit.value;
  });

  const clearDebounce = () => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const submitWithEdits = async (
    targetEdits: Edits,
    overwriteConflict = false,
  ) => {
    const activeConflicts = (Object.keys(targetEdits) as Field[]).filter(
      (field) => {
        const edit = targetEdits[field]!;
        return saved[field] !== edit.base && saved[field] !== edit.value;
      },
    );
    if (saving || (activeConflicts.length && !overwriteConflict)) return;
    const fields = (Object.keys(targetEdits) as Field[]).filter(
      (field) => value(field, targetEdits) !== saved[field],
    );
    if (!fields.length) {
      setEdits({});
      return;
    }
    setSaving(true);
    try {
      const patch: PersonalRecord = {};
      if (fields.includes('stage')) {
        patch.application_stage = value(
          'stage',
          targetEdits,
        ) as NonNullable<PersonalRecord['application_stage']>;
        patch.applied = patch.application_stage !== 'planned';
      }
      if (fields.includes('appliedAt')) {
        const v = value('appliedAt', targetEdits);
        patch.applied_at = v ? new Date(`${v}:00+08:00`).toISOString() : null;
      }
      if (fields.includes('nextAt')) {
        const v = value('nextAt', targetEdits);
        patch.next_action_at = v
          ? new Date(`${v}:00+08:00`).toISOString()
          : null;
      }
      if (fields.includes('nextNote')) {
        patch.next_action_note = value('nextNote', targetEdits);
      }
      if (fields.includes('notes')) {
        patch.notes = value('notes', targetEdits);
      }
      if (await onSave(job, patch, overwriteConflict ? undefined : record)) {
        setEdits((current) => {
          const remaining = { ...current };
          for (const f of fields) {
            if (remaining[f]?.value === targetEdits[f]?.value) {
              delete remaining[f];
            }
          }
          return remaining;
        });
        setHasError(false);
        setMessage(`已保存 · ${formatSavedTime()}`);
      } else {
        setHasError(true);
        setMessage(
          '尚未保存，编辑内容已保留；请核对最新记录或存储状态后重试。',
        );
      }
    } catch {
      setHasError(true);
      setMessage('尚未保存，请核对时间格式后重试；编辑内容已保留。');
    } finally {
      setSaving(false);
    }
  };

  const changeImmediate = (field: 'stage' | 'appliedAt' | 'nextAt', input: string) => {
    const nextEdits: Edits = { ...edits };
    if (input === saved[field]) {
      delete nextEdits[field];
    } else {
      nextEdits[field] = {
        value: input,
        base: edits[field]?.base ?? saved[field],
      };
    }
    setEdits(nextEdits);
    void submitWithEdits(nextEdits);
  };

  const changeDebounced = (field: 'nextNote' | 'notes', input: string) => {
    const nextEdits: Edits = { ...edits };
    if (input === saved[field]) {
      delete nextEdits[field];
    } else {
      nextEdits[field] = {
        value: input,
        base: edits[field]?.base ?? saved[field],
      };
    }
    setEdits(nextEdits);
    clearDebounce();
    if (input !== saved[field]) {
      debounceTimerRef.current = window.setTimeout(() => {
        debounceTimerRef.current = null;
        void submitWithEdits(nextEdits);
      }, 800);
    }
  };

  const flushDebounced = () => {
    clearDebounce();
    void submitWithEdits(edits);
  };

  return (
    <section className="application-tracker">
      <h3>我的投递跟进</h3>
      <p className="small muted">
        只记录在当前浏览器；修改后自动保存，标记阶段不会向企业提交申请。
      </p>
      <div className="agenda-dates">
        <label>
          投递阶段
          <select
            aria-label="投递阶段"
            disabled={saving}
            value={value('stage')}
            onChange={(event) => changeImmediate('stage', event.target.value)}
          >
            {Object.entries(APPLICATION_STAGES).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          投递时间（北京时间）
          <input
            disabled={saving}
            type="datetime-local"
            value={value('appliedAt')}
            onChange={(event) => changeImmediate('appliedAt', event.target.value)}
          />
        </label>
      </div>
      <div className="agenda-dates">
        <label>
          下一步时间（北京时间）
          <input
            disabled={saving}
            type="datetime-local"
            value={value('nextAt')}
            onChange={(event) => changeImmediate('nextAt', event.target.value)}
          />
        </label>
        <label>
          下一步安排
          <input
            disabled={saving}
            value={value('nextNote')}
            maxLength={200}
            placeholder="例如：准备技术面试材料"
            onChange={(event) => changeDebounced('nextNote', event.target.value)}
            onBlur={flushDebounced}
          />
        </label>
      </div>
      <label>
        备注
        <textarea
          disabled={saving}
          value={value('notes')}
          maxLength={2000}
          rows={2}
          placeholder="联系人、面试准备或个人记录"
          onChange={(event) => changeDebounced('notes', event.target.value)}
          onBlur={flushDebounced}
        />
      </label>
      {!!conflicts.length && (
        <div role="alert">
          <p>
            其他页面更新了{conflicts.map((field) => labels[field]).join('、')}
            ，当前输入已保留。请选择保留哪一份内容。
          </p>
          <button
            type="button"
            className="btn btn-outline"
            disabled={saving}
            onClick={() => {
              clearDebounce();
              setEdits({});
              setHasError(false);
              setMessage('已读取最新保存内容');
            }}
          >
            重新读取已保存内容
          </button>
          <button
            type="button"
            className="btn btn-outline"
            disabled={saving}
            onClick={() => {
              clearDebounce();
              void submitWithEdits(edits, true);
            }}
          >
            以当前输入覆盖冲突
          </button>
        </div>
      )}
      {hasError && !conflicts.length && (
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={saving}
          onClick={() => void submitWithEdits(edits)}
        >
          重试保存
        </button>
      )}
      <output className="small muted">{saving ? '正在保存…' : message}</output>
    </section>
  );
}
