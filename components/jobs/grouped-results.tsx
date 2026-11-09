'use client';

import { useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { JobTable } from '@/components/job-table';
import { JobCard } from '@/components/job-card';
import { buildGroupRoleItems } from '@/lib/grouping';
import type { GroupRoleItem, JobGroup } from '@/lib/grouping';
import { isUnread, personalFor, selectedWorkCities } from '@/lib/jobs';
import type { Filters, Job, Personal } from '@/lib/jobs';
import type { CardDensity, ViewMode } from '@/lib/browsing';

export type DisplayBlock = JobGroup & { grouped: boolean };

export interface GroupedResultsProps {
  displayBlocks: DisplayBlock[];
  viewMode: ViewMode;
  filters: Filters;
  personal: Personal;
  ready: boolean;
  now: number;
  since: string | null;
  cardDensity: CardDensity;
  selectedId: string | null;
  onDetail: (job: Job) => void;
  onRead: (job: Job) => void;
  onReadChange: (job: Job, read: boolean) => void;
  onToggle: (job: Job, key: 'saved' | 'applied' | 'hidden') => void;
  onStageChange: (job: Job, nextStage: NonNullable<Filters['applicationStage']>) => void;
  onCopy: (job: Job) => void;
}

export function GroupedResults({
  displayBlocks,
  viewMode,
  filters,
  personal,
  ready,
  now,
  since,
  cardDensity,
  selectedId,
  onDetail,
  onRead,
  onReadChange,
  onToggle,
  onStageChange,
  onCopy,
}: GroupedResultsProps) {
  const [groupRoleFilter, setGroupRoleFilter] = useState<Record<string, string>>({});

  return (
    <>
      {displayBlocks.map((group) => {
        const renderJobs = (jobs: Job[]) =>
          viewMode === 'table' ? (
            <JobTable
              jobs={jobs}
              city={selectedWorkCities(filters)}
              personal={personal}
              ready={ready}
              now={now}
              onDetail={onDetail}
              onRead={onRead}
              onReadChange={onReadChange}
              onToggle={onToggle}
            />
          ) : (
            jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                filters={filters}
                record={personalFor(job, personal)}
                ready={ready}
                now={now}
                since={since}
                density={cardDensity}
                onDetail={onDetail}
                onRead={onRead}
                onReadChange={onReadChange}
                onToggle={onToggle}
                onStageChange={onStageChange}
                onCopy={onCopy}
              />
            ))
          );

        // Groups show their newest record; the rest expand on demand so a
        // page of N groups never renders hundreds of cards.
        const roleItems = group.grouped ? buildGroupRoleItems(group.jobs, group.company) : [];
        const roleQueryRaw = groupRoleFilter[group.id] || '';
        const roleQuery = roleQueryRaw.trim().toLowerCase();
        const filteredRoleItems = roleQuery
          ? roleItems.filter((r) => r.searchText.includes(roleQuery))
          : roleItems;

        const renderRoleChip = (roleItem: GroupRoleItem, idx: number) => {
          const item = roleItem.job;
          const isActive = Boolean(selectedId && selectedId === item.id);
          const rec = personalFor(item, personal);
          const itemApplied = Boolean(rec.applied);
          const itemSaved = Boolean(rec.saved);
          const itemUnread = isUnread(item, personal);
          const stateClass = itemApplied
            ? ' is-applied'
            : itemSaved
              ? ' is-saved'
              : !itemUnread
                ? ' is-read'
                : '';
          return (
            <button
              key={item.id || `${group.id}-role-${idx}`}
              type="button"
              className={`opp-group-role-chip${isActive ? ' is-active' : ''}${stateClass}`}
              onClick={() => onDetail(item)}
              title={`${roleItem.rawRole}${roleItem.tooltipMeta ? ` · ${roleItem.tooltipMeta}` : ''}${itemApplied ? '（已投递）' : itemSaved ? '（已收藏）' : ''}（点击查看岗位详情与投递链接）`}
            >
              {itemApplied && (
                <span className="opp-group-role-status" aria-hidden="true">
                  ✓
                </span>
              )}
              {!itemApplied && itemSaved && (
                <span className="opp-group-role-status" aria-hidden="true">
                  ★
                </span>
              )}
              <span className="opp-group-role-name">{roleItem.cleanRole}</span>
              {roleItem.suffix && <span className="opp-group-role-meta">· {roleItem.suffix}</span>}
            </button>
          );
        };

        return group.grouped ? (
          <div className="opp-group" key={group.id}>
            <div className="opp-group-head">
              <div className="opp-group-title">
                <strong>{group.company}</strong>
                <span>
                  {group.label} · 最新 {group.jobs[0].published_at || '日期未明确'}
                </span>
              </div>
              <div className="opp-group-count">
                <span>共 {group.jobs.length} 个在招岗位</span>
              </div>
            </div>
            <div className="opp-group-directory" aria-label={`${group.company}在招岗位速览`}>
              {group.jobs.length >= 12 && (
                <div className="opp-group-directory-bar">
                  <span className="opp-group-directory-label">在招岗位</span>
                  <div className="opp-group-filter">
                    <Search size={12} />
                    <input
                      type="text"
                      value={roleQueryRaw}
                      onChange={(e) =>
                        setGroupRoleFilter((prev) => ({
                          ...prev,
                          [group.id]: e.target.value,
                        }))
                      }
                      placeholder="筛选本组岗位 / 城市 / 部门…"
                      aria-label={`筛选${group.company}在招岗位`}
                    />
                    {roleQueryRaw && (
                      <button
                        type="button"
                        className="opp-group-filter-clear"
                        aria-label="清空本组岗位筛选"
                        onClick={() =>
                          setGroupRoleFilter((prev) => {
                            const next = { ...prev };
                            delete next[group.id];
                            return next;
                          })
                        }
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                </div>
              )}
              <div className="opp-group-role-list">
                {group.jobs.length < 12 && (
                  <span className="opp-group-directory-label">在招岗位</span>
                )}
                {(roleQuery ? filteredRoleItems : filteredRoleItems.slice(0, 16)).map(
                  (roleItem, idx) => renderRoleChip(roleItem, idx),
                )}
                {roleQuery && filteredRoleItems.length === 0 && (
                  <span className="opp-group-role-empty">未找到匹配的本组岗位</span>
                )}
              </div>
              {!roleQuery && filteredRoleItems.length > 16 && (
                <details className="opp-group-roles-more">
                  <summary>
                    <span className="when-closed">
                      展开其余 {filteredRoleItems.length - 16} 个岗位
                    </span>
                    <span className="when-open">收起其余岗位</span>
                    <ChevronDown size={12} />
                  </summary>
                  <div className="opp-group-role-list opp-group-role-list-extra">
                    {filteredRoleItems.slice(16).map((roleItem, idx) =>
                      renderRoleChip(roleItem, idx + 16),
                    )}
                  </div>
                </details>
              )}
            </div>
            <div className="opp-group-members">{renderJobs(group.jobs.slice(0, 1))}</div>
            <details className="opp-group-more">
              <summary>
                <span className="when-closed">展开其余 {group.jobs.length - 1} 条完整卡片</span>
                <span className="when-open">收起其余 {group.jobs.length - 1} 条完整卡片</span>
                <ChevronDown size={14} />
              </summary>
              <div className="opp-group-members">{renderJobs(group.jobs.slice(1))}</div>
            </details>
          </div>
        ) : (
          <div key={group.id}>{renderJobs(group.jobs)}</div>
        );
      })}
    </>
  );
}
