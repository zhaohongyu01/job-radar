'use client';

import { useEffect, useMemo, useState } from 'react';
import { Bell, Clock3, X } from 'lucide-react';
import type { Job, Personal } from '@/lib/jobs';
import { eventDisplayTitle } from '@/lib/jobs';
import { extractSalary } from '@/lib/salary-display';
import { buildExamPersonalReminders, buildPersonalReminders } from '@/lib/reminders';
import { EXAM_PERSONAL_STORAGE, validateExamPersonal } from '@/lib/exams';
import type { ExamAnnouncement, ExamPersonalStore, ExamSnapshot } from '@/lib/exams';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export interface PersonalRemindersProps {
  jobs?: Job[];
  personal?: Personal;
  now: number;
  onDetail?: (job: Job) => void;
  exams?: ExamAnnouncement[];
  examPersonal?: ExamPersonalStore;
  onSelectExam?: (exam: ExamAnnouncement) => void;
}

type UnifiedReminderItem =
  | { kind: 'job'; key: string; job: Job; time: number; label: string; isFollowup: boolean }
  | { kind: 'exam'; key: string; exam: ExamAnnouncement; time: number; label: string; isFollowup: boolean };

export function PersonalReminders({
  jobs = [],
  personal = {},
  now,
  onDetail,
  exams,
  examPersonal,
  onSelectExam,
}: PersonalRemindersProps) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [storedExamPersonal, setStoredExamPersonal] = useState<ExamPersonalStore>({});
  const [lazyExams, setLazyExams] = useState<ExamAnnouncement[]>([]);

  useEffect(() => {
    const load = () => {
      try {
        setEnabled(localStorage.getItem('job-radar-reminders-v1') === 'true');
        if (!examPersonal) {
          const rawExam = localStorage.getItem(EXAM_PERSONAL_STORAGE);
          setStoredExamPersonal(rawExam ? validateExamPersonal(JSON.parse(rawExam)) : {});
        }
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
  }, [examPersonal]);

  const effectiveExamPersonal = examPersonal ?? storedExamPersonal;
  const hasTrackedExamsInStorage = useMemo(
    () =>
      Object.values(effectiveExamPersonal).some(
        (r) => r && !r.hidden && (r.saved || (r.status && r.status !== 'none')),
      ),
    [effectiveExamPersonal],
  );

  useEffect(() => {
    if (exams || !enabled || !hasTrackedExamsInStorage || lazyExams.length > 0) return;
    let active = true;
    fetch('/exams.json', { cache: 'force-cache' })
      .then((res) => (res.ok ? (res.json() as Promise<ExamSnapshot>) : null))
      .then((snap) => {
        if (active && snap?.exams) setLazyExams(snap.exams);
      })
      .catch(() => {
        /* Cross-workspace exam reminders degrade silently if unavailable. */
      });
    return () => {
      active = false;
    };
  }, [exams, enabled, hasTrackedExamsInStorage, lazyExams.length]);

  const effectiveExams = exams ?? lazyExams;

  const combinedReminders = useMemo<UnifiedReminderItem[]>(() => {
    const jobItems: UnifiedReminderItem[] = buildPersonalReminders(jobs, personal, now).map(
      (r, idx) => ({
        kind: 'job',
        key: `job-${r.job.id}-${idx}`,
        job: r.job,
        time: r.time,
        label: r.label,
        isFollowup: r.isFollowup,
      }),
    );
    const examItems: UnifiedReminderItem[] = buildExamPersonalReminders(
      effectiveExams,
      effectiveExamPersonal,
      now,
    ).map((r, idx) => ({
      kind: 'exam',
      key: `exam-${r.exam.id}-${r.label}-${idx}`,
      exam: r.exam,
      time: r.time,
      label: r.label,
      isFollowup: r.isFollowup,
    }));
    return [...jobItems, ...examItems].sort((a, b) => a.time - b.time);
  }, [jobs, personal, now, effectiveExams, effectiveExamPersonal]);

  const toggleEnabled = (checked: boolean) => {
    setEnabled(checked);
    try {
      localStorage.setItem('job-radar-reminders-v1', String(checked));
      setMessage('');
    } catch {
      setMessage('提醒偏好暂未保存');
    }
  };

  const hasActiveReminders = enabled && combinedReminders.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="top-reminder-wrap">
        <PopoverTrigger
          type="button"
          className={`top-reminder-trigger ${open ? 'is-active' : ''} ${hasActiveReminders ? 'has-reminders' : ''}`}
          aria-expanded={open}
          title="点击查看求职与考编临期提醒"
        >
          <Bell size={12} className={hasActiveReminders ? 'bell-ringing' : ''} />
          <span className="top-reminder-lbl">提醒</span>
          {hasActiveReminders && (
            <span className="top-reminder-badge" aria-label={`${combinedReminders.length} 项临期待办`}>
              {combinedReminders.length}
            </span>
          )}
        </PopoverTrigger>

        {open && (
          <PopoverContent
            className="top-reminder-popover"
            align="end"
            sideOffset={8}
            collisionPadding={16}
            aria-label="跨工作台临期提醒与设置"
          >
            <div className="top-reminder-head">
              <div className="top-reminder-title">
                <Bell size={14} className="text-brand" />
                <span>双端临期提醒</span>
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
              汇总企业网申截止、跟进待办，以及考编报名、缴费与笔试节点。
            </p>

            {message && <small className="text-danger">{message}</small>}

            {enabled ? (
              combinedReminders.length > 0 ? (
                <div className="top-reminder-list">
                  {combinedReminders.slice(0, 8).map((item) => {
                    if (item.kind === 'job') {
                      const { job, time, label, isFollowup } = item;
                      return (
                        <button
                          type="button"
                          key={item.key}
                          className="top-reminder-item"
                          onClick={() => {
                            setOpen(false);
                            if (onDetail) {
                              onDetail(job);
                            } else {
                              window.location.assign(`/?job=${encodeURIComponent(job.id)}`);
                            }
                          }}
                          title={`点击查看「${eventDisplayTitle(job)}」`}
                        >
                          <span className={`top-reminder-tag ${isFollowup ? 'is-followup' : 'is-deadline'}`}>
                            {time < now ? '已逾期' : label}
                          </span>
                          <div className="top-reminder-item-main">
                            <span className="top-reminder-item-title">
                              {eventDisplayTitle(job)} · {extractSalary(job).cleanTitle}
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
                      );
                    }

                    const { exam, time, label, isFollowup } = item;
                    return (
                      <button
                        type="button"
                        key={item.key}
                        className="top-reminder-item"
                        onClick={() => {
                          setOpen(false);
                          if (onSelectExam) {
                            onSelectExam(exam);
                          } else {
                            window.location.assign(`/exams?exam=${encodeURIComponent(exam.id)}`);
                          }
                        }}
                        title={`点击查看「${exam.title}」`}
                      >
                        <span className={`top-reminder-tag ${isFollowup ? 'is-followup' : 'is-deadline'}`}>
                          {label}
                        </span>
                        <div className="top-reminder-item-main">
                          <span className="top-reminder-item-title">{exam.title}</span>
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
                    );
                  })}
                </div>
              ) : (
                <div className="top-reminder-empty">
                  暂无明日待办或近期截止的收藏与报考事项。
                </div>
              )
            ) : (
              <div className="top-reminder-empty">
                页面提醒已关闭，开启后将在网站打开时提示临期投递与考务节点。
              </div>
            )}

            <div className="top-reminder-footer">
              提示：点击顶栏 RSS 图标可将考编日历一键订阅至手机原生系统日历。
            </div>
          </PopoverContent>
        )}
      </div>
    </Popover>
  );
}
