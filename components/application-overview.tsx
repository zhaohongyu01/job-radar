'use client';
import { useMemo } from 'react';
import type { Job, Personal, Filters } from '@/lib/jobs';
import { personalFor } from '@/lib/jobs';
import { APPLICATION_STAGES } from '@/lib/personal-records';

const STAGE_TONES: Record<string, string> = {
  all: 'is-all',
  planned: 'is-planned',
  applied: 'is-applied',
  test: 'is-test',
  interview: 'is-interview',
  offer: 'is-offer',
  rejected: 'is-muted',
  withdrawn: 'is-muted',
};

export function ApplicationOverview({
  jobs,
  personal,
  stage,
  activeView,
  onStage,
  onViewChange,
}: {
  jobs: Job[];
  personal: Personal;
  stage: Filters['applicationStage'];
  activeView?: Filters['view'];
  onStage: (stage: NonNullable<Filters['applicationStage']>) => void;
  onViewChange?: (view: Filters['view']) => void;
}) {
  const counts = useMemo(() => {
    const result = { all: 0, planned: 0, applied: 0, test: 0, interview: 0, offer: 0, rejected: 0, withdrawn: 0 };
    for (const job of jobs) {
      const record = personalFor(job, personal);
      if (record.hidden || !(record.saved || record.applied || record.application_stage)) continue;
      const key = record.application_stage || (record.applied ? 'applied' : 'planned');
      result[key]++;
      result.all++;
    }
    return result;
  }, [jobs, personal]);

  const activeTotal = counts.applied + counts.test + counts.interview + counts.offer;

  return (
    <section className="application-overview" aria-label="投递阶段总览">
      <div className="application-overview-head">
        <p className="small muted">
          按全部已记录机会统计，包含已截止；未收藏、未投递且未记录阶段的机会不计入。点击阶段后可搜索和查看详情。
        </p>
        {onViewChange && (
          <fieldset className="application-view-pills" aria-label="投递视图切换">
            <button
              type="button"
              className="toggle-chip toggle-chip-xs"
              aria-pressed={activeView === 'pipeline'}
              onClick={() => onViewChange('pipeline')}
            >
              全阶段漏斗 ({counts.all})
            </button>
            <button
              type="button"
              className="toggle-chip toggle-chip-xs"
              aria-pressed={activeView === 'planned'}
              onClick={() => onViewChange('planned')}
            >
              待投递队列 ({counts.planned})
            </button>
            <button
              type="button"
              className="toggle-chip toggle-chip-xs"
              aria-pressed={activeView === 'applied'}
              onClick={() => onViewChange('applied')}
            >
              投递跟进 ({activeTotal})
            </button>
          </fieldset>
        )}
      </div>
      <fieldset className="application-stage-tabs" aria-label="按投递阶段查看">
        {Object.entries({ all: '全部进度', ...APPLICATION_STAGES }).map(([key, label]) => {
          const count = counts[key as keyof typeof counts];
          const pct = counts.all > 0 ? Math.min(100, Math.round((count / counts.all) * 100)) : 0;
          const isSelected = activeView === 'planned' ? key === 'planned' : (stage || 'all') === key;
          return (
            <button
              key={key}
              type="button"
              className={`stage-funnel-card ${STAGE_TONES[key] || ''}`}
              aria-pressed={isSelected}
              onClick={() => onStage(key as NonNullable<Filters['applicationStage']>)}
            >
              <span>{label}</span>
              <strong>{count}</strong>
              <i className="stage-funnel-bar" aria-hidden="true">
                <b style={{ width: `${key === 'all' ? (counts.all > 0 ? 100 : 0) : pct}%` }} />
              </i>
            </button>
          );
        })}
      </fieldset>
    </section>
  );
}
