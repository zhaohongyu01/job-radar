'use client';

import { useMemo } from 'react';
import { CalendarPlus } from 'lucide-react';
import { isPendingApplication, personalFor, shanghaiDay } from '@/lib/jobs';
import type { Filters, Job, Personal } from '@/lib/jobs';
import type { PersonalCounts } from '@/lib/personal-counts';
import { downloadPendingDeadlinesCalendar } from '@/lib/exam-calendar';
import { useToast } from '@/components/toast-provider';

export function SavedViewHeader({
  view,
  personalCounts,
  allJobs,
  personal,
  now,
  onOpenView,
}: {
  view: Filters['view'];
  personalCounts: PersonalCounts;
  allJobs: Job[];
  personal: Personal;
  now: number;
  onOpenView: (view: Filters['view']) => void;
}) {
  const { toast } = useToast();

  const pendingDeadlineJobs = useMemo(() => {
    if (view !== 'planned') return [];
    return allJobs.filter(
      (job) =>
        Boolean(job.deadline) &&
        /^20\d{2}-\d{2}-\d{2}$/.test(shanghaiDay(job.deadline!)) &&
        isPendingApplication(job, personalFor(job, personal), now),
    );
  }, [view, allJobs, personal, now]);

  if (view === 'all') {
    return <h1 className="sr-only">发现机会</h1>;
  }

  return (
    <div className="saved-view-header">
      <h1 className="page-title">
        {view === 'pipeline' || view === 'applied' ? '投递跟进' : '我的收藏'}
      </h1>
      {(view === 'planned' || view === 'saved' || view === 'hidden') && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
          <fieldset className="seg saved-subtabs" aria-label="我的收藏分类">
            <button
              type="button"
              aria-pressed={view === 'planned'}
              onClick={() => onOpenView('planned')}
            >
              待投递 <span className="seg-count">{personalCounts.pending}</span>
            </button>
            <button
              type="button"
              aria-pressed={view === 'saved'}
              onClick={() => onOpenView('saved')}
            >
              全部收藏 <span className="seg-count">{personalCounts.savedAll}</span>
            </button>
            <button
              type="button"
              aria-pressed={view === 'hidden'}
              onClick={() => onOpenView('hidden')}
            >
              不感兴趣 <span className="seg-count">{personalCounts.hidden}</span>
            </button>
          </fieldset>
          {view === 'planned' && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={pendingDeadlineJobs.length === 0}
              onClick={() => {
                downloadPendingDeadlinesCalendar(pendingDeadlineJobs, now);
                toast({
                  message: `已导出 ${pendingDeadlineJobs.length} 条待投递截止日`,
                  tone: 'success',
                });
              }}
              title={
                pendingDeadlineJobs.length > 0
                  ? `将 ${pendingDeadlineJobs.length} 条明确截止日期的待投递岗位导出为日历提醒`
                  : '暂无写明截止日期的待投递岗位'
              }
            >
              <CalendarPlus size={14} /> 导出截止日到日历
            </button>
          )}
        </div>
      )}
    </div>
  );
}
