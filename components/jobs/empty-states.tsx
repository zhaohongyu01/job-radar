'use client';

import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyTitle } from '@/components/ui/empty';
import { defaultFilters, selectedWorkCities } from '@/lib/jobs';
import type { Filters, Snapshot } from '@/lib/jobs';
import type { LocationScopeOption } from '@/components/jobs/results-toolbar';

export interface JobsEmptyStatesProps {
  data: Snapshot | null;
  filteredCount: number;
  loading: boolean;
  searchPending: boolean;
  error: string;
  filters: Filters;
  locationOptions: LocationScopeOption[];
  onOpenView: (view: Filters['view']) => void;
  onSelectLocationScope: (scope: LocationScopeOption['scope']) => void;
  onRelaxFilters: (nextFilters: Filters) => void;
}

export function JobsEmptyStates({
  data,
  filteredCount,
  loading,
  searchPending,
  error,
  filters,
  locationOptions,
  onOpenView,
  onSelectLocationScope,
  onRelaxFilters,
}: JobsEmptyStatesProps) {
  if (!data || filteredCount > 0 || loading || searchPending || error) {
    return null;
  }

  if (filters.view !== 'all') {
    return (
      <Empty className="empty-state">
        <Search size={30} />
        <EmptyTitle className="text-lg">这里还没有记录</EmptyTitle>
        <EmptyDescription>
          {filters.query.trim()
            ? '没有与搜索词匹配的个人记录，可清空搜索后再看。'
            : '在「发现机会」里收藏或标记岗位后，会出现在这里。'}
        </EmptyDescription>
        <Button variant="outline" onClick={() => onOpenView('all')}>
          去发现机会
        </Button>
      </Empty>
    );
  }

  return (
    <Empty className="empty-state">
      <Search size={30} />
      <EmptyTitle className="text-lg">没有符合当前条件的公告</EmptyTitle>
      <EmptyDescription>
        当前来源尚未收录符合这些条件的公告，不代表没有招聘。可切换地点范围，或清除岗位方向、学历和关键词限制。
      </EmptyDescription>
      {selectedWorkCities(filters).length > 0 &&
        locationOptions
          .filter((option) => option.scope !== filters.locationScope && option.count > 0)
          .map((option) => (
            <Button
              key={option.scope}
              variant="outline"
              onClick={() => onSelectLocationScope(option.scope)}
            >
              另有 {option.count} 条匹配信息：{option.label}，点击查看
            </Button>
          ))}
      <Button
        variant="outline"
        onClick={() => {
          onRelaxFilters({
            ...defaultFilters,
            city: filters.city,
            workCities: filters.workCities,
            includeRelatedTalks: filters.includeRelatedTalks,
            view: filters.view,
            locationScope: filters.locationScope,
            type: '全部',
            sector: '全部',
            direction: '全部',
            education: '',
            query: '',
            onlyNew: false,
            onlyUnread: false,
            includeUncertain: true,
            salary: '全部',
            sort: 'newest',
          });
        }}
      >
        放宽条件，保留当前城市
      </Button>
    </Empty>
  );
}
