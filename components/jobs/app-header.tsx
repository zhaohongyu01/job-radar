'use client';

import { Command, Radar, RefreshCw } from 'lucide-react';
import type { Filters, Job, Personal } from '@/lib/jobs';
import { WorkspaceSwitch } from '@/components/workspace-switch';
import { PersonalReminders } from '@/components/personal-reminders';
import { FeedSubscribePopover } from '@/components/feed-subscribe-popover';
import { ThemeToggle } from '@/components/theme-toggle';

export interface AppHeaderProps {
  activeView: Filters['view'];
  onOpenView: (view: Filters['view']) => void;
  hasData: boolean;
  pendingCount: number;
  trackingCount: number;
  loading: boolean;
  stale: boolean;
  lastSuccessAt?: string | null;
  progressiveProgress: { loaded: number; total: number } | null;
  onOpenSources: () => void;
  onRefresh: () => void;
  onOpenCommandPalette?: () => void;
  jobs: Job[];
  personal: Personal;
  now: number;
  ready: boolean;
  onDetail: (job: Job) => void;
}

function formatStatusTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function StatusButton({
  hasData,
  loading,
  stale,
  lastSuccessAt,
  progressiveProgress,
  onClick,
}: {
  hasData: boolean;
  loading: boolean;
  stale: boolean;
  lastSuccessAt?: string | null;
  progressiveProgress: { loaded: number; total: number } | null;
  onClick: () => void;
}) {
  const pct = progressiveProgress
    ? Math.min(
        100,
        Math.round((progressiveProgress.loaded / Math.max(1, progressiveProgress.total)) * 100),
      )
    : null;
  const timeText = formatStatusTime(lastSuccessAt);
  const label =
    loading && pct !== null
      ? `加载中 ${pct}%`
      : loading && !hasData
        ? '加载中…'
        : timeText
          ? `更新于 ${timeText}`
          : '信息来源';

  return (
    <button
      type="button"
      className={`btn btn-ghost btn-sm status-btn ${!lastSuccessAt || stale ? 'is-stale' : ''}`}
      onClick={onClick}
      aria-label={`查看信息来源与更新状态（${label}）`}
      title="查看信息来源与更新状态"
    >
      <span className="freshness-dot" aria-hidden="true" />
      <span className="status-btn-label">{label}</span>
    </button>
  );
}

export function AppHeader({
  activeView,
  onOpenView,
  hasData,
  pendingCount,
  trackingCount,
  loading,
  stale,
  lastSuccessAt,
  progressiveProgress,
  onOpenSources,
  onRefresh,
  onOpenCommandPalette,
  jobs,
  personal,
  now,
  ready,
  onDetail,
}: AppHeaderProps) {
  const isSavedSection =
    activeView === 'planned' || activeView === 'saved' || activeView === 'hidden';
  const isTrackingSection = activeView === 'pipeline' || activeView === 'applied';
  const progressPct = progressiveProgress
    ? Math.min(
        100,
        Math.max(4, Math.round((progressiveProgress.loaded / Math.max(1, progressiveProgress.total)) * 100)),
      )
    : null;

  return (
    <header className="app-bar">
      <div className="app-bar-inner">
        <div className="brand-mark">
          <Radar size={26} />
          <div className="brand-text">
            <strong>职讯雷达</strong>
            <small>求职工作台</small>
          </div>
        </div>

        <WorkspaceSwitch active="jobs" />

        <nav className="app-nav" aria-label="工作台导航">
          <button
            type="button"
            className="app-nav-item"
            aria-current={activeView === 'all' ? 'page' : undefined}
            onClick={() => onOpenView('all')}
          >
            发现机会
          </button>
          <button
            type="button"
            className="app-nav-item"
            aria-current={isSavedSection ? 'page' : undefined}
            onClick={() => onOpenView('planned')}
          >
            我的收藏 <span className="app-nav-count">{hasData ? pendingCount : '—'}</span>
          </button>
          <button
            type="button"
            className="app-nav-item"
            aria-current={isTrackingSection ? 'page' : undefined}
            onClick={() => onOpenView('pipeline')}
          >
            投递跟进 <span className="app-nav-count">{hasData ? trackingCount : '—'}</span>
          </button>
        </nav>

        <div className="app-bar-actions">
          {onOpenCommandPalette && (
            <button
              type="button"
              className="btn btn-secondary btn-sm cmdk-trigger-btn"
              onClick={onOpenCommandPalette}
              aria-label="打开全局快捷命令与检索（Ctrl+K）"
              title="全局检索与操作（⌘K / Ctrl+K）"
            >
              <Command size={13} />
              <span>速查</span>
              <kbd className="kbd">⌘K</kbd>
            </button>
          )}
          {ready && (
            <PersonalReminders jobs={jobs} personal={personal} now={now} onDetail={onDetail} />
          )}
          <FeedSubscribePopover />
          <StatusButton
            hasData={hasData}
            loading={loading}
            stale={stale}
            lastSuccessAt={lastSuccessAt}
            progressiveProgress={progressiveProgress}
            onClick={onOpenSources}
          />
          <ThemeToggle />
          <button
            type="button"
            className="icon-btn"
            onClick={onRefresh}
            disabled={loading}
            aria-label="重新读取招聘数据"
            title="重新读取招聘数据"
          >
            <RefreshCw size={14} className={loading ? 'spinning' : ''} />
          </button>
        </div>
      </div>
      {loading && (
        <div className="app-bar-progress" aria-hidden="true">
          <div
            className={`app-bar-progress-fill${progressPct === null ? ' is-indeterminate' : ''}`}
            style={progressPct !== null ? { width: `${progressPct}%` } : undefined}
          />
        </div>
      )}
    </header>
  );
}
