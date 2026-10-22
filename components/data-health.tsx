'use client';

import { useMemo } from 'react';
import { Database, ChevronDown } from 'lucide-react';
import type { Job, Snapshot } from '@/lib/jobs';
import { collectionHealth, latestPublication } from '@/lib/data-health';
import { upcomingTalks } from '@/lib/workspace';

export function DataHealth({
  data,
  now,
  city,
  visibleJobs,
  origin,
  onSources,
}: {
  data: Snapshot;
  now: number;
  city: string;
  visibleJobs: Job[];
  origin: string;
  onSources: () => void;
}) {
  const health = useMemo(() => collectionHealth(data, now), [data, now]);
  const talks = useMemo(
    () => upcomingTalks(data.jobs, {}, city, now),
    [data.jobs, city, now],
  );
  const latest = latestPublication(visibleJobs, now);
  return (
    <details className="collection-health">
      <summary>
        <span>
          <Database size={14} />
          {origin === 'live'
            ? '线上最新快照'
            : origin === 'local'
              ? '本地历史快照'
              : '数据覆盖'}
        </span>
        <span>
          全站最新发布 <strong>{health.latest || '日期待核实'}</strong>
        </span>
        <span>
          24 小时内巡检{' '}
          <strong>
            {health.checked}/{health.total}
          </strong>{' '}
          个来源
        </span>
        <ChevronDown size={13} />
      </summary>
      <div className="collection-health-body">
        <p>
          全站保留 {data.jobs.length.toLocaleString()} 条机会；
          {health.incomplete} 个来源覆盖不完整，已知{' '}
          {health.pending.toLocaleString()}{' '}
          条详情待补。快照更新表示有采集进展，不代表每个来源均已更新。
        </p>
        <p>
          当前筛选的最新发布：{latest || '暂无明确日期'}。
          {city === '全部城市' ? '全部城市' : city}已收录 {talks.length}{' '}
          场后续宣讲；宣讲地点与工作地点分别核实。
        </p>
        {origin === 'local' && (
          <p>
            当前使用仓库自带历史数据。正常启动本地预览会读取线上快照；离线数据不会冒充最新采集结果。
          </p>
        )}
        <button className="btn btn-ghost btn-sm" onClick={onSources}>
          查看各来源巡检时间与失败原因
        </button>
      </div>
    </details>
  );
}
