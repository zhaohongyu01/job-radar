'use client';

import { Database, Radar } from 'lucide-react';
import type { Filters } from '@/lib/jobs';
import { WorkspaceSwitch } from '@/components/workspace-switch';

export interface AppHeaderProps {
  activeView: Filters['view'];
  onOpenView: (view: Filters['view']) => void;
  hasData: boolean;
  savedCount: number;
  appliedCount: number;
  onOpenSources: () => void;
}

export function AppHeader({
  activeView,
  onOpenView,
  hasData,
  savedCount,
  appliedCount,
  onOpenSources,
}: AppHeaderProps) {
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
            className="app-nav-item"
            aria-current={activeView === 'all' ? 'page' : undefined}
            onClick={() => onOpenView('all')}
          >
            发现机会
          </button>
          <button
            className="app-nav-item"
            aria-current={activeView === 'saved' ? 'page' : undefined}
            onClick={() => onOpenView('saved')}
          >
            我的收藏 <span className="app-nav-count">{hasData ? savedCount : '—'}</span>
          </button>
          <button
            className="app-nav-item"
            aria-current={activeView === 'planned' ? 'page' : undefined}
            onClick={() => onOpenView('planned')}
          >
            待投递
          </button>
          <button
            className="app-nav-item"
            aria-current={activeView === 'pipeline' || activeView === 'applied' ? 'page' : undefined}
            onClick={() => onOpenView('pipeline')}
          >
            投递看板 <span className="app-nav-count">{hasData ? appliedCount : '—'}</span>
          </button>
        </nav>
        <div className="app-bar-actions">
          <button className="btn btn-ghost btn-sm" onClick={onOpenSources}>
            <Database size={15} />
            <span>信息来源</span>
          </button>
        </div>
      </div>
    </header>
  );
}
