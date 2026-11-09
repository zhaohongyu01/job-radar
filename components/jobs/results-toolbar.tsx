'use client';

import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { selectedWorkCities } from '@/lib/jobs';
import type { Filters, Job, Snapshot } from '@/lib/jobs';
import type { CardDensity, ViewMode } from '@/lib/browsing';

export type LocationScopeOption = {
  scope: 'exact' | 'possible' | 'unknown';
  label: string;
  count: number;
};

export interface ResultsToolbarProps {
  data: Snapshot | null;
  loading: boolean;
  progressiveProgress: { loaded: number; total: number } | null;
  searchPending: boolean;
  searchError: string;
  onRetrySearch: () => void;
  filtered: Job[];
  groupsCount: number;
  filters: Filters;
  since: string | null;
  newCount: number;
  groupCompanies: boolean;
  onToggleGroupCompanies: () => void;
  onOpenView: (view: Filters['view']) => void;
  onChange: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  onRemoveWorkCity: (city: string) => void;
  onResetFilters: () => void;
  hasReputationScores: boolean;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  cardDensity: CardDensity;
  onCardDensityChange: (density: CardDensity) => void;
  pages: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  locationOptions: LocationScopeOption[];
}

export function ResultsToolbar({
  data,
  loading,
  progressiveProgress,
  searchPending,
  searchError,
  onRetrySearch,
  filtered,
  groupsCount,
  filters,
  since,
  newCount,
  groupCompanies,
  onToggleGroupCompanies,
  onOpenView,
  onChange,
  onRemoveWorkCity,
  onResetFilters,
  hasReputationScores,
  viewMode,
  onViewModeChange,
  cardDensity,
  onCardDensityChange,
  pages,
  currentPage,
  onPageChange,
  locationOptions,
}: ResultsToolbarProps) {
  return (
    <>
      <div className="result-bar">
        <div className="result-bar-left">
          <div className="result-count" aria-live="polite">
            {!data ? (
              <output className={loading ? 'progressive-pill' : undefined}>
                {loading
                  ? progressiveProgress
                    ? `已加载 ${progressiveProgress.loaded.toLocaleString()} / ${progressiveProgress.total.toLocaleString()} 条，完整结果仍在加载`
                    : '正在加载完整索引…'
                  : '索引未完成，请重试加载'}
              </output>
            ) : searchPending ? (
              searchError ? (
                <div role="alert">
                  <span>{searchError}</span>{' '}
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={onRetrySearch}
                  >
                    重试全文搜索
                  </button>
                </div>
              ) : (
                <output>
                  正在读取全文索引，先显示标题/企业/岗位名称匹配的 {filtered.length} 条，完整结果稍后更新…
                </output>
              )
            ) : (
              <>
                <div className="result-count-main">
                  <span className="result-count-num">{filtered.length}</span>
                  <span className="result-count-unit">条机会</span>
                  {progressiveProgress && (
                    <span className="progressive-pill" title="更新完成前保留上次完整结果">
                      正在更新 {progressiveProgress.loaded.toLocaleString()} / {progressiveProgress.total.toLocaleString()} 条
                    </span>
                  )}
                </div>
                <span
                  className="result-count-breakdown"
                  title={
                    filters.type === '校招' && filters.year !== '全部'
                      ? `明确${filters.year}届 ${filtered.filter((j) => j.graduation_years.includes(filters.year)).length} 条${filters.includeUncertain ? `（含 ${filtered.filter((j) => j.graduation_years.length === 0).length} 条届别未明确）` : ''}`
                      : undefined
                  }
                >
                  （{filtered.filter((j) => j.kind === '具体岗位').length} 岗位 / {filtered.filter((j) => j.kind !== '具体岗位').length} 公告{groupCompanies ? ` · ${groupsCount} 组` : ''}）
                </span>
                {filters.type === '校招' && filters.year !== '全部' && (
                  <span className="result-cohort-stat">
                    明确{filters.year}届 <strong>{filtered.filter((j) => j.graduation_years.includes(filters.year)).length}</strong> 条
                    {filters.includeUncertain && (
                      <span className="text-muted">
                        （{filtered.filter((j) => j.graduation_years.length === 0).length} 未明确）
                      </span>
                    )}
                  </span>
                )}
                {filters.salary !== '全部' && (
                  <span className="chip chip-brand">薪资 {filters.salary}</span>
                )}
                {filters.radarFocus !== 'none' && (
                  <span className="focus-chip">
                    <span>
                      {filters.radarFocus === 'today' && '今日发布 / 收录'}
                      {filters.radarFocus === 'supplement' && '补录机会'}
                      {filters.radarFocus === 'urgent' && '3 天内截止'}
                      {filters.radarFocus === 'change' && '近期变更'}
                    </span>
                    <button
                      type="button"
                      onClick={() => onChange('radarFocus', 'none')}
                      title="点击取消聚焦，查看全部"
                      aria-label="取消聚焦"
                    >
                      <X size={12} />
                    </button>
                  </span>
                )}
              </>
            )}
          </div>

          <div className="result-toggles">
            <button
              type="button"
              className="toggle-chip toggle-chip-sm"
              aria-pressed={filters.onlyUnread}
              onClick={() => onChange('onlyUnread', !filters.onlyUnread)}
            >
              只看未读
            </button>
            <button
              type="button"
              className="toggle-chip toggle-chip-sm"
              aria-pressed={filters.onlyNew}
              onClick={() => onChange('onlyNew', !filters.onlyNew)}
              title={
                since && newCount > 0
                  ? `全库有 ${newCount} 条自上次访问以来首次收录或内容变更；首次收录不代表刚发布`
                  : undefined
              }
            >
              新收录 / 变更
            </button>
            <button
              type="button"
              className="toggle-chip toggle-chip-sm toggle-merge"
              aria-pressed={groupCompanies}
              onClick={onToggleGroupCompanies}
            >
              合并同企业
            </button>
            <button
              type="button"
              className="toggle-chip toggle-chip-sm"
              aria-pressed={filters.view === 'hidden'}
              onClick={() => onOpenView(filters.view === 'hidden' ? 'all' : 'hidden')}
            >
              {filters.view === 'hidden' ? '返回全部机会' : '不感兴趣'}
            </button>
          </div>
        </div>

        <div className="result-tools">
          <Select value={filters.sort} onValueChange={(v) => onChange('sort', v as Filters['sort'])}>
            <SelectTrigger className="sort-trigger" aria-label="排序方式">
              <SelectValue>
                {filters.sort === 'deadline_asc'
                  ? '即将截止优先'
                  : filters.sort === 'salary_desc'
                    ? '薪资从高到低'
                    : filters.sort === 'reputation_desc'
                      ? '企业体验参考优先'
                      : filters.sort === 'employer_intent_desc'
                        ? '我的企业意向优先'
                        : '最新发布'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">最新发布</SelectItem>
              <SelectItem value="deadline_asc">即将截止优先</SelectItem>
              <SelectItem value="salary_desc">薪资从高到低</SelectItem>
              {(hasReputationScores || filters.sort === 'reputation_desc') && (
                <SelectItem value="reputation_desc">企业体验参考优先</SelectItem>
              )}
              <SelectItem value="employer_intent_desc">我的企业意向优先</SelectItem>
            </SelectContent>
          </Select>

          <fieldset className="seg" aria-label="招聘信息显示方式">
            <button
              type="button"
              aria-pressed={viewMode === 'cards'}
              onClick={() => onViewModeChange('cards')}
            >
              卡片
            </button>
            <button
              type="button"
              aria-pressed={viewMode === 'table'}
              onClick={() => onViewModeChange('table')}
            >
              表格
            </button>
          </fieldset>

          {viewMode === 'cards' && (
            <fieldset className="seg seg-density" aria-label="卡片密度">
              <button
                type="button"
                aria-pressed={cardDensity === 'standard'}
                onClick={() => onCardDensityChange('standard')}
              >
                标准
              </button>
              <button
                type="button"
                aria-pressed={cardDensity === 'compact'}
                onClick={() => onCardDensityChange('compact')}
              >
                紧凑
              </button>
            </fieldset>
          )}

          {pages > 1 && !searchPending && (
            <div className="pager-mini">
              <button
                className="icon-btn"
                disabled={currentPage === 1}
                onClick={() => onPageChange(currentPage - 1)}
                aria-label="上一页"
              >
                <ChevronLeft size={16} />
              </button>
              <span>{currentPage} / {pages}</span>
              <button
                className="icon-btn"
                disabled={currentPage === pages}
                onClick={() => onPageChange(currentPage + 1)}
                aria-label="下一页"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="result-subbar">
        {selectedWorkCities(filters).length > 0 ? (
          <div className="scope-bar">
            <fieldset className="seg" aria-label="工作地点匹配范围">
              {locationOptions.map((option) => (
                <button
                  key={option.scope}
                  type="button"
                  aria-pressed={filters.locationScope === option.scope}
                  onClick={() => onChange('locationScope', option.scope)}
                >
                  {option.label}
                  <span className="seg-count">{data ? option.count : '…'}</span>
                </button>
              ))}
            </fieldset>
          </div>
        ) : (
          <div />
        )}

        <div className="filter-chips" aria-label="已选筛选条件">
          <span>当前筛选</span>
          {filters.workCities && filters.workCities.length > 0 ? (
            filters.workCities.map((c) => (
              <button
                key={`workCity-${c}`}
                className="filter-chip"
                onClick={() => onRemoveWorkCity(c)}
                aria-label={`移除城市：${c}`}
              >
                {c}
                <X size={12} />
              </button>
            ))
          ) : filters.city !== '全部城市' ? (
            <button
              key="city"
              className="filter-chip"
              onClick={() => onChange('city', '全部城市')}
              aria-label={`移除城市：${filters.city}`}
            >
              {filters.city}
              <X size={12} />
            </button>
          ) : null}
          {([
            ['type', filters.type, '全部', filters.type],
            ...(filters.type === '校招' ? [['year', filters.year, '全部', `${filters.year}届`]] : []),
            ['sector', filters.sector, '全部', filters.sector],
            ['direction', filters.direction, '全部', filters.direction],
            ['salary', filters.salary, '全部', `薪资${filters.salary}`],
            ['education', filters.education, '', `学历：${filters.education}`],
            ['major', filters.major || '', '', `专业：${filters.major}`],
            [
              'employmentType',
              filters.employmentType || 'all',
              'all',
              ({ full_time: '全职', internship: '实习', part_time: '兼职' } as Record<string, string>)[
                filters.employmentType || ''
              ] || '',
            ],
            ['provenance', filters.provenance, '全部', filters.provenance],
            ['kind', filters.kind, '全部', filters.kind],
            ['changeType', filters.changeType, '全部', filters.changeType],
            [
              'validity',
              filters.validity || 'all',
              'all',
              ({
                confirmed_open: '近期核验在招',
                long_term: '原文长期招聘',
                unconfirmed: '有效性待核实',
              } as Record<string, string>)[filters.validity || ''] || '',
            ],
            ['reputationMin', filters.reputationMin || 'all', 'all', `体验参考≥${filters.reputationMin}分`],
          ] as [keyof Filters, string, string, string][])
            .filter(([, value, empty]) => value !== empty)
            .map(([key, , empty, label]) => (
              <button
                key={key}
                className="filter-chip"
                onClick={() => onChange(key, empty as never)}
                aria-label={`移除筛选：${label}`}
              >
                {label}
                <X size={12} />
              </button>
            ))}
          {filters.showExpired && (
            <button
              type="button"
              className="filter-chip"
              onClick={() => onChange('showExpired', false)}
              aria-label="移除筛选：含已截止"
            >
              含已截止
              <X size={12} />
            </button>
          )}
          {!filters.includeUncertain && (
            <button
              type="button"
              className="filter-chip"
              onClick={() => onChange('includeUncertain', true)}
              aria-label="移除筛选：不含信息未明确的公告"
            >
              不含信息未明确的公告
              <X size={12} />
            </button>
          )}
          {filters.includeRelatedTalks && (
            <button
              type="button"
              className="filter-chip"
              onClick={() => onChange('includeRelatedTalks', false)}
              aria-label="移除筛选：含本城宣讲关联"
            >
              含本城宣讲关联
              <X size={12} />
            </button>
          )}
          {filters.reputationMin !== 'all' && filters.includeUnrated === false && (
            <button
              type="button"
              className="filter-chip"
              onClick={() => onChange('includeUnrated', true)}
            >
              仅看样本充分的企业
              <X size={12} />
            </button>
          )}
          <button className="text-btn" onClick={onResetFilters}>
            恢复默认
          </button>
        </div>
      </div>
    </>
  );
}
