'use client';

import { useId, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  Bookmark,
  CalendarDays,
  CheckCheck,
  Clock3,
  MapPin,
} from 'lucide-react';
import type { Job, Personal, Filters } from '@/lib/jobs';
import { personalFor, getDeadlineCountdown } from '@/lib/jobs';
import { buildActionQueue, upcomingTalks } from '@/lib/workspace';

export function ActionRail({
  jobs,
  personal,
  city,
  now,
  ready,
  onDetail,
  onView,
}: {
  jobs: Job[];
  personal: Personal;
  city: string;
  now: number;
  ready: boolean;
  onDetail: (job: Job) => void;
  onView: (view: Filters['view']) => void;
}) {
  const [allTalks, setAllTalks] = useState(false);
  const agendaId = useId();
  const queue = useMemo(
    () => buildActionQueue(jobs, personal, now),
    [jobs, personal, now],
  );
  const talks = useMemo(
    () => upcomingTalks(jobs, personal, city, now),
    [jobs, personal, city, now],
  );
  const applied = jobs.filter(
    (job) => personalFor(job, personal).applied,
  ).length;
  return (
    <aside className="plan-rail" aria-label="我的求职安排">
      <section className="plan-card plan-next">
        <p className="plan-kicker">下一步</p>
        <h2 className="plan-title">把收藏变成投递</h2>
        <p className="plan-lede">收藏且未截止的机会按截止时间排好，先投最急的。</p>
        <div className="plan-stats">
          <button disabled={!ready} onClick={() => onView('saved')}>
            <strong>{ready ? queue.length : '—'}</strong>
            <span>
              待投递 <ArrowUpRight size={12} />
            </span>
          </button>
          <button disabled={!ready} onClick={() => onView('applied')}>
            <strong>{ready ? applied : '—'}</strong>
            <span>
              已投递 <CheckCheck size={12} />
            </span>
          </button>
        </div>
        {queue.length ? (
          <ol className="plan-queue">
            {queue.slice(0, 3).map((job) => (
              <li key={job.id}>
                <button onClick={() => onDetail(job)}>
                  <strong>{job.company || job.title}</strong>
                  <span>{job.title}</span>
                  <small>
                    <Clock3 size={12} />
                    {getDeadlineCountdown(job.deadline, now)?.text ||
                      '截止日期待核实'}
                  </small>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <div className="plan-empty">
            <Bookmark size={20} />
            <span>
              遇到心动的机会，点一下收藏。
              <br />
              这里会帮你排好投递顺序。
            </span>
          </div>
        )}
        <button
          className="plan-link"
          disabled={!ready}
          onClick={() => onView('saved')}
        >
          查看全部收藏 <ArrowUpRight size={14} />
        </button>
      </section>
      <section className="plan-card">
        <div className="plan-head">
          <h2>
            <CalendarDays size={16} />
            宣讲日程
          </h2>
          <span className="chip">{city === '全部城市' ? '全部城市' : city}</span>
        </div>
        <p className="plan-caption">按宣讲地点整理 · 北京时间 · 共 {talks.length} 场</p>
        {talks.length ? (
          <ol id={agendaId} className={`agenda${allTalks ? " is-expanded" : ""}`}>
            {talks.slice(0, allTalks ? undefined : 4).map(({ job, event }) => (
              <li key={event.id || `${job.id}-${event.date}-${event.venue}`}>
                <div className="agenda-date">
                  <span>{Number(event.date.slice(5, 7))}月</span>
                  <strong>{event.date.slice(8)}</strong>
                </div>
                <button onClick={() => onDetail(job)}>
                  <strong>{job.company || job.title}</strong>
                  <span>
                    {event.start_time || '时间待确认'} · {event.school}
                  </span>
                  <small>
                    <MapPin size={11} />
                    {event.venue || '地点待确认'}
                  </small>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <div className="plan-empty">
            <CalendarDays size={22} />
            <span>
              暂未收录{city === '全部城市' ? '' : city}的后续宣讲。
              <br />
              可切换工作城市查看其他场次。
            </span>
          </div>
        )}
        {talks.length > 4 && <button className="plan-link" aria-expanded={allTalks} aria-controls={agendaId} onClick={() => setAllTalks((value) => !value)}>{allTalks ? '收起日程' : `查看全部 ${talks.length} 场宣讲`}</button>}
        <p className="plan-caption">
          宣讲城市不等于工作城市，出发前请核对原公告。
        </p>
      </section>
      <p className="plan-privacy">
        收藏和投递记录仅保存在当前浏览器。
        <br />
        换设备前，可在筛选栏导出备份。
      </p>
    </aside>
  );
}
