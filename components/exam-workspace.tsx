'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Bookmark,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Kanban,
  Landmark,
  MapPin,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Star,
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
  SHANDONG_16,
  validateExamPersonal,
  validateExamProfile,
} from '@/lib/exams';
import type {
  BianzhiCategory,
  ExamAnnouncement,
  ExamCategory,
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
  bianzhiLabel,
  categoryLabel,
  chinaToday,
  ExamSheet,
  formatMonthDay,
  formatShortDate,
} from '@/components/exam-ui';

const PAGE_SIZE = 20;
const EXAM_FILTERS_MIGRATED_KEY = 'job-radar-exam-filters-migrated-v2';

const EXAM_CATEGORIES: ExamCategory[] = [
  '公务员国考',
  '公务员省考',
  '选调生招录',
  '事业单位统考',
  '事业单位单招',
  '教师公开招聘',
  '医疗卫生招聘',
  '高校 / 科研院所',
  '人才引进 / 优才',
  '军队文职招考',
  '三支一扶 / 基层',
];

const BIANZHI_OPTIONS: BianzhiCategory[] = [
  '公务员（行政编）',
  '参公管理',
  '事业编',
  '控制总量 / 备案制',
  '选调生',
  '教师编',
  '医疗卫生编',
  '军队文职',
  '三支一扶 / 基层项目',
  '高层次 / 紧缺人才',
];

const SUBJECT_OPTIONS = ['行测', '申论', '公基', '职测', '综应', '综合写作', '教基/教学', '医基/临床', '直接面试/面谈'];

/** value → display label; values are what filterExams() expects. */
const STAGE_OPTIONS: [string, string][] = [
  ['可报名/进行中', '可报名'],
  ['正在报名', '报名中'],
  ['即将开始', '即将开始'],
  ['长期招聘', '长期招聘'],
  ['考务跟进（笔面试/资审）', '考试进行中'],
  ['时间待确认', '时间待确认'],
  ['报名已结束', '已结束'],
];

const NOTICE_OPTIONS: [string, string][] = [
  ['仅看招考简章', '只看招考简章'],
  ['考务进展通知', '只看考务通知'],
];

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

function FilterSection({
  title,
  children,
  defaultOpen = true,
  badge,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  badge?: number;
}) {
  return (
    <details className="exw-fsec" open={defaultOpen}>
      <summary>
        <span>{title}</span>
        {badge ? <span className="exw-fsec-badge">{badge}</span> : null}
        <ChevronDown size={14} className="exw-fsec-caret" />
      </summary>
      <div className="exw-fsec-body">{children}</div>
    </details>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`exw-chip${active ? ' is-on' : ''}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
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

  const selectedCities = filters.cities.filter((c) => c !== '全部');
  const activeFilters: { key: string; label: string; clear: () => void }[] = [
    ...selectedCities.map((c) => ({ key: `city-${c}`, label: c, clear: () => toggleCity(c) })),
    ...(filters.category !== '全部'
      ? [{ key: 'cat', label: categoryLabel(filters.category), clear: () => updateFilters({ category: '全部' }) }]
      : []),
    ...(filters.bianzhi !== '全部'
      ? [{ key: 'bz', label: bianzhiLabel(filters.bianzhi), clear: () => updateFilters({ bianzhi: '全部' }) }]
      : []),
    ...(filters.stage !== '全部'
      ? [{
          key: 'stage',
          label: STAGE_OPTIONS.find(([v]) => v === filters.stage)?.[1] ?? filters.stage,
          clear: () => updateFilters({ stage: '全部' }),
        }]
      : []),
    ...(filters.subject !== '全部'
      ? [{ key: 'subj', label: filters.subject, clear: () => updateFilters({ subject: '全部' }) }]
      : []),
    ...(filters.noticeRole !== '全部'
      ? [{
          key: 'role',
          label: NOTICE_OPTIONS.find(([v]) => v === filters.noticeRole)?.[1] ?? filters.noticeRole,
          clear: () => updateFilters({ noticeRole: '全部' }),
        }]
      : []),
    ...(filters.unlimitedMajorOnly
      ? [{ key: 'major', label: '含不限专业', clear: () => updateFilters({ unlimitedMajorOnly: false }) }]
      : []),
  ];

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
        <aside className={`exw-filters${filtersOpen ? ' is-open' : ''}`} aria-label="筛选条件">
          <div className="exw-filters-head">
            <span>筛选</span>
            {activeFilters.length > 0 && (
              <button type="button" className="text-btn" onClick={resetFilters}>
                重置
              </button>
            )}
          </div>

          <FilterSection title="地区" badge={selectedCities.length}>
            <div className="exw-chip-grid">
              <Chip active={selectedCities.length === 0} onClick={() => toggleCity('全部')}>
                全部
              </Chip>
              {SHANDONG_16.map((city) => (
                <Chip key={city} active={filters.cities.includes(city)} onClick={() => toggleCity(city)}>
                  {city}
                </Chip>
              ))}
            </div>
          </FilterSection>

          <FilterSection title="报名状态" badge={filters.stage !== '全部' ? 1 : 0}>
            <div className="exw-chip-wrap">
              <Chip active={filters.stage === '全部'} onClick={() => updateFilters({ stage: '全部' })}>
                全部
              </Chip>
              {STAGE_OPTIONS.map(([v, label]) => (
                <Chip key={v} active={filters.stage === v} onClick={() => updateFilters({ stage: v })}>
                  {label}
                </Chip>
              ))}
            </div>
          </FilterSection>

          <FilterSection title="招考类别" badge={filters.category !== '全部' ? 1 : 0}>
            <div className="exw-chip-wrap">
              <Chip active={filters.category === '全部'} onClick={() => updateFilters({ category: '全部' })}>
                全部
              </Chip>
              {EXAM_CATEGORIES.map((cat) => (
                <Chip key={cat} active={filters.category === cat} onClick={() => updateFilters({ category: cat })}>
                  {categoryLabel(cat)}
                </Chip>
              ))}
            </div>
          </FilterSection>

          <FilterSection title="编制性质" badge={filters.bianzhi !== '全部' ? 1 : 0}>
            <div className="exw-chip-wrap">
              <Chip active={filters.bianzhi === '全部'} onClick={() => updateFilters({ bianzhi: '全部' })}>
                全部
              </Chip>
              {BIANZHI_OPTIONS.map((bz) => (
                <Chip key={bz} active={filters.bianzhi === bz} onClick={() => updateFilters({ bianzhi: bz })}>
                  {bianzhiLabel(bz)}
                </Chip>
              ))}
            </div>
          </FilterSection>

          <FilterSection
            title="更多"
            defaultOpen={false}
            badge={
              (filters.subject !== '全部' ? 1 : 0) +
              (filters.noticeRole !== '全部' ? 1 : 0) +
              (filters.unlimitedMajorOnly ? 1 : 0)
            }
          >
            <p className="exw-fsub">考试科目</p>
            <div className="exw-chip-wrap">
              <Chip active={filters.subject === '全部'} onClick={() => updateFilters({ subject: '全部' })}>
                全部
              </Chip>
              {SUBJECT_OPTIONS.map((s) => (
                <Chip key={s} active={filters.subject === s} onClick={() => updateFilters({ subject: s })}>
                  {s}
                </Chip>
              ))}
            </div>
            <p className="exw-fsub">公告类型</p>
            <div className="exw-chip-wrap">
              <Chip active={filters.noticeRole === '全部'} onClick={() => updateFilters({ noticeRole: '全部' })}>
                全部
              </Chip>
              {NOTICE_OPTIONS.map(([v, label]) => (
                <Chip key={v} active={filters.noticeRole === v} onClick={() => updateFilters({ noticeRole: v })}>
                  {label}
                </Chip>
              ))}
            </div>
            <label className="exw-switch is-block">
              <input
                type="checkbox"
                checked={filters.unlimitedMajorOnly}
                onChange={(e) => updateFilters({ unlimitedMajorOnly: e.target.checked })}
              />
              <span className="exw-switch-ui" aria-hidden="true" />
              <span>只看含「不限专业」岗位</span>
            </label>
          </FilterSection>
        </aside>

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
          {filters.view === 'positions' &&
            (pagedPositions.length === 0 ? (
              <div className="exw-empty">
                <p>没有符合条件的岗位</p>
              </div>
            ) : (
              <div className="exw-table-wrap">
                <table className="exw-table">
                  <thead>
                    <tr>
                      <th>岗位</th>
                      <th>地区</th>
                      <th className="is-num">人数</th>
                      <th>学历 / 专业</th>
                      <th>其他条件</th>
                      {profileActive && <th>资格</th>}
                      <th aria-label="候选" />
                    </tr>
                  </thead>
                  <tbody>
                    {pagedPositions.map((row) => {
                      const isCand = personal[row.exam.id]?.savedPositionIds?.includes(row.row_id);
                      const extra = [
                        row.political_status && row.political_status !== '不限' ? row.political_status : '',
                        row.fresh_grad_rule && !/^(不限|应往届均可)$/.test(row.fresh_grad_rule)
                          ? row.fresh_grad_rule
                          : '',
                      ].filter(Boolean);
                      return (
                        <tr key={row.row_id} className={profileActive && row.eligibility.matched ? 'is-ok' : ''}>
                          <td className="exw-td-main">
                            <button type="button" className="exw-row-title" onClick={() => openExam(row.exam)}>
                              {row.position_name}
                            </button>
                            <div className="exw-row-sub">
                              {row.employer}
                              {row.position_code ? <span className="exw-code">{row.position_code}</span> : null}
                            </div>
                            <div className="exw-row-src" title={row.exam.title}>
                              {row.exam.title}
                            </div>
                          </td>
                          <td className="exw-nowrap">{row.city || row.exam.cities[0] || row.exam.province}</td>
                          <td className="is-num">
                            <strong>{row.recruit_count ?? '—'}</strong>
                          </td>
                          <td>
                            <div>{row.education || '见公告'}</div>
                            <div className="exw-row-sub exw-clamp" title={row.major_raw || '见公告'}>
                              {row.major_raw || '见公告'}
                            </div>
                          </td>
                          <td>
                            {extra.length > 0 ? (
                              <div className="exw-row-tags">
                                {extra.map((t) => (
                                  <span key={t} className="exw-tag">
                                    {t}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <span className="exw-muted">—</span>
                            )}
                          </td>
                          {profileActive && (
                            <td>
                              {row.eligibility.status === 'eligible' ? (
                                <span
                                  className="exw-elig is-ok"
                                  title={row.eligibility.reasons.join('；')}
                                  aria-label={`可报：${row.eligibility.reasons.join('；')}`}
                                >
                                  <CheckCircle2 size={12} />
                                  可报
                                </span>
                              ) : row.eligibility.status === 'unknown' ? (
                                <div
                                  title={row.eligibility.unknowns.join('；')}
                                  aria-label={`待核实：${row.eligibility.unknowns.join('；')}`}
                                >
                                  <span className="exw-elig is-unknown">待核实</span>
                                  {row.eligibility.unknowns[0] && (
                                    <div className="exw-elig-sub">{row.eligibility.unknowns[0].slice(0, 20)}</div>
                                  )}
                                </div>
                              ) : (
                                <div
                                  title={row.eligibility.conflicts.join('；')}
                                  aria-label={`不符：${row.eligibility.conflicts.join('；')}`}
                                >
                                  <span className="exw-elig is-no">不符</span>
                                  {row.eligibility.conflicts[0] && (
                                    <div className="exw-elig-sub">{row.eligibility.conflicts[0].slice(0, 20)}</div>
                                  )}
                                </div>
                              )}
                            </td>
                          )}
                          <td className="is-action">
                            <button
                              type="button"
                              className={`exw-icon-btn${isCand ? ' is-on' : ''}`}
                              aria-pressed={Boolean(isCand)}
                              aria-label={isCand ? '移出候选' : '加入候选'}
                              title={isCand ? '移出候选' : '加入候选'}
                              onClick={() => toggleCandidate(row.exam.id, row.row_id, row.position_name)}
                            >
                              <Star size={15} fill={isCand ? 'currentColor' : 'none'} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}

          {/* Tracker */}
          {filters.view === 'tracker' &&
            (trackedCount === 0 ? (
              <div className="exw-empty">
                <Kanban size={28} />
                <p>还没有跟进中的报考</p>
                <span className="exw-muted">打开任一公告，在详情中设置「报考进度」即可加入看板</span>
              </div>
            ) : (
              <div className="exw-kanban">
                {EXAM_TRACK_STAGES.map((stage) => {
                  const stageExams = allExams.filter((ex) => personal[ex.id]?.status === stage.key);
                  return (
                    <section key={stage.key} className={`exw-kcol${stage.key === 'audited' ? ' is-warn' : ''}`}>
                      <header className="exw-kcol-head">
                        <span>{stage.shortLabel}</span>
                        <span className="exw-kcount">{stageExams.length}</span>
                      </header>
                      <div className="exw-kcards">
                        {stageExams.map((ex) => {
                          const rec = personal[ex.id];
                          return (
                            <button key={ex.id} type="button" className="exw-kcard" onClick={() => openExam(ex)}>
                              <span className="exw-kcard-title">{ex.title}</span>
                              <span className="exw-kcard-meta">
                                <MapPin size={11} />
                                {ex.cities[0] || ex.province} · {categoryLabel(ex.exam_category)}
                              </span>
                              {rec?.targetPositionCode && (
                                <span className="exw-kcard-note">主报：{rec.targetPositionCode}</span>
                              )}
                              {(ex.schedule.payment_end || ex.schedule.written_exam_date) && (
                                <span className="exw-kcard-date">
                                  {ex.schedule.payment_end
                                    ? `缴费截止 ${formatMonthDay(ex.schedule.payment_end)}`
                                    : `笔试 ${formatMonthDay(ex.schedule.written_exam_date)}`}
                                </span>
                              )}
                            </button>
                          );
                        })}
                        {stageExams.length === 0 && <p className="exw-kempty">—</p>}
                      </div>
                    </section>
                  );
                })}
              </div>
            ))}

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
