'use client';

import { useMemo } from 'react';
import {
  ArrowUpRight,
  Bookmark,
  CheckCheck,
  Clock3,
} from 'lucide-react';
import type { Job, Personal, Filters } from '@/lib/jobs';
import { personalFor, getDeadlineCountdown } from '@/lib/jobs';
import { buildActionQueue } from '@/lib/workspace';
import { PersonalReminders } from '@/components/personal-reminders';

export function TopActionCard({
  jobs,
  personal,
  now,
  ready,
  activeView,
  onDetail,
  onView,
}: {
  jobs: Job[];
  personal: Personal;
  now: number;
  ready: boolean;
  activeView?: Filters['view'];
  onDetail: (job: Job) => void;
  onView: (view: Filters['view']) => void;
}) {
  const queue = useMemo(
    () => buildActionQueue(jobs, personal, now),
    [jobs, personal, now],
  );

  const appliedCount = useMemo(
    () => jobs.filter((job) => personalFor(job, personal).applied).length,
    [jobs, personal],
  );

  const topUrgent = queue[0];

  return (
    <div className="personal-action-panel"><div className="top-action-card" aria-label="我的求职安排与投递进度">
      <div className="top-action-stats">
        <button
          type="button"
          className={`top-stat-btn ${activeView === 'saved' ? 'is-active' : ''}`}
          disabled={!ready}
          onClick={() => onView('saved')}
          title="查看待投递机会清单"
        >
          <span className="top-stat-num">{ready ? queue.length : '—'}</span>
          <span className="top-stat-lbl">
            待投递 <ArrowUpRight size={11} />
          </span>
        </button>

        <div className="top-stat-sep" aria-hidden="true" />

        <button
          type="button"
          className={`top-stat-btn ${activeView === 'applied' ? 'is-active' : ''}`}
          disabled={!ready}
          onClick={() => onView('applied')}
          title="查看已投递记录"
        >
          <span className="top-stat-num">{ready ? appliedCount : '—'}</span>
          <span className="top-stat-lbl">
            已投递 <CheckCheck size={11} />
          </span>
        </button>
      </div>

      <div className="top-action-cue">
        {topUrgent ? (
          <div className="top-cue-urgent">
            <span className="top-cue-tag">优先投递</span>
            <button
              type="button"
              className="top-cue-job-btn"
              onClick={() => onDetail(topUrgent)}
              title={`点击查看「${topUrgent.company || topUrgent.title}」详情`}
            >
              <strong className="top-cue-company">{topUrgent.company || topUrgent.title}</strong>
              <span className="top-cue-title">{topUrgent.title}</span>
              <small className="top-cue-time">
                <Clock3 size={11} />
                {getDeadlineCountdown(topUrgent.deadline, now)?.text || '截止日期待核实'}
              </small>
            </button>
            {queue.length > 1 && (
              <button
                type="button"
                className="top-cue-all-link"
                onClick={() => onView('saved')}
                title="查看全部收藏待投递机会"
              >
                全部 {queue.length} 个待投 <ArrowUpRight size={11} />
              </button>
            )}
          </div>
        ) : (
          <div className="top-cue-empty">
            <Bookmark size={14} className="top-cue-icon" />
            <span className="top-cue-tip">
              收藏心动机遇，将按截止时间在此排好优先投递
            </span>
            <button
              type="button"
              className="top-cue-explore-link"
              onClick={() => onView('saved')}
              title="查看已收藏机会"
            >
              我的收藏 <ArrowUpRight size={11} />
            </button>
          </div>
        )}
      </div>
    </div><PersonalReminders jobs={jobs} personal={personal} now={now} onDetail={onDetail} /></div>
  );
}
