'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bookmark,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  FileSpreadsheet,
  Kanban,
  Landmark,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  EXAM_PERSONAL_STORAGE,
  EXAM_TRACK_STAGES,
  filterExams,
  flattenAndFilterExamPositions,
  isExamProfileActive,
  validateExamPersonal,
} from '@/lib/exams';
import type {
  ExamAnnouncement,
  ExamFilters,
  ExamTrackStatus,
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
import { formatMonthDay } from '@/components/exam-ui';
import { useExamSnapshot } from '@/hooks/use-exam-snapshot';
import { useExamPersonal } from '@/hooks/use-exam-personal';

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
  const [notice, setNotice] = useState(() => {
    if (typeof window === 'undefined') return '';
    try {
      const raw = window.localStorage.getItem(EXAM_PERSONAL_STORAGE);
      if (raw) validateExamPersonal(JSON.parse(raw));
      return '';
    } catch {
      return '本地考编记录格式异常，已重置为默认状态';
    }
  });
  const [selectedExam, setSelectedExam] = useState<ExamAnnouncement | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);

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
    personal,
    updateProfile,
    clearProfile,
    updateFilters,
    resetFilters,
    updatePersonalRecord,
    toggleSaveExam,
    toggleCity,
    toggleCandidate,
    savedCount,
    trackedCount,
  } = useExamPersonal({ onNotice: setNotice, onPageReset: resetPage });

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const openExam = (exam: ExamAnnouncement) => {
    setSelectedExam(exam);
    if (!personal[exam.id]?.readAt) {
      updatePersonalRecord(exam.id, { readAt: new Date().toISOString() });
    }
  };

  const closeExam = useCallback(() => setSelectedExam(null), []);
  const closeSources = useCallback(() => setSourceOpen(false), []);

  const filteredExams = useMemo(
    () => filterExams(allExams, filters, profile, personal),
    [allExams, filters, profile, personal],
  );
  const flattenedPositions = useMemo(
    () => flattenAndFilterExamPositions(allExams, filters, profile),
    [allExams, filters, profile],
  );

  const milestones = useMemo<Milestone[]>(() => {
    if (!today) return [];
    const items: Milestone[] = [];
    for (const ex of allExams) {
      const s = ex.schedule;
      if (s.reg_end && ['registering', 'closing_soon', 'upcoming'].includes(ex.stage)) {
        items.push({
          exam: ex,
          date: s.reg_end,
          type: '报名截止',
          tone: ex.stage === 'closing_soon' ? 'urgent' : 'active',
        });
      }
      if (s.payment_end) items.push({ exam: ex, date: s.payment_end, type: '缴费截止', tone: 'urgent' });
      if (s.written_exam_date) items.push({ exam: ex, date: s.written_exam_date, type: '笔试', tone: 'info' });
    }
    return items
      .filter((m) => m.date.slice(0, 10) >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 10);
  }, [allExams, today]);

  const exportCalendar = () => {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Job Radar//Civil Exam Calendar//CN'];
    for (const m of milestones) {
      const day = m.date.replace(/-/g, '').slice(0, 8);
      if (!/^\d{8}$/.test(day)) continue;
      lines.push(
        'BEGIN:VEVENT',
        `UID:exam-${m.exam.id}-${m.type}@job-radar`,
        `DTSTART;VALUE=DATE:${day}`,
        `SUMMARY:【${m.type}】${m.exam.title}`,
        `DESCRIPTION:${m.exam.organizer}\\n${m.exam.source_url}`,
        'END:VEVENT',
      );
    }
    lines.push('END:VCALENDAR');
    const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = '考公考编考务日历.ics';
    a.click();
    URL.revokeObjectURL(url);
    setNotice('已导出日历文件，可导入手机或电脑日历');
  };

  const profileActive = isExamProfileActive(profile);

  const activeFilters = buildActiveExamFilters(filters, toggleCity, updateFilters);

  const listLength = filters.view === 'positions' ? flattenedPositions.length : filteredExams.length;
  const totalPages = Math.max(1, Math.ceil(listLength / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedExams = filteredExams.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const pagedPositions = flattenedPositions.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const tabs: { key: ExamFilters['view']; label: string; icon: typeof Landmark; count: number }[] = [
    { key: 'announcements', label: '招考公告', icon: Landmark, count: filteredExams.length },
    { key: 'positions', label: '职位库', icon: FileSpreadsheet, count: flattenedPositions.length },
    { key: 'saved', label: '收藏', icon: Bookmark, count: savedCount },
    { key: 'tracker', label: '报考进度', icon: Kanban, count: trackedCount },
  ];

  return (
    <div className="exw">
      {notice && (
        <output className="toast">
          <span>{notice}</span>
          <button type="button" aria-label="关闭提示" onClick={() => setNotice('')}>
            <X size={15} />
          </button>
        </output>
      )}

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
                onClick={() => updateFilters({ view: t.key })}
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
            onChange={(e) => updateFilters({ query: e.target.value })}
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
          onToggleCity={toggleCity}
          onUpdateFilters={updateFilters}
          onResetFilters={resetFilters}
        />

        {/* ---------- Results ---------- */}
        <section className="exw-results" aria-label="检索结果">
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
                <button type="button" className="text-btn" onClick={exportCalendar}>
                  <Download size={14} />
                  导出日历
                </button>
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

          {filters.view !== 'tracker' && (
            <div className="exw-results-head">
              <p className="exw-count">
                共 <strong>{listLength}</strong> {filters.view === 'positions' ? '个岗位' : '条公告'}
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

          {/* Announcements & saved */}
          {(filters.view === 'announcements' || filters.view === 'saved') &&
            (loading && !snapshot ? (
              <div className="exw-skeleton-list" aria-label="加载中">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="exw-skeleton" />
                ))}
              </div>
            ) : pagedExams.length === 0 ? (
              <div className="exw-empty">
                <p>{filters.view === 'saved' ? '还没有收藏的公告' : '没有符合条件的公告'}</p>
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
                    onSelect={openExam}
                    onToggleSave={toggleSaveExam}
                  />
                ))}
              </div>
            ))}

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
              onSelectExam={openExam}
            />
          )}

          {filters.view !== 'tracker' && totalPages > 1 && (
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
        profile={profile}
        personal={selectedExam ? personal[selectedExam.id] : undefined}
        onClose={closeExam}
        onSelectExam={openExam}
        onToggleSave={toggleSaveExam}
        onUpdatePersonal={updatePersonalRecord}
        onChangeStatus={(examId: string, status: ExamTrackStatus) => {
          updatePersonalRecord(examId, { status, saved: status !== 'none' ? true : personal[examId]?.saved });
          if (status !== 'none') {
            setNotice(`报考进度：${EXAM_TRACK_STAGES.find((s) => s.key === status)?.label ?? status}`);
          }
        }}
        onNotify={setNotice}
      />

      <ExamSourcesSheet
        open={sourceOpen}
        onClose={closeSources}
        sources={snapshot?.sources || []}
      />
    </div>
  );
}
