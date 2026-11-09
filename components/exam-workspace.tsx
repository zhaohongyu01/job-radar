'use client';

import '@/app/exams.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Database,
  FileSpreadsheet,
  Kanban,
  Landmark,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  DEFAULT_EXAM_FILTERS,
  evaluateExamPositionEligibility,
  EXAM_PERSONAL_STORAGE,
  filterExams,
  flattenAndFilterExamPositions,
  formatExamUrl,
  getTrackStageInfo,
  isExamProfileActive,
  parseExamUrl,
  validateExamPersonal,
} from '@/lib/exams';
import type {
  ExamAnnouncement,
  ExamFilters,
  ExamTrackStatus,
  FlattenedExamPosition,
} from '@/lib/exams';
import { ExamCard } from '@/components/exam-card';
import { ExamDetailDrawer } from '@/components/exam-detail-drawer';
import { ExamProfilePanel } from '@/components/exams/exam-profile-panel';
import {
  buildActiveExamFilters,
  ExamFilterSidebar,
} from '@/components/exams/exam-filter-sidebar';
import { ExamPositionTable } from '@/components/exams/exam-position-table';
import { ExamTrackerBoard } from '@/components/exams/exam-tracker-board';
import { ExamSourcesSheet } from '@/components/exams/exam-sources-sheet';
import { BottomTabBar } from '@/components/bottom-tab-bar';
import { formatMonthDay } from '@/components/exam-ui';
import { useToast } from '@/components/toast-provider';
import { useExamSnapshot } from '@/hooks/use-exam-snapshot';
import { useExamPersonal } from '@/hooks/use-exam-personal';
import { report } from '@/lib/rum';

const PAGE_SIZE = 20;

const SORT_OPTIONS: [ExamFilters['sort'], string][] = [
  ['smart', '报名中优先'],
  ['published', '最新发布'],
  ['reg_end', '报名截止最近'],
  ['headcount', '招录人数最多'],
];

interface Milestone {
  exam: ExamAnnouncement;
  date: string;
  type: string;
  tone: 'urgent' | 'active' | 'info';
}

export function ExamWorkspace() {
  const { toast } = useToast();
  const setNotice = useCallback(
    (msg: string) => {
      if (msg) toast(msg);
    },
    [toast],
  );
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(EXAM_PERSONAL_STORAGE);
      if (raw) validateExamPersonal(JSON.parse(raw));
    } catch {
      toast({ message: '本地考编记录格式异常，已重置为默认状态', tone: 'error' });
    }
  }, [toast]);
  const [selectedExam, setSelectedExam] = useState<ExamAnnouncement | null>(null);
  const [linkedExamId, setLinkedExamId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return parseExamUrl(window.location.search).examId || null;
  });
  const [sourceOpen, setSourceOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [savedSubTab, setSavedSubTab] = useState<'announcements' | 'candidates' | 'hidden'>('announcements');
  const [page, setPage] = useState(() => {
    if (typeof window === 'undefined') return 1;
    return parseExamUrl(window.location.search).page || 1;
  });

  const resetPage = useCallback(() => setPage(1), []);

  const {
    snapshot,
    loading,
    error,
    today,
    reload,
    allExams,
    activeExamCount,
    endedExamCount,
    freshnessMeta,
  } = useExamSnapshot({ onNotice: setNotice });

  const {
    profile,
    filters,
    setFilters,
    personal,
    updateProfile,
    clearProfile,
    updateFilters,
    resetFilters,
    updatePersonalRecord,
    toggleSaveExam,
    toggleHideExam,
    cleanupStalePositions,
    toggleCity,
    toggleCandidate,
    savedCount,
    trackedCount,
    hiddenCount,
  } = useExamPersonal({ onNotice: setNotice, onPageReset: resetPage });

  useEffect(() => {
    if (!linkedExamId || allExams.length === 0) return;
    if (selectedExam?.id === linkedExamId) return;
    const found = allExams.find((ex) => ex.id === linkedExamId);
    if (!found) return;
    const timer = window.setTimeout(() => {
      setSelectedExam(found);
      if (!personal[found.id]?.readAt) {
        updatePersonalRecord(found.id, { readAt: new Date().toISOString() });
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [linkedExamId, allExams, selectedExam?.id, personal, updatePersonalRecord]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const newQuery = formatExamUrl({ filters, examId: linkedExamId, page });
    if (window.location.search !== newQuery) {
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${newQuery}${window.location.hash}`,
      );
    }
  }, [filters, linkedExamId, page]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPopState = (event: PopStateEvent) => {
      const urlState = parseExamUrl(window.location.search);
      setFilters((prev) => ({
        ...prev,
        query: '',
        cities: DEFAULT_EXAM_FILTERS.cities,
        stage: DEFAULT_EXAM_FILTERS.stage,
        category: DEFAULT_EXAM_FILTERS.category,
        view: DEFAULT_EXAM_FILTERS.view,
        ...urlState.filters,
      }));
      setPage(urlState.page || 1);
      const nextExamId =
        event.state?.overlay === 'exam'
          ? urlState.examId || event.state.examId || null
          : urlState.examId || null;
      setLinkedExamId(nextExamId);
      if (!nextExamId) {
        setSelectedExam(null);
      } else {
        const found = allExams.find((ex) => ex.id === nextExamId);
        if (found) setSelectedExam(found);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [allExams, setFilters]);

  const openExam = useCallback(
    (exam: ExamAnnouncement, pushHistory = true) => {
      report('event', 'open_detail');
      setSelectedExam(exam);
      setLinkedExamId(exam.id);
      if (typeof window !== 'undefined' && pushHistory) {
        const newQuery = formatExamUrl({ filters, examId: exam.id, page });
        const newUrl = `${window.location.pathname}${newQuery}${window.location.hash}`;
        if (window.history.state?.overlay === 'exam') {
          window.history.replaceState({ overlay: 'exam', examId: exam.id }, '', newUrl);
        } else {
          window.history.pushState({ overlay: 'exam', examId: exam.id }, '', newUrl);
        }
      }
      if (!personal[exam.id]?.readAt) {
        updatePersonalRecord(exam.id, { readAt: new Date().toISOString() });
      }
    },
    [filters, page, personal, updatePersonalRecord],
  );

  const switchView = useCallback(
    (nextView: ExamFilters['view']) => {
      if (nextView === filters.view) return;
      const nextFilters = { ...filters, view: nextView };
      updateFilters({ view: nextView });
      if (typeof window !== 'undefined') {
        const newQuery = formatExamUrl({ filters: nextFilters, examId: linkedExamId, page: 1 });
        window.history.pushState(
          { view: nextView },
          '',
          `${window.location.pathname}${newQuery}${window.location.hash}`,
        );
      }
    },
    [filters, linkedExamId, updateFilters],
  );

  const closeExam = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.state?.overlay === 'exam') {
      window.history.back();
      return;
    }
    setSelectedExam(null);
    setLinkedExamId(null);
  }, []);
  const searchReportTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(searchReportTimer.current), []);

  const handleSearchInput = useCallback(
    (value: string) => {
      updateFilters({ query: value });
      clearTimeout(searchReportTimer.current);
      if (value.trim()) {
        searchReportTimer.current = setTimeout(() => report('event', 'search'), 300);
      }
    },
    [updateFilters],
  );

  const closeSources = useCallback(() => setSourceOpen(false), []);

  const filteredExams = useMemo(
    () => filterExams(allExams, filters, profile, personal),
    [allExams, filters, profile, personal],
  );
  const flattenedPositions = useMemo(
    () => flattenAndFilterExamPositions(allExams, filters, profile),
    [allExams, filters, profile],
  );

  const { validPositionRowIds, candidateRows, staleCandidateCount } = useMemo(() => {
    const validIds = new Set<string>();
    const cands: FlattenedExamPosition[] = [];
    for (const exam of allExams) {
      const savedSet = new Set(personal[exam.id]?.savedPositionIds || []);
      for (const pos of exam.positions || []) {
        validIds.add(pos.row_id);
        if (savedSet.has(pos.row_id)) {
          cands.push({
            ...pos,
            exam_title: exam.title,
            exam,
            eligibility: evaluateExamPositionEligibility(pos, profile),
          });
        }
      }
    }
    let stale = 0;
    if (allExams.length > 0) {
      for (const rec of Object.values(personal)) {
        for (const id of rec.savedPositionIds || []) {
          if (!validIds.has(id)) stale += 1;
        }
      }
    }
    return { validPositionRowIds: validIds, candidateRows: cands, staleCandidateCount: stale };
  }, [allExams, personal, profile]);

  const savedAnnouncementExams = useMemo(
    () => filteredExams.filter((ex) => personal[ex.id]?.saved && !personal[ex.id]?.hidden),
    [filteredExams, personal],
  );
  const hiddenExams = useMemo(
    () => allExams.filter((ex) => Boolean(personal[ex.id]?.hidden)),
    [allExams, personal],
  );

  const milestones = useMemo<Milestone[]>(() => {
    if (!today) return [];
    const prioritizedIds = new Set<string>();
    const candidateExams: { exam: ExamAnnouncement; priority: number }[] = [];
    for (const ex of allExams) {
      const rec = personal[ex.id];
      if (rec?.saved || (rec?.status && rec.status !== 'none')) {
        prioritizedIds.add(ex.id);
        candidateExams.push({ exam: ex, priority: 0 });
      }
    }
    for (const ex of filteredExams) {
      if (!prioritizedIds.has(ex.id)) {
        candidateExams.push({ exam: ex, priority: 1 });
      }
    }

    const items: (Milestone & { priority: number })[] = [];
    for (const { exam: ex, priority } of candidateExams) {
      const s = ex.schedule;
      if (s.reg_end && ['registering', 'closing_soon', 'upcoming'].includes(ex.stage)) {
        items.push({
          exam: ex,
          date: s.reg_end,
          type: '报名截止',
          tone: ex.stage === 'closing_soon' ? 'urgent' : 'active',
          priority,
        });
      }
      if (s.payment_end) {
        items.push({ exam: ex, date: s.payment_end, type: '缴费截止', tone: 'urgent', priority });
      }
      if (s.admit_card_start) {
        items.push({ exam: ex, date: s.admit_card_start, type: '准考证打印', tone: 'info', priority });
      }
      if (s.written_exam_date) {
        items.push({ exam: ex, date: s.written_exam_date, type: '笔试', tone: 'info', priority });
      }
      if (s.interview_date) {
        items.push({ exam: ex, date: s.interview_date, type: '面试', tone: 'info', priority });
      }
    }
    return items
      .filter((m) => m.date.slice(0, 10) >= today)
      .sort((a, b) => (a.priority !== b.priority ? a.priority - b.priority : a.date.localeCompare(b.date)))
      .slice(0, 10);
  }, [allExams, filteredExams, personal, today]);

  const profileActive = isExamProfileActive(profile);

  const activeFilters = buildActiveExamFilters(filters, toggleCity, updateFilters);

  const activeExamList =
    filters.view === 'saved'
      ? savedSubTab === 'hidden'
        ? hiddenExams
        : savedAnnouncementExams
      : filteredExams;
  const listLength =
    filters.view === 'positions'
      ? flattenedPositions.length
      : filters.view === 'saved' && savedSubTab === 'candidates'
        ? candidateRows.length
        : activeExamList.length;
  const totalPages = Math.max(1, Math.ceil(listLength / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedExams = activeExamList.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const pagedPositions = flattenedPositions.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const tabs: { key: ExamFilters['view']; label: string; icon: typeof Landmark; count: number }[] = [
    { key: 'announcements', label: '招考公告', icon: Landmark, count: filteredExams.length },
    { key: 'positions', label: '职位库', icon: FileSpreadsheet, count: flattenedPositions.length },
    { key: 'saved', label: '收藏', icon: Bookmark, count: savedCount },
    { key: 'tracker', label: '报考进度', icon: Kanban, count: trackedCount },
  ];

  return (
    <div className="exw">
      {/* ---------- Header ---------- */}
      <header className="exw-head">
        <div className="exw-head-text">
          <p className="exw-eyebrow">山东省 · 16 地市 · 全国性考试 · 每日更新</p>
          <h1 className="exw-title">考公考编</h1>
        </div>
        <div className="exw-stats">
          <div className="exw-stat">
            <strong>{snapshot ? activeExamCount : '—'}</strong>
            <span>在招公告</span>
          </div>
          <div className="exw-stat">
            <strong>{snapshot ? snapshot.total_positions : '—'}</strong>
            <span>岗位明细</span>
          </div>
          <div className={`exw-stat${freshnessMeta?.stale ? ' is-stale' : ''}`}>
            <strong>{freshnessMeta ? freshnessMeta.label : '—'}</strong>
            <span>{freshnessMeta?.stale ? '数据可能过期' : '数据状态'}</span>
          </div>
        </div>
        <div className="exw-head-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSourceOpen(true)}>
            <Database size={15} />
            信息来源 {snapshot ? snapshot.sources.length : ''}
          </button>
          <button
            type="button"
            className="exw-icon-btn"
            aria-label="刷新数据"
            title="刷新数据"
            onClick={reload}
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? 'spinning' : ''} />
          </button>
        </div>
      </header>

      {/* ---------- Eligibility profile ---------- */}
      <ExamProfilePanel
        profile={profile}
        onUpdateProfile={updateProfile}
        onClearProfile={clearProfile}
      />

      {/* ---------- Toolbar ---------- */}
      <div className="exw-toolbar">
        <div className="exw-tabs" role="tablist" aria-label="视图切换">
          {tabs.map((t) => {
            const Icon = t.icon;
            const on = filters.view === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={on}
                className={`exw-tab${on ? ' is-on' : ''}`}
                onClick={() => switchView(t.key)}
              >
                <Icon size={15} />
                <span>{t.label}</span>
                <span className="exw-tab-count">{t.count}</span>
              </button>
            );
          })}
        </div>
        <div className="exw-search">
          <Search size={16} />
          <input
            type="search"
            aria-label="搜索公告、单位、岗位或专业"
            placeholder="搜索公告、单位、岗位或专业"
            value={filters.query}
            onChange={(e) => handleSearchInput(e.target.value)}
          />
          {filters.query && (
            <button type="button" aria-label="清空搜索" onClick={() => updateFilters({ query: '' })}>
              <X size={14} />
            </button>
          )}
        </div>
        <select
          className="exw-select"
          aria-label="排序"
          value={filters.sort}
          onChange={(e) => updateFilters({ sort: e.target.value as ExamFilters['sort'] })}
        >
          {SORT_OPTIONS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-secondary btn-sm exw-filter-toggle"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((v) => !v)}
        >
          <SlidersHorizontal size={14} />
          筛选{activeFilters.length > 0 ? ` · ${activeFilters.length}` : ''}
        </button>
      </div>

      <div className="exw-layout">
        {/* ---------- Filters ---------- */}
        <ExamFilterSidebar
          filters={filters}
          filtersOpen={filtersOpen}
          activeFilterCount={activeFilters.length}
          resultCount={listLength}
          onCloseMobile={() => setFiltersOpen(false)}
          onToggleCity={toggleCity}
          onUpdateFilters={updateFilters}
          onResetFilters={resetFilters}
        />

        {/* ---------- Results ---------- */}
        <section className="exw-results" id="exam-results" aria-label="检索结果">
          {error && (
            <div className="exw-alert">
              <span>{error}</span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={reload}>
                重试
              </button>
            </div>
          )}

          {filters.view === 'announcements' && milestones.length > 0 && (
            <section className="exw-upcoming" aria-label="近期考务节点">
              <div className="exw-upcoming-head">
                <h2>
                  <CalendarClock size={15} />
                  近期考务节点
                </h2>
              </div>
              <div className="exw-upcoming-list">
                {milestones.map((m) => (
                  <button
                    key={`${m.exam.id}-${m.type}-${m.date}`}
                    type="button"
                    className={`exw-up is-${m.tone}`}
                    onClick={() => openExam(m.exam)}
                  >
                    <span className="exw-up-date">
                      <b>{formatMonthDay(m.date)}</b>
                      <small>{m.type}</small>
                    </span>
                    <span className="exw-up-title">{m.exam.title}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {filters.view === 'saved' && (
            <div className="exw-tabs" role="tablist" aria-label="收藏子视图" style={{ marginBottom: 12 }}>
              <button
                type="button"
                role="tab"
                aria-selected={savedSubTab === 'announcements'}
                className={`exw-tab${savedSubTab === 'announcements' ? ' is-on' : ''}`}
                onClick={() => {
                  setSavedSubTab('announcements');
                  setPage(1);
                }}
              >
                <span>收藏公告</span>
                <span className="exw-tab-count">{savedAnnouncementExams.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={savedSubTab === 'candidates'}
                className={`exw-tab${savedSubTab === 'candidates' ? ' is-on' : ''}`}
                onClick={() => {
                  setSavedSubTab('candidates');
                  setPage(1);
                }}
              >
                <span>候选岗位</span>
                <span className="exw-tab-count">{candidateRows.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={savedSubTab === 'hidden'}
                className={`exw-tab${savedSubTab === 'hidden' ? ' is-on' : ''}`}
                onClick={() => {
                  setSavedSubTab('hidden');
                  setPage(1);
                }}
              >
                <span>已隐藏</span>
                <span className="exw-tab-count">{hiddenCount}</span>
              </button>
            </div>
          )}

          {filters.view !== 'tracker' && (
            <div className="exw-results-head">
              <p className="exw-count">
                共 <strong>{listLength}</strong>{' '}
                {filters.view === 'positions' || (filters.view === 'saved' && savedSubTab === 'candidates')
                  ? '个岗位'
                  : '条公告'}
                {profile.onlyMatchProfile && <span className="exw-muted"> · 已按我的条件过滤</span>}
              </p>
              {activeFilters.length > 0 && (
                <div className="exw-active-filters">
                  {activeFilters.map((f) => (
                    <button key={f.key} type="button" className="exw-active-chip" onClick={f.clear}>
                      {f.label}
                      <X size={12} />
                    </button>
                  ))}
                  <button type="button" className="text-btn" onClick={resetFilters}>
                    清除
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Announcements & saved announcements / hidden */}
          {(filters.view === 'announcements' || (filters.view === 'saved' && savedSubTab !== 'candidates')) &&
            (loading && !snapshot ? (
              <div className="exw-skeleton-list" aria-label="加载中">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="exw-skeleton" />
                ))}
              </div>
            ) : pagedExams.length === 0 ? (
              <div className="exw-empty">
                <p>
                  {filters.view === 'saved'
                    ? savedSubTab === 'hidden'
                      ? '还没有隐藏的公告'
                      : '还没有收藏的公告'
                    : '没有符合条件的公告'}
                </p>
                {activeFilters.length > 0 && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={resetFilters}>
                    清除筛选条件
                  </button>
                )}
              </div>
            ) : (
              <div className="exw-list">
                {pagedExams.map((exam) => (
                  <ExamCard
                    key={exam.id}
                    exam={exam}
                    profile={profile}
                    personal={personal[exam.id]}
                    today={today}
                    onSelect={openExam}
                    onToggleSave={toggleSaveExam}
                    onToggleHide={toggleHideExam}
                  />
                ))}
              </div>
            ))}

          {/* Saved candidate compare */}
          {filters.view === 'saved' && savedSubTab === 'candidates' && (
            <ExamPositionTable
              variant="candidates"
              rows={candidateRows}
              staleCount={staleCandidateCount}
              onCleanupStale={() => cleanupStalePositions(validPositionRowIds)}
              onSelectExam={openExam}
              onToggleCandidate={toggleCandidate}
            />
          )}

          {/* Positions */}
          {filters.view === 'positions' && (
            <ExamPositionTable
              variant="workspace"
              rows={pagedPositions}
              profileActive={profileActive}
              personal={personal}
              onSelectExam={openExam}
              onToggleCandidate={toggleCandidate}
            />
          )}

          {/* Tracker */}
          {filters.view === 'tracker' && (
            <ExamTrackerBoard
              allExams={allExams}
              personal={personal}
              trackedCount={trackedCount}
              today={today}
              onSelectExam={openExam}
              onNotify={setNotice}
            />
          )}

          {filters.view !== 'tracker' && !(filters.view === 'saved' && savedSubTab === 'candidates') && totalPages > 1 && (
            <nav className="exw-pager" aria-label="分页">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft size={14} />
                上一页
              </button>
              <span>
                {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={currentPage >= totalPages}
                onClick={() => setPage(currentPage + 1)}
              >
                下一页
                <ChevronRight size={14} />
              </button>
            </nav>
          )}

          {filters.view === 'announcements' && filters.stage !== '报名已结束' && endedExamCount > 0 && (
            <div className="exw-archive-bar">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => updateFilters({ stage: '报名已结束' })}
              >
                查看往期公告（{endedExamCount} 条）
              </button>
            </div>
          )}
        </section>
      </div>

      <ExamDetailDrawer
        exam={selectedExam}
        exams={filteredExams}
        detailShards={snapshot?.detail_shards}
        profile={profile}
        personal={selectedExam ? personal[selectedExam.id] : undefined}
        onClose={closeExam}
        onSelectExam={(nextExam) => openExam(nextExam, false)}
        onToggleSave={toggleSaveExam}
        onToggleHide={toggleHideExam}
        onUpdatePersonal={updatePersonalRecord}
        onChangeStatus={(examId: string, status: ExamTrackStatus) => {
          updatePersonalRecord(examId, { status, saved: status !== 'none' ? true : personal[examId]?.saved });
          if (status !== 'none') {
            setNotice(`报考进度：${getTrackStageInfo(status)?.label ?? status}`);
          }
        }}
        onNotify={setNotice}
      />

      <ExamSourcesSheet
        open={sourceOpen}
        onClose={closeSources}
        sources={snapshot?.sources || []}
      />

      <BottomTabBar
        workspace="exams"
        activeView={filters.view}
        onSwitchView={switchView}
        savedCount={savedCount}
        trackedCount={trackedCount}
      />
    </div>
  );
}
