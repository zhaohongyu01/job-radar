'use client';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import type { Snapshot } from '@/lib/jobs';
import { formatDate as date, OutLink } from '@/components/job-card';
import { ReputationCoverage } from '@/components/reputation-coverage';

export function SourceStatusSheet({
  open,
  onOpenChange,
  data,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: Snapshot | null;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="detail-sheet">
        <SheetHeader className="detail-header">
          <SheetTitle>来源与更新状态</SheetTitle>
          <SheetDescription>
            城市可选范围不等于已完整覆盖的城市。
          </SheetDescription>
        </SheetHeader>
        <div className="detail-body">
          <ReputationCoverage />
          <div className="apply-panel">
            <h3>
              {data?.schedule_enabled
                ? '每日更新已启用'
                : '每日自动更新尚未启用'}
            </h3>
            <p>
              本页展示最近一次采集结果。首次收录、原站发布和内容变化分别记录；采集失败不会把旧公告下架。
            </p>
          </div>
          {data?.sources.map((s) => (
            <article className="source-card" key={s.id}>
              <h3>
                {s.name}
                <span className={'tag ' + (s.status === 'ok' ? 'new' : '')}>
                  {s.status === 'ok'
                    ? '本次读取成功'
                    : s.status === 'partial'
                      ? '部分失败'
                      : s.status === 'deferred'
                        ? '按需联动'
                        : s.status === 'blocked'
                          ? '临时冷却'
                          : '本次读取失败'}
                </span>
              </h3>
              {(s.scope || s.recruitment_types?.length || s.sectors?.length || s.trust) && (
                <div className="tags" aria-label="来源范围与类型">
                  {s.scope && <span className="tag">范围：{s.scope}</span>}
                  {s.recruitment_types?.map((type) => (
                    <span className="tag blue" key={`${s.id}-${type}`}>
                      {type}
                    </span>
                  ))}
                  {s.sectors?.map((sector) => (
                    <span className="tag" key={`${s.id}-${sector}`}>
                      {sector}
                    </span>
                  ))}
                  {s.trust && <span className="tag">{s.trust}</span>}
                </div>
              )}
              <p>
                读取 {s.pages ?? 0} 页，发现 {s.discovered ?? 0} 条、详情解析 {s.parsed ?? 0}{' '}
                条{s.cached ? `、复用近期已核实 ${s.cached} 条` : ''} · {s.coverage || '按规则运行'}
              </p>
              <p>最近列表巡检：{date(s.last_list_read_at || s.head_scan_at || ((s.pages ?? 0) > 0 ? s.last_attempt_at : null), true)}</p>
              <p>最近完整成功：{date(s.last_success_at, true)} · 待补详情 {s.pending_details ?? 0} 条</p>
              <p>最近尝试：{date(s.last_attempt_at, true)}</p>
              {Boolean(s.errors && s.errors.length > 0) && (
                <p className="warning-text">
                  {s.errors?.length} 项读取异常，相关旧记录仍保留。
                </p>
              )}
              <OutLink url={s.url}>访问来源</OutLink>
            </article>
          ))}
          <p className="source-note">
            以上为当前接入的公开来源及其最近巡检状态；更多银行、企业官网、事业单位和公务员专栏仍会按来源健康度逐步适配。当前没有结果不代表没有招聘。
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
