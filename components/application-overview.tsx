'use client';
import { useMemo } from 'react';
import type { Job, Personal, Filters } from '@/lib/jobs';
import { personalFor } from '@/lib/jobs';
import { APPLICATION_STAGES } from '@/lib/personal-records';

export function ApplicationOverview({ jobs, personal, stage, onStage }: {
  jobs: Job[]; personal: Personal; stage: Filters['applicationStage']; onStage: (stage: NonNullable<Filters['applicationStage']>) => void;
}) {
  const counts = useMemo(() => {
    const result = { all: 0, planned: 0, applied: 0, test: 0, interview: 0, offer: 0, rejected: 0, withdrawn: 0 };
    for (const job of jobs) {
      const record = personalFor(job, personal);
      if (record.hidden || !(record.saved || record.applied || record.application_stage)) continue;
      const key = record.application_stage || (record.applied ? 'applied' : 'planned');
      result[key]++; result.all++;
    }
    return result;
  }, [jobs, personal]);
  return <section className="application-overview" aria-label="投递阶段总览">
    <p className="small muted">按全部已记录机会统计，包含已截止；未收藏、未投递且未记录阶段的机会不计入。点击阶段后可搜索和查看详情。</p>
    <fieldset className="application-stage-tabs" aria-label="按投递阶段查看">
      {Object.entries({ all: '全部进度', ...APPLICATION_STAGES }).map(([key, label]) =>
        <button key={key} type="button" aria-pressed={(stage || 'all') === key} onClick={() => onStage(key as NonNullable<Filters['applicationStage']>)}>
          <span>{label}</span><strong>{counts[key as keyof typeof counts]}</strong>
        </button>)}
    </fieldset>
  </section>;
}
