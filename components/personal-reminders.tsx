'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { Bell, Clock3, X } from 'lucide-react';
import type { Job, Personal } from '@/lib/jobs';
import { personalFor, eventDisplayTitle } from '@/lib/jobs';

export function PersonalReminders({
  jobs,
  personal,
  now,
  onDetail,
}: {
  jobs: Job[];
  personal: Personal;
  now: number;
  onDetail: (job: Job) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = () => {
      try {
        setEnabled(localStorage.getItem('job-radar-reminders-v1') === 'true');
      } catch {
        /* Browsing remains available. */
      }
    };
    const timer = setTimeout(load, 0);
    window.addEventListener('job-radar-local-workspace-change', load);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('job-radar-local-workspace-change', load);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const reminders = useMemo(() => {
    return jobs
      .flatMap((job) => {
        const record = personalFor(job, personal);
        if (record.hidden) return [];
        const entries = [];
        const next = Date.parse(record.next_action_at || '');
        if (Number.isFinite(next) && next <= now + 86400000) {
          entries.push({
            job,
            time: next,
            label: record.next_action_note || '跟进安排',
            isFollowup: true,
          });
        }
        const deadline = Date.parse(job.deadline || '');
        if (record.saved && !record.applied && deadline >= now && deadline <= now + 3 * 86400000) {
          entries.push({
            job,
            time: deadline,
            label: '报名即将截止',
            isFollowup: false,
          });
        }
        return entries;
      })
      .sort((a, b) => a.time - b.time);
  }, [jobs, personal, now]);

  const toggleEnabled = (checked: boolean) => {
    setEnabled(checked);
    try {
      localStorage.setItem('job-radar-reminders-v1', String(checked));
      setMessage('');
    } catch {
      setMessage('提醒偏好暂未保存');
    }
  };

  const hasActiveReminders = enabled && reminders.length > 0;

  return (
    <div className="top-reminder-wrap" ref={containerRef}>
      <button
        type="button"
        className={`top-reminder-trigger ${open ? 'is-active' : ''} ${hasActiveReminders ? 'has-reminders' : ''}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        title="点击查看求职提醒与临期安排"
      >
        <Bell size={12} className={hasActiveReminders ? 'bell-ringing' : ''} />
        <span className="top-reminder-lbl">提醒</span>
        {hasActiveReminders && (
          <span className="top-reminder-badge" aria-label={`${reminders.length} 项临期待办`}>
            {reminders.length}
          </span>
        )}
      </button>

      {open && (
        <div className="top-reminder-popover" aria-label="求职提醒设置与临期通知">
          <div className="top-reminder-head">
            <div className="top-reminder-title">
              <Bell size={14} className="text-brand" />
              <span>求职提醒</span>
            </div>
            <div className="top-reminder-ctrl">
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={enabled ? '点击关闭页面内求职提醒' : '点击开启页面内求职提醒'}
                className="ui-toggle-switch"
                onClick={() => toggleEnabled(!enabled)}
                title={enabled ? '点击关闭页面内提醒' : '点击开启页面内提醒'}
              >
                <span className="ui-toggle-thumb" />
              </button>
              <button
                type="button"
                className="top-reminder-close"
                onClick={() => setOpen(false)}
                aria-label="关闭提醒弹窗"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          <p className="top-reminder-desc">
            网站打开时提示明日待办或 3 天内截止的收藏机会。
          </p>

          {message && <small className="text-danger">{message}</small>}

          {enabled ? (
            reminders.length > 0 ? (
              <div className="top-reminder-list">
                {reminders.slice(0, 8).map(({ job, time, label, isFollowup }, index) => (
                  <button
                    type="button"
                    key={`${job.id}-${index}`}
                    className="top-reminder-item"
                    onClick={() => {
                      setOpen(false);
                      onDetail(job);
                    }}
                    title={`点击查看「${eventDisplayTitle(job)}」`}
                  >
                    <span className={`top-reminder-tag ${isFollowup ? 'is-followup' : 'is-deadline'}`}>
                      {time < now ? '已逾期' : label}
                    </span>
                    <div className="top-reminder-item-main">
                      <span className="top-reminder-item-title">
                        {eventDisplayTitle(job)} · {job.title}
                      </span>
                      <span className="top-reminder-item-time">
                        <Clock3 size={11} />
                        {new Intl.DateTimeFormat('zh-CN', {
                          timeZone: 'Asia/Shanghai',
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        }).format(time)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="top-reminder-empty">
                暂无明日待办或 3 天内即将截止的收藏。
              </div>
            )
          ) : (
            <div className="top-reminder-empty">
              页面提醒已关闭，开启后将在网站打开时提示临期投递。
            </div>
          )}

          <div className="top-reminder-footer">
            提示：关闭浏览器后如需提醒，可在右侧将收藏「导出日历」到手机系统日历。
          </div>
        </div>
      )}
    </div>
  );
}
