'use client';
import { loadSnapshotParts, supportedBrowseIndex } from '../lib/snapshot-loader';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  SlidersHorizontal,
  Clock3,
  ExternalLink,
  X,
  RefreshCw,
  Bell,
  ChevronDown,
  ArrowUp,
  Info,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  defaultFilters,
  filterJobs,
  countByLocationScope,
  personalFor,
  mergeDuplicateOpportunities,
  selectedWorkCities,
  workCitiesLabel,
  parseSalaryRange,
} from '@/lib/jobs';
import { assessOpportunityValidity } from '@/lib/opportunity-validity';
import type { Job, Filters, Snapshot } from '@/lib/jobs';
import { restoreBrowsing } from '@/lib/browsing';
import { groupJobs } from '@/lib/grouping';
import type { JobGroup } from '@/lib/grouping';
import { FilterSidebar } from '@/components/filter-sidebar';
import { JobCard, formatDate as date } from '@/components/job-card';
import { DetailDrawer } from '@/components/detail-drawer';
import { PersonalRadar } from '@/components/personal-radar';
import { DataHealth } from '@/components/data-health';
import { ActionRail } from '@/components/action-rail';
import { TopActionCard } from '@/components/top-action-card';
import { personalViewFilters, buildActionQueue } from '@/lib/workspace';
import { patchPersonalRecord } from '@/lib/personal-store';
import { EmployerWorkspace, useEmployerRecords, useEmployerReputation, useEmployerNavigation } from '@/components/employer-workspace';
import { filterByReputation } from '@/lib/reputation';
import { ApplicationOverview } from '@/components/application-overview';
import { BackupImportSheet } from '@/components/backup-import-sheet';
import { SourceStatusSheet } from '@/components/source-status-sheet';
import { ResultsPagination, ResultsToolbar } from '@/components/jobs/results-toolbar';
import { GroupedResults } from '@/components/jobs/grouped-results';
import { JobsEmptyStates } from '@/components/jobs/empty-states';
import { AppHeader } from '@/components/jobs/app-header';
import { useJobSnapshot } from '@/hooks/use-job-snapshot';
import { usePersonalRecords } from '@/hooks/use-personal-records';
import { useJobDetail } from '@/hooks/use-job-detail';
import { useBackup } from '@/hooks/use-backup';
import { PAGE_SIZE_STORAGE, PAGE_SIZES, useUrlSync, useVisibleOpportunitiesTool } from '@/hooks/use-url-sync';

export default function Home() {
  return <EmployerWorkspace><HomeContent /></EmployerWorkspace>;
}

function HomeContent() {
  const employerRecords = useEmployerRecords();
  const reputation = useEmployerReputation();
  const { register: registerEmployerCatalog, selectId: selectEmployerId, requestedId: requestedEmployerId, missing: missingEmployer } = useEmployerNavigation();
  const [ready, setReady] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const resultsTopRef = useRef<HTMLDivElement>(null);
  const [searchIndex, setSearchIndex] = useState<Record<string, string> | null>(null);
  const [searchError, setSearchError] = useState('');
  const [searchAttempt, setSearchAttempt] = useState(0);
  const previousSearchQuery = useRef('');

  const {
    personal,
    setPersonal,
    syncPersonal,
    save,
    setRead,
    markRead,
    toggle,
    changeStage,
  } = usePersonalRecords({ ready, onNotice: setNotice });

  const {
    selected,
    linkedJobId,
    setLinkedJobId,
    detailLoading,
    detailError,
    detailNavIds,
    setDetailNavIds,
    openDetail,
    closeDetail,
    resetDetailOnPopState,
    activateDetailSnapshot,
    resolveDeepLink,
  } = useJobDetail({ markRead, onNotice: setNotice });

  const handleActivateSnapshot = useCallback(
    (snapshot: Snapshot | null) => {
      activateDetailSnapshot(snapshot);
      setSearchIndex(null);
      setSearchError('');
    },
    [activateDetailSnapshot],
  );

  const {
    data,
    previewData,
    loading,
    error,
    progress: progressiveProgress,
    refresh,
    refreshIfIdle,
    dataOrigin,
    coverage,
    isCurrentData,
  } = useJobSnapshot({ onActivateSnapshot: handleActivateSnapshot });

  const {
    filters,
    setFilters,
    since,
    page,
    setPage,
    pageSize,
    setPageSize,
    viewMode,
    setViewMode,
    cardDensity,
    changeCardDensity,
    groupCompanies,
    setGroupCompanies,
    now,
    queryDraft,
    updateQuery,
    change,
    resetFilters,
    openView,
    handleApplyBrowsing,
    activeFilterCount,
    searchRef,
    showBackTop,
  } = useUrlSync({
    ready,
    setReady,
    refresh,
    selectEmployerId,
    requestedEmployerId,
    linkedJobId,
    setLinkedJobId,
    resetDetailOnPopState,
    setPersonal,
    onNotice: setNotice,
  });

  const {
    fileRef,
    triggerFilePicker,
    importPreview,
    setImportPreview,
    importing,
    presetRevision,
    exportPersonal,
    importPersonal,
    confirmImport,
    copyJob,
  } = useBackup({
    syncPersonal,
    onApplyBrowsing: handleApplyBrowsing,
    onNotice: setNotice,
  });

  const reputationEnabled = !!data;
  const enableReputation = reputation.enable;
  useEffect(() => {
    if (!reputationEnabled) return;
    const timer = setTimeout(enableReputation, 0);
    return () => clearTimeout(timer);
  }, [reputationEnabled, enableReputation]);

  useEffect(() => {
    if (!ready) return;
    refreshIfIdle();
  }, [ready, refreshIfIdle]);

  useEffect(() => {
    if (!ready) return;
    return resolveDeepLink(data, previewData, loading);
  }, [ready, data, previewData, loading, resolveDeepLink]);

  const allJobs = useMemo(
    () =>
      mergeDuplicateOpportunities(
        (data?.jobs ?? []).filter((j) => j.source_id !== 'sdei-civil-exams'),
      ),
    [data?.jobs],
  );
  const employerCatalogReady = !!data;
  useEffect(() => { registerEmployerCatalog({ jobs: allJobs, complete: employerCatalogReady, onDetail: job => { void openDetail(job); } }); }, [allJobs, openDetail, registerEmployerCatalog, employerCatalogReady]);
  const previewJobs = useMemo(() => !data && filters.view === 'all' && !(filters.query.trim() && previewData?.search_url)
    ? filterJobs(mergeDuplicateOpportunities(previewData?.jobs || []), filters, personal, since, now).slice(0, 10) : [],
    [data, previewData, filters, personal, since, now]);
  const [savedCount, appliedCount] = useMemo(() => {
    let saved = 0, applied = 0;
    for (const job of allJobs) {
      const record = personalFor(job, personal);
      if (record.saved) saved++;
      if (record.applied) applied++;
    }
    return [saved, applied];
  }, [allJobs, personal]);

  const needsSearch = !!filters.query.trim() && !!data?.search_url;
  useEffect(() => {
    if (!needsSearch || !data?.search_url || searchIndex) return;
    const controller = new AbortController();
    const paths = supportedBrowseIndex(data) ? data.browse_index!.search_shards : [data.search_url, ...(data.search_shards ?? [])];
    const timer = setTimeout(() => {
      setSearchError('');
      void loadSnapshotParts<{ jobs: Record<string, string> }>(paths, 'search', controller.signal)
        .then((parts) => {
          if (parts.some((part) => !part.jobs || Array.isArray(part.jobs) || typeof part.jobs !== 'object'))
            throw Error('全文索引格式异常。');
          const jobs = Object.assign({}, ...parts.map((part) => part.jobs)) as Record<string, string>;
          if (data.jobs.some((j) => typeof jobs[j.id] !== 'string'))
            throw Error('全文索引不完整，请点击刷新重试。');
          if (!controller.signal.aborted && isCurrentData(data)) setSearchIndex(jobs);
        }).catch((e) => { if (!controller.signal.aborted && isCurrentData(data)) setSearchError(e.message); });
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [needsSearch, data, searchIndex, searchAttempt, isCurrentData]);

  useEffect(() => {
    const query = filters.query.trim(), previous = previousSearchQuery.current;
    previousSearchQuery.current = query;
    if (query !== previous && searchError) {
      setSearchError('');
      // A new nonempty word retries a failed fetch, but normal typing does not
      // cancel or redownload an already-running/full cached text index.
      if (previous && query) setSearchAttempt((attempt) => attempt + 1);
    }
  }, [filters.query, searchError]);

  const searchPending = needsSearch && !searchIndex;
  // While the full-text index loads, keep matching on the listing fields (title,
  // employer, positions…) instead of blanking the list; the count area keeps
  // saying the result is preliminary until the index is complete.
  const searchableJobs = useMemo(() => {
    if (!needsSearch || !searchIndex) return allJobs;
    return allJobs.map((j) => ({ ...j, search_text: searchIndex[j.id] ?? '' }));
  }, [allJobs, needsSearch, searchIndex]);

  const baseFiltered = useMemo(
    () => filterJobs(searchableJobs, filters, personal, since, now),
    [searchableJobs, filters, personal, since, now],
  );
  const filtered = useMemo(() => filterByReputation(baseFiltered, filters, reputation.index, employerRecords, now),
    [baseFiltered, filters, reputation.index, employerRecords, now]);

  const openDetailFromList = useCallback(
    (job: Job) => {
      setDetailNavIds(filtered.map((j) => j.id));
      void openDetail(job);
    },
    [filtered, openDetail, setDetailNavIds],
  );

  const selectedIndex = useMemo(() => {
    if (!selected) return -1;
    if (detailNavIds) return detailNavIds.indexOf(selected.id);
    return filtered.findIndex((j) => j.id === selected.id);
  }, [selected, detailNavIds, filtered]);

  const navigateDetail = useCallback(
    (delta: -1 | 1) => {
      if (selectedIndex < 0) return;
      const navIds = detailNavIds ?? filtered.map((j) => j.id);
      const nextIdx = selectedIndex + delta;
      const nextId = navIds[nextIdx];
      if (!nextId) return;
      const nextJob = allJobs.find((j) => j.id === nextId) ?? filtered.find((j) => j.id === nextId);
      if (!nextJob) return;
      void openDetail(nextJob);
      const filteredIdx = filtered.findIndex((j) => j.id === nextId);
      const pageIdx = filters.onlyUnread || filteredIdx < 0 ? nextIdx : filteredIdx;
      const nextPage = Math.floor(pageIdx / pageSize) + 1;
      if (nextPage !== page) setPage(nextPage);
    },
    [selectedIndex, detailNavIds, filtered, allJobs, openDetail, filters.onlyUnread, pageSize, page, setPage],
  );

  // Snapshot-wide facts used to hide filters that currently cannot match and
  // to explain filters that only apply to explicitly stated values.
  const filterFacts = useMemo(() => {
    let verified = 0, salaryKnown = 0;
    for (const job of allJobs) {
      const status = assessOpportunityValidity(job, now).status;
      if (status === 'confirmed_open' || status === 'long_term') verified++;
      if (parseSalaryRange(job)) salaryKnown++;
    }
    const scored = !!reputation.index?.entities.some((item) => item.score !== null && Date.parse(item.valid_until) > now);
    return { verified, salaryKnown, total: allJobs.length, hasReputationScores: scored };
  }, [allJobs, now, reputation.index]);

  const radarScopeJobs = useMemo(
    () =>
      filters.radarFocus === 'none'
        ? filtered
        : filterByReputation(filterJobs(searchableJobs, { ...filters, radarFocus: 'none' }, personal, since, now), filters, reputation.index, employerRecords, now),
    [searchableJobs, filters, personal, since, now, filtered, reputation.index, employerRecords],
  );

  const locationOptions = useMemo(() => {
    if (!selectedWorkCities(filters).length) return [];
    const counts = countByLocationScope(searchableJobs, filters, personal, since, now);
    return (['exact', 'possible', 'unknown'] as const).map((scope) => ({
      scope,
      label:
        scope === 'exact'
          ? `来源标注${workCitiesLabel(filters)}`
          : scope === 'possible'
            ? '全省 / 全国待核实'
            : '地点未明确',
      count: counts[scope],
    }));
  }, [searchableJobs, filters, personal, since, now]);

  const groups = useMemo(() => groupJobs(filtered, groupCompanies), [filtered, groupCompanies]);
  const selectedGroupJobs = useMemo(() => {
    if (!selected) return [];
    const allGrouped = groupCompanies ? groups : groupJobs(filtered, true);
    const matchedGroup = allGrouped.find((g) => g.jobs.some((j) => j.id === selected.id));
    return matchedGroup && matchedGroup.jobs.length > 1 ? matchedGroup.jobs : [];
  }, [selected, filtered, groupCompanies, groups]);
  const pages = Math.max(1, Math.ceil(groups.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visibleGroups = groups.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Consecutive single records share one table header; grouped campaigns expand independently.
  const displayBlocks = visibleGroups.reduce<(JobGroup & { grouped: boolean })[]>((blocks, group) => {
    const previous = blocks.at(-1);
    if (viewMode === 'table' && group.jobs.length === 1 && previous && !previous.grouped)
      previous.jobs.push(...group.jobs);
    else blocks.push({ ...group, jobs: [...group.jobs], grouped: group.jobs.length > 1 });
    return blocks;
  }, []);

  const returnToResults = () => {
    resultsTopRef.current?.focus({ preventScroll: true });
    resultsTopRef.current?.scrollIntoView({ block: 'start' });
  };

  const changePage = (next: number) => {
    setPage(Math.max(1, Math.min(next, pages)));
    returnToResults();
  };

  const changePageSize = (next: number) => {
    if (!PAGE_SIZES.includes(next) || next === pageSize) return;
    setPage(Math.floor(((currentPage - 1) * pageSize) / next) + 1);
    setPageSize(next);
    try {
      localStorage.setItem(PAGE_SIZE_STORAGE, String(next));
    } catch {
      setNotice('每页条数已切换；浏览器未允许保存设置，下次打开会恢复默认值。');
    }
    returnToResults();
  };

  const newCount = useMemo(() => (data?.jobs ?? []).filter(
    (j) =>
      since &&
      (Date.parse(j.first_seen_at) > Date.parse(since) ||
        Date.parse(j.updated_at) > Date.parse(since)),
  ).length, [data?.jobs, since]);

  const dueCount = useMemo(() => buildActionQueue(allJobs, personal, now).filter(
    (job) => job.deadline && Date.parse(job.deadline) - now < 7 * 86400000,
  ).length, [allJobs, personal, now]);

  const years = useMemo(() => [
    '全部',
    ...Array.from(
      new Set([
        '2027',
        ...(data?.jobs ?? []).flatMap((j) => j.graduation_years),
      ]),
    )
      .filter((y) => y >= '2024' && y <= '2030')
      .sort()
      .reverse(),
  ], [data?.jobs]);

  const stale =
    !!data?.last_success_at &&
    now - Date.parse(data.last_success_at) > 36 * 3600000;

  useVisibleOpportunitiesTool(filtered);

  return (
    <>
      <a className="skip-to-results" href="#opportunities">跳到招聘结果</a>
      <input type="file" accept="application/json,.json" ref={fileRef} hidden onChange={(e) => void importPersonal(e.target.files?.[0])} />
      <AppHeader
        activeView={filters.view}
        onOpenView={openView}
        hasData={Boolean(data)}
        savedCount={savedCount}
        appliedCount={appliedCount}
        onOpenSources={() => setSourceOpen(true)}
      />

      <main className="page">
        <div className="page-head">
          <div className="page-head-intro">
            <p className="page-eyebrow">
              {workCitiesLabel(filters)} · {filters.type}
              {filters.type === '校招' && filters.year !== '全部' ? ` · ${filters.year}届` : ''}
            </p>
            <h1 className="page-title">
              {({ all: '发现机会', saved: '我的收藏', planned: '待投递', pipeline: '投递进度', applied: '投递记录', hidden: '不感兴趣' } as Record<string, string>)[filters.view] || '发现机会'}
            </h1>
            <p className="page-lede">
              {filters.view === 'all'
                ? '聚合高校就业网、政务直聘与官方公告，追踪网申截止时间与宣讲日程。'
                : ({
                    saved: '已收藏的机会集中在这里，可随时回看或标记投递。',
                    planned: '已收藏、未投递且未截止的机会，按截止时间排列。',
                    pipeline: '按投递阶段查看进度与下一步安排，记录仅保存在本机。',
                    applied: '已标记投递的岗位，本地保存，随时跟踪。',
                    hidden: '标记为不感兴趣的机会，可在这里恢复。',
                  } as Record<string, string>)[filters.view] || '记录仅保存在本机。'}
            </p>
          </div>

          <div className="page-head-aside">
            <TopActionCard
              jobs={allJobs}
              personal={personal}
              now={now}
              ready={ready && !!data}
              activeView={filters.view}
              onDetail={(job) => void openDetail(job)}
              onView={openView}
            />

            <div className={`freshness ${!data?.last_success_at || stale ? 'is-stale' : ''}`}>
              <span className="freshness-dot" />
              <span>{loading && !data ? '正在读取…' : `最近采集 ${date(data?.last_success_at, true)}`}</span>
              {data && !data.schedule_enabled && <span className="text-muted">（未启用定时）</span>}
              <button
                className="icon-btn"
                onClick={() => { reputation.retry(); void refresh(); }}
                disabled={loading}
                aria-label="重新读取招聘数据"
                title="重新读取招聘数据"
              >
                <RefreshCw size={13} className={loading ? 'spinning' : ''} />
              </button>
            </div>
          </div>
        </div>

        {notice && (
          <output className="toast">
            <span>{notice}</span>
            <button aria-label="关闭提示" onClick={() => setNotice('')}>
              <X size={15} />
            </button>
          </output>
        )}

        {error && (
          <div className="inline-alert is-danger" role="alert">
            <span>{error} {data ? '（已保留上次完整结果）' : '（未完成的预览已撤下，请重试）'}</span>
            <button className="btn btn-secondary btn-sm" onClick={() => void refresh()}>
              重试
            </button>
          </div>
        )}
        {data && missingEmployer && <output className="inline-alert">这个企业暂不在当前索引中，企业链接已保留，可刷新后再查看。
          <button type="button" className="text-btn" onClick={() => selectEmployerId(null)}>关闭企业链接</button>
        </output>}

        {data && stale && (
          <div className="inline-alert is-warn">
            <Clock3 size={16} />
            <span>信息已超过 36 小时未更新，请在原公告核对是否仍可报名。</span>
          </div>
        )}

        {data && now > 0 && <DataHealth coverage={coverage} data={data} now={now} city={selectedWorkCities(filters)} visibleJobs={filtered} origin={dataOrigin} onSources={() => setSourceOpen(true)} />}

        <div className="page-grid">
          <FilterSidebar
            className="filters-desktop"
            filters={filters}
            data={data}
            years={years} facts={filterFacts}
            ready={ready}
            onChange={change}
            onReset={resetFilters}
            onExport={exportPersonal}
            onImport={triggerFilePicker}
          />

          <section className="results-col" id="opportunities" aria-label="招聘机会">
            <details className="plan-mobile">
              <summary>
                <span>校园日程<small>宣讲会与校园活动</small></span>
                <ChevronDown size={16} />
              </summary>
              <ActionRail indexReady={!!data} coverage={coverage} jobs={allJobs} personal={personal} city={filters.city} now={now} ready={ready && !!data} onDetail={(job) => void openDetail(job)} onView={openView} />
            </details>

            <div className="search-box-wrap">
              <div className="search-row">
                <div className="search-field">
                  <Search size={18} />
                  <input
                    ref={searchRef}
                    aria-label="搜索岗位、企业或专业"
                    placeholder="搜索企业、岗位、专业，找到你的下一站"
                    value={queryDraft}
                    onChange={(e) => updateQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') updateQuery(queryDraft, true); }}
                  />
                  {!queryDraft && <kbd className="kbd">/</kbd>}
                  {queryDraft && (
                    <button
                      className="icon-btn"
                      aria-label="清空搜索"
                      onClick={() => updateQuery('', true)}
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-secondary filters-trigger"
                  onClick={() => setMobileFilterOpen(true)}
                  aria-label="打开筛选面板"
                >
                  <SlidersHorizontal size={16} />
                  <span>筛选</span>
                  {activeFilterCount > 0 && (
                    <span className="filters-trigger-badge">{activeFilterCount}</span>
                  )}
                </button>
              </div>

              <div className="search-hints">
                <span>试着搜</span>
                {['财务', '软件工程师', '管培生', '不限专业'].map((term) => (
                  <button key={term} type="button" onClick={() => updateQuery(term, true)}>{term}</button>
                ))}
                <span className="hint-tail">支持企业、岗位、专业全文搜索</span>
              </div>
            </div>

            {data && <PersonalRadar
              key={presetRevision}
              now={now}
              currentFilters={filters}
              filteredJobs={radarScopeJobs}
              activeFocus={filters.radarFocus}
              onApplyPreset={(presetFilters) => {
                setFilters(restoreBrowsing({ filters: { ...defaultFilters, ...presetFilters, view: 'all', radarFocus: 'none' } }).filters);
                setPage(1);
              }}
              onQuickFocus={(focus) => {
                if (filters.radarFocus === focus) {
                  setFilters((prev) => ({ ...prev, radarFocus: 'none' }));
                  setNotice('已取消聚焦，恢复全部机会列表');
                } else {
                  setFilters((prev) => ({ ...prev, radarFocus: focus }));
                  const focusLabels: Record<string, string> = {
                    today: '今日发布 / 收录',
                    supplement: '补录机会',
                    urgent: '3 天内截止',
                    change: '近期变更',
                  };
                  setNotice(`已聚焦「${focusLabels[focus]}」机会，再次点击标签可恢复全部`);
                }
                setPage(1);
              }}
            />}

            {filters.view !== 'all' && (
              <p className="note-line">
                <Info size={15} />
                <span>{filters.view === 'planned' ? '待投递仅含已收藏、未投递、未隐藏且未截止的机会，按截止时间排列。' : '个人列表默认不限城市，并保留已截止记录。'}返回「发现机会」会恢复之前的筛选。投递后请手动标记状态。</span>
              </p>
            )}

            {(filters.view === 'pipeline' || filters.view === 'applied') && (
              <ApplicationOverview
                jobs={allJobs}
                personal={personal}
                stage={filters.applicationStage}
                activeView={filters.view}
                onViewChange={openView}
                onStage={(stage) => {
                  setFilters({ ...personalViewFilters('pipeline'), applicationStage: stage });
                  setPage(1);
                }}
              />
            )}
            <ResultsToolbar
              data={data}
              loading={loading}
              progressiveProgress={progressiveProgress}
              searchPending={searchPending}
              searchError={searchError}
              onRetrySearch={() => {
                setSearchError('');
                setSearchAttempt((attempt) => attempt + 1);
              }}
              filtered={filtered}
              groupsCount={groups.length}
              filters={filters}
              since={since}
              newCount={newCount}
              groupCompanies={groupCompanies}
              onToggleGroupCompanies={() => {
                setGroupCompanies(!groupCompanies);
                setPage(1);
              }}
              onOpenView={openView}
              onChange={change}
              onRemoveWorkCity={(c) => {
                const nextCities = (filters.workCities || []).filter((item) => item !== c);
                const nextCity = nextCities.length === 1 ? nextCities[0] : '全部城市';
                setFilters({ ...filters, city: nextCity, workCities: nextCities });
                setPage(1);
              }}
              onResetFilters={resetFilters}
              hasReputationScores={filterFacts.hasReputationScores}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              cardDensity={cardDensity}
              onCardDensityChange={changeCardDensity}
              pages={pages}
              currentPage={currentPage}
              onPageChange={changePage}
              locationOptions={locationOptions}
            />
            {(filters.reputationMin !== 'all' || filters.sort === 'reputation_desc') && <output className="note-line">
              {reputation.index ? '仅对准确名称匹配且近期样本充足的企业应用参考分；集团参考不套用到子公司或部门。'
                : '口碑索引暂未就绪，口碑条件尚未应用；当前继续展示岗位筛选结果。'}
              {reputation.error && <button className="text-btn" onClick={reputation.retry}>重试口碑</button>}
            </output>}

            {filters.onlyNew && !since && (
              <p className="note-line">
                这是你首次访问，尚无上次查看时间。关闭此筛选可查看全部收录。
              </p>
            )}

            {filters.onlyNew && since && newCount > 0 && (
              <p className="note-line">
                全库有 {newCount}{' '}
                条自上次访问以来首次收录或内容变更；首次收录不代表刚发布。
              </p>
            )}

            {dueCount > 0 && (
              <div className="due-banner">
                <Bell size={16} />
                <span>你收藏的 {dueCount} 条公告将在 7 天内截止。请在原公告核对报名要求。</span>
              </div>
            )}

            {loading && !data ? (
              <div className="opp-list" aria-label="首批预览" aria-busy="true">
                <output className="plan-caption">首批卡片预览；计数、收藏列表和日程会在完整索引就绪后显示。</output>
                {previewJobs.map((job) => <JobCard key={job.id} job={job} filters={filters} personal={personal} ready={ready} now={now} since={since}
                  density={cardDensity} onDetail={(candidate) => void openDetail(candidate)} onRead={markRead} onReadChange={setRead} onToggle={toggle} onStageChange={changeStage} onCopy={copyJob} />)}
                {!previewJobs.length && <><div className="opp-skeleton" /><div className="opp-skeleton" /></>}
              </div>
            ) : (
              <>
                <div ref={resultsTopRef} tabIndex={-1} />
                <div className="opp-list">
                  <GroupedResults
                    displayBlocks={displayBlocks}
                    viewMode={viewMode}
                    filters={filters}
                    personal={personal}
                    ready={ready}
                    now={now}
                    since={since}
                    cardDensity={cardDensity}
                    selectedId={selected?.id ?? null}
                    onDetail={openDetailFromList}
                    onRead={markRead}
                    onReadChange={setRead}
                    onToggle={toggle}
                    onStageChange={changeStage}
                    onCopy={copyJob}
                  />
                  <JobsEmptyStates
                    data={data}
                    filteredCount={filtered.length}
                    loading={loading}
                    searchPending={searchPending}
                    error={error}
                    filters={filters}
                    locationOptions={locationOptions}
                    onOpenView={openView}
                    onSelectLocationScope={(scope) => {
                      setFilters({ ...filters, locationScope: scope });
                      setPage(1);
                    }}
                    onRelaxFilters={(nextFilters) => {
                      setFilters(nextFilters);
                      setPage(1);
                    }}
                  />
                </div>
              </>
            )}

            {visibleGroups.length > 0 && !searchPending && (
              <ResultsPagination page={currentPage} pageSize={pageSize} total={groups.length} grouped={groupCompanies} position="bottom" onPageChange={changePage} onPageSizeChange={changePageSize} />
            )}

            <details className="help-fold">
              <summary>
                <Info size={14} />
                <span>筛选与阅读说明</span>
                <ChevronDown size={14} />
              </summary>
              <div className="help-fold-body">
                <p>{({
                  newest: '当前按来源发布 / 收录时间从新到旧排列，日期不明确的排在最后。',
                  deadline_asc: '当前按截止时间由近到远排列，已截止和未写截止日期的排在后面。',
                  salary_desc: '当前按写明的薪资从高到低排列，未写薪资的排在后面。',
                  reputation_desc: '当前按企业体验参考分排列，没有参考分的按发布时间排在后面。',
                  employer_intent_desc: '当前按你对企业的意向评分排列，未评分的按发布时间排在后面。',
                } as Record<string, string>)[filters.sort]}查看详情或投递入口后标为已读，内容更新后重新提示未读。表格可左右滑动。</p>
                <p>合并仅折叠同名企业、同届别、同招聘类型的信息，提前批、春招、秋招等明确批次分开展示；届别未写明的只与同样未写明的合并并标注。所有岗位和来源均保留，每组显示最新一条，其余可展开逐条投递或收藏。</p>
              </div>
            </details>

            <p className="foot-note">
              {data ? `${data.sources.length} 个来源 ·` : '完整索引尚未就绪 ·'}
              当前按公告聚合，部分公告包含多个岗位。标签由文字提取，未知资格不会当作“不符合”。
              <button
                className="text-btn"
                onClick={() => setSourceOpen(true)}
              >
                查看覆盖与更新状态
                <ExternalLink size={13} />
              </button>
            </p>
          </section>
          <div className="plan-desktop"><ActionRail indexReady={!!data} coverage={coverage} jobs={allJobs} personal={personal} city={filters.city} now={now} ready={ready && !!data} onDetail={(job) => void openDetail(job)} onView={openView} /></div>
        </div>
      </main>


      <Sheet open={mobileFilterOpen} onOpenChange={setMobileFilterOpen}>
        <SheetContent side="left" className="mobile-filter-sheet">
          <SheetHeader className="detail-header">
            <SheetTitle>筛选条件</SheetTitle>
            <SheetDescription>
              调整筛选后立即生效，关闭即可浏览岗位
            </SheetDescription>
          </SheetHeader>
          <div className="mobile-filter-scroll">
            {/* On phones, sorting and layout live here instead of above the list. */}
            <section className="mobile-display-options" aria-label="显示与排序">
              <h3>显示与排序</h3>
              <label className="field">
                <span className="field-label">排序</span>
                <select className="field-select" aria-label="排序方式（筛选面板）" value={filters.sort}
                  onChange={(event) => change('sort', event.target.value as Filters['sort'])}>
                  <option value="newest">最新发布</option>
                  <option value="deadline_asc">即将截止优先</option>
                  <option value="salary_desc">薪资从高到低</option>
                  {(filterFacts.hasReputationScores || filters.sort === 'reputation_desc') && <option value="reputation_desc">企业体验参考优先</option>}
                  <option value="employer_intent_desc">我的企业意向优先</option>
                </select>
              </label>
              <div className="field">
                <span className="field-label">显示方式</span>
                <fieldset className="seg seg-block" aria-label="显示方式（筛选面板）">
                  <button type="button" aria-pressed={viewMode === 'cards'} onClick={() => setViewMode('cards')}>卡片</button>
                  <button type="button" aria-pressed={viewMode === 'table'} onClick={() => setViewMode('table')}>表格</button>
                </fieldset>
              </div>
              {viewMode === 'cards' && (
                <div className="field">
                  <span className="field-label">卡片密度</span>
                  <fieldset className="seg seg-block" aria-label="卡片密度（筛选面板）">
                    <button type="button" aria-pressed={cardDensity === 'standard'} onClick={() => changeCardDensity('standard')}>标准</button>
                    <button type="button" aria-pressed={cardDensity === 'compact'} onClick={() => changeCardDensity('compact')}>紧凑</button>
                  </fieldset>
                </div>
              )}
              <label className="check-row">
                <input type="checkbox" checked={groupCompanies} onChange={(event) => { setGroupCompanies(event.target.checked); setPage(1); }} />
                <span>合并同企业</span>
              </label>
            </section>
            <FilterSidebar
              className="mobile-filter-panel"
              filters={filters}
              data={data}
              years={years} facts={filterFacts}
              ready={ready}
              onChange={change}
              onReset={resetFilters}
              onExport={exportPersonal}
              onImport={triggerFilePicker}
            />
          </div>
          <div className="mobile-filter-footer">
            <button type="button" className="btn btn-primary" onClick={() => setMobileFilterOpen(false)}>
              {data && !searchPending ? `查看 ${filtered.length} 条结果` : '查看结果'}
            </button>
          </div>
        </SheetContent>
      </Sheet>

      <DetailDrawer
        selected={selected}
        filters={filters}
        city={selectedWorkCities(filters)}
        now={now}
        personal={personal}
        ready={ready}
        detailLoading={detailLoading}
        detailError={detailError}
        currentIndex={selectedIndex}
        totalCount={detailNavIds ? detailNavIds.length : filtered.length}
        onNavigate={navigateDetail}
        siblingJobs={selectedGroupJobs}
        onSelectJob={(job) => void openDetail(job)}
        onClose={closeDetail}
        onRead={markRead}
        onReadChange={setRead}
        onToggle={toggle}
        onCopy={copyJob}
        setNotice={setNotice}
        onPersonalSave={(job, patch, expected) => save((latest) => patchPersonalRecord(latest, job, patch, new Date().toISOString(), expected))}
      />

      {showBackTop && (
        <button
          type="button"
          className="back-to-top-btn"
          onClick={returnToResults}
          aria-label="回到列表顶部"
          title="回到列表顶部"
        >
          <ArrowUp size={15} />
          <span>顶部</span>
        </button>
      )}

      <BackupImportSheet
        importPreview={importPreview}
        importing={importing}
        personal={personal}
        employerRecords={employerRecords}
        allJobs={allJobs}
        onClose={() => setImportPreview(null)}
        onExport={exportPersonal}
        onConfirm={(preferImported) => void confirmImport(preferImported)}
      />

      <SourceStatusSheet
        open={sourceOpen}
        onOpenChange={setSourceOpen}
        data={data}
      />
    </>
  );
}
