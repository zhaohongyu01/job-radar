'use client';

import { Briefcase, Database, Radar, ShieldCheck } from 'lucide-react';
import type { Filters } from '@/lib/jobs';
import type { WorkspaceMode } from '@/lib/exams';

export interface AppHeaderProps {
  workspaceMode: WorkspaceMode;
  onSwitchWorkspace: (mode: WorkspaceMode) => void;
  activeView: Filters['view'];
  onOpenView: (view: Filters['view']) => void;
  hasData: boolean;
  savedCount: number;
  appliedCount: number;
  onOpenSources: () => void;
}

export function AppHeader({
  workspaceMode,
  onSwitchWorkspace,
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
            <small>{workspaceMode === 'exams' ? '考公考编工作台' : '求职工作台'}</small>
          </div>
        </div>

        <div className="workspace-mode-switcher" role="tablist" aria-label="工作台模式切换">
          <button
            type="button"
            role="tab"
            aria-selected={workspaceMode === 'jobs'}
            className={`workspace-mode-btn ${workspaceMode === 'jobs' ? 'is-active' : ''}`}
            onClick={() => onSwitchWorkspace('jobs')}
          >
            <Briefcase size={15} />
            <span>企业求职</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={workspaceMode === 'exams'}
            className={`workspace-mode-btn is-exam ${workspaceMode === 'exams' ? 'is-active' : ''}`}
            onClick={() => onSwitchWorkspace('exams')}
          >
            <ShieldCheck size={15} />
            <span>考公考编</span>
          </button>
        </div>

        {workspaceMode === 'jobs' && (
          <>
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
          </>
        )}
      </div>
    </header>
  );
}
