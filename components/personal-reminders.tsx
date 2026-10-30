'use client';

import { useEffect, useState, useMemo } from 'react';
import { Bell, Clock3, X } from 'lucide-react';
import type { Job, Personal } from '@/lib/jobs';
import { eventDisplayTitle } from '@/lib/jobs';
import { buildPersonalReminders } from '@/lib/reminders';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

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
    window.addEventListener('storage', load);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('job-radar-local-workspace-change', load);
      window.removeEventListener('storage', load);
    };
  }, []);

  const reminders = useMemo(() => buildPersonalReminders(jobs, personal, now), [jobs, personal, now]);

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
    <Popover open={open} onOpenChange={setOpen}>
    <div className="top-reminder-wrap">
      <PopoverTrigger
        type="button"
        className={`top-reminder-trigger ${open ? 'is-active' : ''} ${hasActiveReminders ? 'has-reminders' : ''}`}
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
      </PopoverTrigger>

      {open && (
        <PopoverContent className="top-reminder-popover" align="end" sideOffset={8} collisionPadding={16} aria-label="求职提醒设置与临期通知">
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
            提示：关闭网页后不会推送。校园活动可在日程栏导出；岗位截止与个人跟进请另设手机提醒。
          </div>
        </PopoverContent>
      )}
    </div>
    </Popover>
  );
}
