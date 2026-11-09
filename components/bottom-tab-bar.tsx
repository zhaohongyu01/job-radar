'use client';

import Link from 'next/link';
import {
  Bookmark,
  Briefcase,
  Compass,
  FileSpreadsheet,
  Kanban,
  Landmark,
} from 'lucide-react';
import type { Filters } from '@/lib/jobs';
import type { ExamFilters } from '@/lib/exams';

export type BottomTabBarProps =
  | {
      workspace: 'jobs';
      activeView: Filters['view'];
      onOpenView: (view: Filters['view']) => void;
      hasData: boolean;
      pendingCount: number;
      trackingCount: number;
    }
  | {
      workspace: 'exams';
      activeView: ExamFilters['view'];
      onSwitchView: (view: ExamFilters['view']) => void;
      savedCount: number;
      trackedCount: number;
    };

export function BottomTabBar(props: BottomTabBarProps) {
  if (props.workspace === 'jobs') {
    const { activeView, onOpenView, hasData, pendingCount, trackingCount } = props;
    const isSaved =
      activeView === 'planned' || activeView === 'saved' || activeView === 'hidden';
    const isTracking = activeView === 'pipeline' || activeView === 'applied';

    return (
      <nav className="bottom-tab-bar" aria-label="移动端底部导航">
        <button
          type="button"
          className={`bottom-tab${activeView === 'all' ? ' is-active' : ''}`}
          aria-current={activeView === 'all' ? 'page' : undefined}
          onClick={() => onOpenView('all')}
        >
          <Compass size={18} />
          <span>发现</span>
        </button>
        <button
          type="button"
          className={`bottom-tab${isSaved ? ' is-active' : ''}`}
          aria-current={isSaved ? 'page' : undefined}
          onClick={() => onOpenView('planned')}
        >
          <Bookmark size={18} />
          <span>
            收藏{hasData && pendingCount > 0 ? ` ${pendingCount}` : ''}
          </span>
        </button>
        <button
          type="button"
          className={`bottom-tab${isTracking ? ' is-active' : ''}`}
          aria-current={isTracking ? 'page' : undefined}
          onClick={() => onOpenView('pipeline')}
        >
          <Kanban size={18} />
          <span>
            跟进{hasData && trackingCount > 0 ? ` ${trackingCount}` : ''}
          </span>
        </button>
        <Link href="/exams" className="bottom-tab">
          <Landmark size={18} />
          <span>考编</span>
        </Link>
      </nav>
    );
  }

  const { activeView, onSwitchView, savedCount, trackedCount } = props;
  return (
    <nav className="bottom-tab-bar" aria-label="移动端底部导航">
      <button
        type="button"
        className={`bottom-tab${activeView === 'announcements' ? ' is-active' : ''}`}
        aria-current={activeView === 'announcements' ? 'page' : undefined}
        onClick={() => onSwitchView('announcements')}
      >
        <Landmark size={18} />
        <span>公告</span>
      </button>
      <button
        type="button"
        className={`bottom-tab${activeView === 'positions' ? ' is-active' : ''}`}
        aria-current={activeView === 'positions' ? 'page' : undefined}
        onClick={() => onSwitchView('positions')}
      >
        <FileSpreadsheet size={18} />
        <span>职位库</span>
      </button>
      <button
        type="button"
        className={`bottom-tab${activeView === 'saved' ? ' is-active' : ''}`}
        aria-current={activeView === 'saved' ? 'page' : undefined}
        onClick={() => onSwitchView('saved')}
      >
        <Bookmark size={18} />
        <span>收藏{savedCount > 0 ? ` ${savedCount}` : ''}</span>
      </button>
      <button
        type="button"
        className={`bottom-tab${activeView === 'tracker' ? ' is-active' : ''}`}
        aria-current={activeView === 'tracker' ? 'page' : undefined}
        onClick={() => onSwitchView('tracker')}
      >
        <Kanban size={18} />
        <span>进度{trackedCount > 0 ? ` ${trackedCount}` : ''}</span>
      </button>
      <Link href="/" className="bottom-tab">
        <Briefcase size={18} />
        <span>求职</span>
      </Link>
    </nav>
  );
}
