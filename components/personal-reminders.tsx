'use client';
import { useEffect, useState } from 'react';
import type { Job, Personal } from '@/lib/jobs';
import { personalFor } from '@/lib/jobs';

export function PersonalReminders({ jobs, personal, now, onDetail }: { jobs: Job[]; personal: Personal; now: number; onDetail: (job: Job) => void }) {
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const load = () => {
      try { setEnabled(localStorage.getItem('job-radar-reminders-v1') === 'true'); } catch { /* Browsing remains available. */ }
    };
    const timer = setTimeout(load, 0);
    window.addEventListener('job-radar-local-workspace-change', load);
    return () => { clearTimeout(timer); window.removeEventListener('job-radar-local-workspace-change', load); };
  }, []);
  const reminders = jobs.flatMap((job) => {
    const record = personalFor(job, personal);
    if (record.hidden) return [];
    const entries = [];
    const next = Date.parse(record.next_action_at || '');
    if (Number.isFinite(next) && next <= now + 86400000) entries.push({ job, time: next, label: record.next_action_note || '跟进安排' });
    const deadline = Date.parse(job.deadline || '');
    if (record.saved && !record.applied && deadline >= now && deadline <= now + 3 * 86400000) entries.push({ job, time: deadline, label: '报名即将截止' });
    return entries;
  }).sort((a, b) => a.time - b.time);
  return <section className="personal-reminders">
    <label className="check-row"><input type="checkbox" checked={enabled} onChange={(event) => {
      setEnabled(event.target.checked);
      try { localStorage.setItem('job-radar-reminders-v1', String(event.target.checked)); }
      catch { setMessage('提醒偏好暂未保存。'); }
    }} />开启页面内求职提醒</label>
    <small>打开网站时查看；关闭浏览器后请使用日历提醒。{message}</small>
    {enabled && <div>{reminders.length ? reminders.slice(0, 8).map(({ job, time, label }, index) => <button type="button" key={`${job.id}-${index}`} className="plan-link" onClick={() => onDetail(job)}>
      {time < now ? '待跟进 · ' : ''}{label}：{job.company || job.title} · {new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(time)}
    </button>) : <p className="small muted">暂无明日内待办或三天内截止的收藏。</p>}</div>}
  </section>;
}
