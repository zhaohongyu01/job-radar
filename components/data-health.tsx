'use client';

import { useMemo } from 'react';
import { Database, ChevronDown } from 'lucide-react';
import type { Job, Snapshot } from '@/lib/jobs';
import { collectionHealth, latestPublication } from '@/lib/data-health';
import { upcomingTalks } from '@/lib/workspace';
import { agendaCoverageMessage } from '@/lib/city-coverage';
import type { CoverageReport } from '@/lib/city-coverage';

export function DataHealth({
  data,
  now,
  city,
  visibleJobs,
  origin,
  onSources,
  coverage,
}: {
  data: Snapshot;
  now: number;
  city: string | string[];
  visibleJobs: Job[];
  origin: string;
  onSources: () => void;
  coverage?: CoverageReport | null;
}) {
  const health = useMemo(() => collectionHealth(data, now), [data, now]);
  const cityKey = (typeof city === 'string' ? (city === '全部城市' ? [] : [city]) : city).join('|');
  const talks = useMemo(
    () => upcomingTalks(data.jobs, {}, cityKey ? cityKey.split('|') : [], now),
    [data.jobs, cityKey, now],
  );
  const cityLabel = cityKey ? cityKey.split('|').join(' / ') : '全部城市';
  // City coverage notes exist per city; show them only for a single selected city.
  const single = cityKey && !cityKey.includes('|') ? cityKey : '';
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
          {cityLabel}已收录 {talks.length}{' '}
          场后续宣讲；宣讲地点与工作地点分别核实。
        </p>
        <p>{!single ? '全国城市可筛选；各城市的本地渠道接入程度不同。' : agendaCoverageMessage(coverage?.cities[single], now)}</p>
        {single && coverage?.cities[single] && <p>
          本地信息渠道 {coverage.cities[single].local_sources.length} 个，日历渠道 {coverage.cities[single].calendar_sources.length} 个；
          计划补齐：{coverage.cities[single].planned_schools.join('、') || '尚无新增学校计划'}。已接渠道数量不等于全市完整覆盖。
        </p>}
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
