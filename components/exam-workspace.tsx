'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bookmark,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  ExternalLink,
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
  DEFAULT_EXAM_PROFILE,
  deriveExamStage,
  EXAM_FILTERS_STORAGE,
  EXAM_PERSONAL_STORAGE,
  EXAM_PROFILE_STORAGE,
  EXAM_TRACK_STAGES,
  filterExams,
  flattenAndFilterExamPositions,
  isExamProfileActive,
  validateExamPersonal,
  validateExamProfile,
} from '@/lib/exams';
import type {
  ExamAnnouncement,
  ExamFilters,
  ExamPersonalRecord,
  ExamPersonalStore,
  ExamSnapshot,
  ExamTrackStatus,
  ExamUserProfile,
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
import {
  chinaToday,
  ExamSheet,
  formatMonthDay,
  formatShortDate,
} from '@/components/exam-ui';

const PAGE_SIZE = 20;
const EXAM_FILTERS_MIGRATED_KEY = 'job-radar-exam-filters-migrated-v2';

const SORT_OPTIONS: [ExamFilters['sort'], string][] = [
  ['smart', '报名中优先'],
  ['published', '最新发布'],
  ['reg_end', '报名截止最近'],
  ['headcount', '招录人数最多'],
];

function safeReadJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

function safeWriteJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
}

async function fetchExamSnapshot(): Promise<ExamSnapshot> {
  const resp = await fetch('/exams.json', { cache: 'no-cache' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()) as ExamSnapshot;
}

interface Milestone {
  exam: ExamAnnouncement;
  date: string;
  type: string;
  tone: 'urgent' | 'active' | 'info';
}

export function ExamWorkspace() {
  const [snapshot, setSnapshot] = useState<ExamSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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
  const [today, setToday] = useState('');
  const [nowMs, setNowMs] = useState(0);
  const [profile, setProfile] = useState<ExamUserProfile>(() => {
    if (typeof window === 'undefined') return DEFAULT_EXAM_PROFILE;
    try {
      const raw = window.localStorage.getItem(EXAM_PROFILE_STORAGE);
      return raw ? validateExamProfile(JSON.parse(raw)) : DEFAULT_EXAM_PROFILE;
    } catch {
      return DEFAULT_EXAM_PROFILE;
    }
  });
  const [filters, setFilters] = useState<ExamFilters>(() => {
    const loaded = safeReadJson(EXAM_FILTERS_STORAGE, DEFAULT_EXAM_FILTERS);
    if (typeof window !== 'undefined') {
      try {
        if (!window.localStorage.getItem(EXAM_FILTERS_MIGRATED_KEY)) {
          window.localStorage.setItem(EXAM_FILTERS_MIGRATED_KEY, '1');
          if (loaded.stage === '全部') {
            const migrated = { ...loaded, stage: DEFAULT_EXAM_FILTERS.stage };
            safeWriteJson(EXAM_FILTERS_STORAGE, migrated);
            return migrated;
          }
        }
      } catch {
        // ignore storage errors
      }
    }
    return loaded;
  });
  const [personal, setPersonal] = useState<ExamPersonalStore>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = window.localStorage.getItem(EXAM_PERSONAL_STORAGE);
      return raw ? validateExamPersonal(JSON.parse(raw)) : {};
    } catch {
      return {};
    }
  });
  const [selectedExam, setSelectedExam] = useState<ExamAnnouncement | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === EXAM_PERSONAL_STORAGE) {
        try {
          const raw = window.localStorage.getItem(EXAM_PERSONAL_STORAGE);
          setPersonal(raw ? validateExamPersonal(JSON.parse(raw)) : {});
        } catch {
          setPersonal({});
          setNotice('本地考编记录格式异常，已重置为默认状态');
        }
      } else if (event.key === EXAM_PROFILE_STORAGE) {
        try {
          const raw = window.localStorage.getItem(EXAM_PROFILE_STORAGE);
          setProfile(raw ? validateExamProfile(JSON.parse(raw)) : DEFAULT_EXAM_PROFILE);
        } catch {
          setProfile(DEFAULT_EXAM_PROFILE);
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  useEffect(() => {
    let active = true;
    fetchExamSnapshot()
      .then((data) => {
        if (!active) return;
        setSnapshot(data);
        setToday(chinaToday());
        setNowMs(Date.now());
      })
      .catch(() => {
        if (active) setError('考公考编数据读取失败，请稍后重试。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const reload = () => {
    setLoading(true);
    setError('');
    fetchExamSnapshot()
      .then((data) => {
        setSnapshot(data);
        setToday(chinaToday());
        setNowMs(Date.now());
        setNotice('数据已刷新');
      })
      .catch(() => setError('考公考编数据读取失败，请稍后重试。'))
      .finally(() => setLoading(false));
  };

  const updateProfile = (patch: Partial<ExamUserProfile>) => {
    setProfile((prev) => {
      const next = { ...prev, ...patch };
      safeWriteJson(EXAM_PROFILE_STORAGE, next);
      return next;
    });
    setPage(1);
  };

  const updateFilters = (patch: Partial<ExamFilters>) => {
    setFilters((prev) => {
      const next = { ...prev, ...patch };
      safeWriteJson(EXAM_FILTERS_STORAGE, next);
      return next;
    });
    setPage(1);
  };

  const resetFilters = () => {
    const clean: ExamFilters = { ...DEFAULT_EXAM_FILTERS, view: filters.view, sort: filters.sort };
    setFilters(clean);
    safeWriteJson(EXAM_FILTERS_STORAGE, clean);
    setPage(1);
  };

  const updatePersonalRecord = (examId: string, patch: Partial<ExamPersonalRecord>) => {
    setPersonal((prev) => {
      const next: ExamPersonalStore = {
        ...prev,
        [examId]: { ...prev[examId], ...patch, updatedAt: new Date().toISOString() },
      };
      safeWriteJson(EXAM_PERSONAL_STORAGE, next);
      return next;
    });
  };

  const openExam = (exam: ExamAnnouncement) => {
    setSelectedExam(exam);
    if (!personal[exam.id]?.readAt) {
      updatePersonalRecord(exam.id, { readAt: new Date().toISOString() });
    }
  };

  const closeExam = useCallback(() => setSelectedExam(null), []);
  const closeSources = useCallback(() => setSourceOpen(false), []);

  const toggleSaveExam = (examId: string) => {
    const current = personal[examId]?.saved;
    updatePersonalRecord(examId, { saved: !current });
    setNotice(!current ? '已收藏' : '已取消收藏');
  };

  const toggleCity = (city: string) => {
    if (city === '全部') {
      updateFilters({ cities: ['全部'] });
      return;
    }
    const cur = filters.cities.filter((c) => c !== '全部');
    const next = cur.includes(city) ? cur.filter((c) => c !== city) : [...cur, city];
    updateFilters({ cities: next.length > 0 ? next : ['全部'] });
  };

  const toggleCandidate = (examId: string, rowId: string, positionName: string) => {
    const rec = personal[examId];
    const prevIds = rec?.savedPositionIds || [];
    const exists = prevIds.includes(rowId);
    updatePersonalRecord(examId, {
      saved: true,
      savedPositionIds: exists ? prevIds.filter((id) => id !== rowId) : [...prevIds, rowId],
      status: !rec?.status || rec.status === 'none' ? 'comparing' : rec.status,
    });
    setNotice(exists ? '已移出候选岗位' : `已加入候选：${positionName}`);
  };

  const allExams = useMemo(
    () => (snapshot?.exams || []).map((e) => (today ? { ...e, stage: deriveExamStage(e, today) } : e)),
    [snapshot, today],
  );
  const activeExamCount = useMemo(
    () => allExams.filter((e) => ['upcoming', 'registering', 'closing_soon', 'rolling'].includes(e.stage)).length,
    [allExams],
  );
  const endedExamCount = useMemo(
    () => allExams.filter((e) => e.stage === 'ended').length,
    [allExams],
  );
  const freshnessMeta = useMemo(() => {
    if (!snapshot?.generated_at || !nowMs) return null;
    const ms = Date.parse(snapshot.generated_at);
    if (!Number.isFinite(ms)) return null;
    const hours = Math.max(0, Math.round((nowMs - ms) / 3600_000));
    const stale = hours > 36;
    const label = hours < 1 ? '刚刚更新' : `更新于 ${hours} 小时前`;
    return { hours, stale, label };
  }, [snapshot, nowMs]);
  const filteredExams = useMemo(
    () => filterExams(allExams, filters, profile, personal),
    [allExams, filters, profile, personal],
  );
  const flattenedPositions = useMemo(
    () => flattenAndFilterExamPositions(allExams, filters, profile),
    [allExams, filters, profile],
  );
  const savedCount = useMemo(
    () =>
      Object.values(personal).filter((r) => r.saved || (r.savedPositionIds?.length ?? 0) > 0).length,
    [personal],
  );
  const trackedCount = useMemo(
    () => Object.values(personal).filter((r) => r.status && r.status !== 'none').length,
    [personal],
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
        onClearProfile={() => {
          setProfile(DEFAULT_EXAM_PROFILE);
          safeWriteJson(EXAM_PROFILE_STORAGE, DEFAULT_EXAM_PROFILE);
        }}
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

      <ExamSheet open={sourceOpen} onClose={closeSources} label="信息来源" width={560}>
        <header className="exw-dh">
          <div className="exw-dh-top">
            <div>
              <h2 className="exw-dh-title">信息来源</h2>
              <p className="exw-dh-sub">国家统考、山东省直、16 地市人社局及高校招考专栏</p>
            </div>
            <button type="button" className="exw-icon-btn" aria-label="关闭" onClick={closeSources}>
              <X size={18} />
            </button>
          </div>
        </header>
        <div className="exw-db">
          <ul className="exw-source-list">
            {(snapshot?.sources || []).map((src) => {
              const count = src.count ?? 0;
              const isZero = count === 0;
              return (
                <li key={src.id}>
                  <div>
                    <strong>
                      <span className={`exw-src-dot ${isZero ? 'is-zero' : 'is-ok'}`} aria-hidden="true" />
                      {src.name}
                    </strong>
                    <span className="exw-muted">
                      {src.city || src.level || '官方'} · {isZero ? '本次 0 条' : `${count} 条`}
                      {src.last_success_at ? ` · 更新于 ${formatShortDate(src.last_success_at)}` : ''}
                    </span>
                  </div>
                  <a href={src.url} target="_blank" rel="noopener noreferrer" className="exw-card-link">
                    官网
                    <ExternalLink size={12} />
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </ExamSheet>
    </div>
  );
}
