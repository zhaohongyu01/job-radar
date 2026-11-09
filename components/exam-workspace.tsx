'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bookmark,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Database,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Filter,
  Kanban,
  MapPin,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  UserCheck,
  X,
} from 'lucide-react';
import {
  DEFAULT_EXAM_FILTERS,
  DEFAULT_EXAM_PROFILE,
  EXAM_TRACK_STAGES,
  filterExams,
  flattenAndFilterExamPositions,
  isExamProfileActive,
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

const EXAM_PROFILE_STORAGE = 'job-radar-exam-profile-v1';
const EXAM_FILTERS_STORAGE = 'job-radar-exam-filters-v1';
export const EXAM_PERSONAL_STORAGE = 'job-radar-exam-personal-v1';

const SHANDONG_16_CITIES = [
  '济南', '青岛', '烟台', '潍坊', '临沂', '济宁', '淄博', '威海',
  '泰安', '东营', '日照', '德州', '聊城', '滨州', '菏泽', '枣庄',
];

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

const SUBJECT_OPTIONS = [
  '全部',
  '行测',
  '申论',
  '公基',
  '职测',
  '综应',
  '综合写作',
  '教基/教学',
  '医基/临床',
  '直接面试/面谈',
];

const STAGE_OPTIONS = [
  '全部',
  '可报名/进行中',
  '正在报名',
  '即将开始',
  '考务跟进（笔面试/资审）',
  '报名已结束',
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

export function ExamWorkspace() {
  const [snapshot, setSnapshot] = useState<ExamSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [profile, setProfile] = useState<ExamUserProfile>(() =>
    safeReadJson(EXAM_PROFILE_STORAGE, DEFAULT_EXAM_PROFILE),
  );
  const [filters, setFilters] = useState<ExamFilters>(() =>
    safeReadJson(EXAM_FILTERS_STORAGE, DEFAULT_EXAM_FILTERS),
  );
  const [personal, setPersonal] = useState<ExamPersonalStore>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const rawPersonal = window.localStorage.getItem(EXAM_PERSONAL_STORAGE);
      return rawPersonal ? (JSON.parse(rawPersonal) as ExamPersonalStore) : {};
    } catch {
      return {};
    }
  });
  const [selectedExam, setSelectedExam] = useState<ExamAnnouncement | null>(null);
  const [sourceModalOpen, setSourceModalOpen] = useState(false);
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const loadSnapshot = async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await fetch('/exams.json', { cache: 'no-cache' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = (await resp.json()) as ExamSnapshot;
      setSnapshot(data);
    } catch {
      setError('考公考编索引读取失败，请点击重试。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    fetch('/exams.json', { cache: 'no-cache' })
      .then(async (resp) => {
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return (await resp.json()) as ExamSnapshot;
      })
      .then((data) => {
        if (active) setSnapshot(data);
      })
      .catch(() => {
        if (active) setError('考公考编索引读取失败，请点击重试。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

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

  const resetAllFilters = () => {
    const clean: ExamFilters = {
      ...DEFAULT_EXAM_FILTERS,
      view: filters.view,
    };
    setFilters(clean);
    safeWriteJson(EXAM_FILTERS_STORAGE, clean);
    setPage(1);
  };

  const updatePersonalRecord = (examId: string, patch: Partial<ExamPersonalRecord>) => {
    setPersonal((prev) => {
      const current = prev[examId] || {};
      const next: ExamPersonalStore = {
        ...prev,
        [examId]: {
          ...current,
          ...patch,
          updatedAt: new Date().toISOString(),
        },
      };
      safeWriteJson(EXAM_PERSONAL_STORAGE, next);
      return next;
    });
  };

  const toggleSaveExam = (examId: string) => {
    const current = personal[examId]?.saved;
    updatePersonalRecord(examId, { saved: !current });
    setNotice(!current ? '已收藏招考简章' : '已取消收藏');
  };

  const changeTrackStatus = (examId: string, status: ExamTrackStatus) => {
    updatePersonalRecord(examId, {
      status,
      saved: status !== 'none' ? true : personal[examId]?.saved,
    });
    if (status !== 'none') {
      const label = EXAM_TRACK_STAGES.find((s) => s.key === status)?.label || status;
      setNotice(`已更新报考状态为「${label}」`);
    }
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

  const allExams = useMemo(() => snapshot?.exams || [], [snapshot]);

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
      Object.values(personal).filter(
        (r) => r.saved || (r.savedPositionIds && r.savedPositionIds.length > 0),
      ).length,
    [personal],
  );

  const trackedCount = useMemo(
    () => Object.values(personal).filter((r) => r.status && r.status !== 'none').length,
    [personal],
  );

  // Upcoming exam calendar milestones
  const calendarMilestones = useMemo(() => {
    const items: {
      exam: ExamAnnouncement;
      date: string;
      type: string;
      tone: 'urgent' | 'active' | 'info';
    }[] = [];
    for (const ex of allExams) {
      if (ex.schedule.reg_end && ['registering', 'closing_soon', 'upcoming'].includes(ex.stage)) {
        items.push({
          exam: ex,
          date: ex.schedule.reg_end,
          type: ex.stage === 'closing_soon' ? '报名即将截止' : '网上报名截止',
          tone: ex.stage === 'closing_soon' ? 'urgent' : 'active',
        });
      }
      if (ex.schedule.payment_end) {
        items.push({
          exam: ex,
          date: ex.schedule.payment_end,
          type: '缴费确认截止',
          tone: 'urgent',
        });
      }
      if (ex.schedule.written_exam_date) {
        items.push({
          exam: ex,
          date: ex.schedule.written_exam_date,
          type: '笔试开考日',
          tone: 'info',
        });
      }
    }
    return items
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 12);
  }, [allExams]);

  const exportExamCalendarIcs = () => {
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Job Radar//Civil Exam Calendar//CN',
    ];
    for (const m of calendarMilestones) {
      const cleanDate = m.date.replace(/-/g, '').slice(0, 8);
      if (!/^\d{8}$/.test(cleanDate)) continue;
      lines.push(
        'BEGIN:VEVENT',
        `UID:exam-${m.exam.id}-${m.type}@job-radar`,
        `DTSTART;VALUE=DATE:${cleanDate}`,
        `SUMMARY:【${m.type}】${m.exam.title}`,
        `DESCRIPTION:主管机关：${m.exam.organizer}\\n原公告：${m.exam.source_url}`,
        'END:VEVENT',
      );
    }
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '考公考编关键考务日历.ics';
    a.click();
    URL.revokeObjectURL(url);
    setNotice('已导出考务日历 (.ics)，可导入手机或电脑日历设置提醒');
  };

  const totalPages = Math.max(
    1,
    Math.ceil(
      (filters.view === 'positions' ? flattenedPositions.length : filteredExams.length) / pageSize,
    ),
  );
  const pagedExams = filteredExams.slice((page - 1) * pageSize, page * pageSize);
  const pagedPositions = flattenedPositions.slice((page - 1) * pageSize, page * pageSize);
  const profileActive = isExamProfileActive(profile);

  return (
    <div className="exam-workspace">
      {notice && (
        <output className="toast">
          <span>{notice}</span>
          <button type="button" aria-label="关闭提示" onClick={() => setNotice('')}>
            <X size={15} />
          </button>
        </output>
      )}

      {/* Top Hero & One-Click Eligibility Profile Card */}
      <section className="exam-hero-panel" aria-label="考公考编总览与个人报考画像">
        <div className="exam-hero-top">
          <div className="exam-hero-title-group">
            <div className="exam-eyebrow">
              <ShieldCheck size={15} />
              <span>独立考公考编工作台 · 与企业求职职位物理隔离</span>
            </div>
            <h1 className="exam-main-title">
              山东省级 & 16地市 · 公务员 / 选调生 / 事业单位 / 教师医疗 / 军队文职
            </h1>
            <p className="exam-main-desc">
              聚合官方招考简章、考务进展通知与附件《岗位汇总表》，支持按编制性质、政治面貌、应届身份、专业代码跨简章一键选岗。
            </p>
          </div>

          <div className="exam-hero-stats">
            <div className="exam-stat-box">
              <span>收录招考公告</span>
              <strong>{snapshot ? snapshot.total_exams : '—'}</strong>
              <small>含简章与考务通知</small>
            </div>
            <div className="exam-stat-box">
              <span>结构化岗位表</span>
              <strong>{snapshot ? snapshot.total_positions : '—'}</strong>
              <small>支持跨简章选岗</small>
            </div>
            <div className="exam-stat-box">
              <span>累计招录名额</span>
              <strong>{snapshot ? snapshot.total_headcount : '—'}</strong>
              <small>编制/控总/专项</small>
            </div>
            <div className="exam-stat-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setSourceModalOpen(true)}
              >
                <Database size={14} />
                <span>官方招考渠道 ({snapshot?.sources.length || 0})</span>
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void loadSnapshot()}
                disabled={loading}
              >
                <RefreshCw size={14} className={loading ? 'spinning' : ''} />
                <span>刷新</span>
              </button>
            </div>
          </div>
        </div>

        {/* Personal Exam Profile Bar (我的报考条件一键匹配卡) */}
        <div className={`exam-profile-bar ${profile.onlyMatchProfile ? 'is-active' : ''}`}>
          <div className="exam-profile-head">
            <div className="exam-profile-label">
              <UserCheck size={16} />
              <strong>我的考公报考画像（一键排雷硬性限制）</strong>
              <span className="text-muted">保存在本机浏览器，自动比对岗位表中的学历、党员、应届、户籍与专业要求</span>
            </div>
            <label className="exam-profile-switch">
              <input
                type="checkbox"
                checked={profile.onlyMatchProfile}
                onChange={(e) => updateProfile({ onlyMatchProfile: e.target.checked })}
              />
              <Sparkles size={14} />
              <span>只看我符合条件可报的简章与岗位</span>
            </label>
          </div>

          <div className="exam-profile-controls">
            <label className="exam-profile-field">
              <span>最高学历</span>
              <select
                value={profile.education}
                onChange={(e) =>
                  updateProfile({ education: e.target.value as ExamUserProfile['education'] })
                }
              >
                <option value="全部">不限 / 全部学历</option>
                <option value="专科">专科（大专）</option>
                <option value="本科">大学本科</option>
                <option value="硕士研究生">硕士研究生</option>
                <option value="博士研究生">博士研究生</option>
              </select>
            </label>

            <label className="exam-profile-field is-wide">
              <span>所学专业关键词（支持填本硕多个专业）</span>
              <input
                type="text"
                placeholder="如：计算机 软件工程 法学 会计学 汉语言文学..."
                value={profile.majorQuery}
                onChange={(e) => updateProfile({ majorQuery: e.target.value })}
              />
            </label>

            <label className="exam-profile-field">
              <span>政治面貌</span>
              <select
                value={profile.politicalStatus}
                onChange={(e) =>
                  updateProfile({
                    politicalStatus: e.target.value as ExamUserProfile['politicalStatus'],
                  })
                }
              >
                <option value="不限">不限</option>
                <option value="中共党员">中共党员（含预备）</option>
                <option value="共青团员">共青团员</option>
                <option value="群众">群众</option>
              </select>
            </label>

            <label className="exam-profile-field">
              <span>应届毕业生身份</span>
              <select
                value={profile.gradIdentity}
                onChange={(e) =>
                  updateProfile({
                    gradIdentity: e.target.value as ExamUserProfile['gradIdentity'],
                  })
                }
              >
                <option value="不限">不限身份</option>
                <option value="当年应届">2026当年应届生</option>
                <option value="择业期应届">择业期内应届生</option>
                <option value="在职/社会人员">在职 / 社会人员</option>
              </select>
            </label>

            <label className="exam-profile-field">
              <span>户籍 / 生源地</span>
              <select
                value={profile.hukouCity}
                onChange={(e) => updateProfile({ hukouCity: e.target.value })}
              >
                <option value="全部">不限户籍</option>
                {SHANDONG_16_CITIES.map((c) => (
                  <option key={c} value={c}>
                    {c}市户籍/生源
                  </option>
                ))}
              </select>
            </label>

            {profileActive && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setProfile(DEFAULT_EXAM_PROFILE);
                  safeWriteJson(EXAM_PROFILE_STORAGE, DEFAULT_EXAM_PROFILE);
                }}
              >
                <RotateCcw size={13} /> 清空画像
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Sub-navigation Tabs */}
      <div className="exam-subnav-bar">
        <div className="exam-subnav-tabs" role="tablist" aria-label="考公考编视图切换">
          <button
            type="button"
            role="tab"
            aria-selected={filters.view === 'announcements'}
            className={`exam-tab-btn ${filters.view === 'announcements' ? 'is-active' : ''}`}
            onClick={() => updateFilters({ view: 'announcements' })}
          >
            <ShieldCheck size={16} />
            <span>招考简章流</span>
            <span className="exam-tab-count">{filteredExams.length}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={filters.view === 'positions'}
            className={`exam-tab-btn ${filters.view === 'positions' ? 'is-active' : ''}`}
            onClick={() => updateFilters({ view: 'positions' })}
          >
            <FileSpreadsheet size={16} />
            <span>跨简章选岗器（职位库）</span>
            <span className="exam-tab-count">{flattenedPositions.length}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={filters.view === 'saved'}
            className={`exam-tab-btn ${filters.view === 'saved' ? 'is-active' : ''}`}
            onClick={() => updateFilters({ view: 'saved' })}
          >
            <Bookmark size={16} />
            <span>我的收藏与候选岗</span>
            <span className="exam-tab-count">{savedCount}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={filters.view === 'tracker'}
            className={`exam-tab-btn ${filters.view === 'tracker' ? 'is-active' : ''}`}
            onClick={() => updateFilters({ view: 'tracker' })}
          >
            <Kanban size={16} />
            <span>报考进度看板</span>
            <span className="exam-tab-count">{trackedCount}</span>
          </button>
        </div>

        <button
          type="button"
          className="btn btn-secondary btn-sm exam-mobile-filter-btn"
          onClick={() => setMobileFilterOpen(!mobileFilterOpen)}
        >
          <Filter size={14} /> 筛选条件
        </button>
      </div>

      {error && (
        <div className="inline-alert is-danger" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadSnapshot()}>
            重试
          </button>
        </div>
      )}

      {/* Main 3-Column Grid */}
      <div className="page-grid exam-page-grid">
        {/* Left Filter Sidebar */}
        <aside className={`filters-panel exam-filters-panel ${mobileFilterOpen ? 'is-mobile-open' : ''}`} aria-label="考公考编筛选栏">
          <div className="filters-header">
            <h2>考公考编筛选</h2>
            <button type="button" className="text-btn" onClick={resetAllFilters}>
              重置筛选
            </button>
          </div>

          <div className="filter-group">
            <span className="filter-label">山东 16 地市 / 考区范围</span>
            <div className="city-pills">
              <button
                type="button"
                className={`chip ${filters.cities.includes('全部') ? 'is-active' : ''}`}
                onClick={() => toggleCity('全部')}
              >
                全部地区
              </button>
              {SHANDONG_16_CITIES.map((city) => (
                <button
                  key={city}
                  type="button"
                  className={`chip ${filters.cities.includes(city) ? 'is-active' : ''}`}
                  onClick={() => toggleCity(city)}
                >
                  {city}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <span className="filter-label">招考大类</span>
            <div className="chip-group">
              <button
                type="button"
                className={`chip ${filters.category === '全部' ? 'is-active' : ''}`}
                onClick={() => updateFilters({ category: '全部' })}
              >
                全部类别
              </button>
              {EXAM_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`chip ${filters.category === cat ? 'is-active' : ''}`}
                  onClick={() => updateFilters({ category: cat })}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <span className="filter-label">编制与管理性质</span>
            <div className="chip-group">
              <button
                type="button"
                className={`chip ${filters.bianzhi === '全部' ? 'is-active' : ''}`}
                onClick={() => updateFilters({ bianzhi: '全部' })}
              >
                全部编制
              </button>
              {BIANZHI_OPTIONS.map((bz) => (
                <button
                  key={bz}
                  type="button"
                  className={`chip ${filters.bianzhi === bz ? 'is-active' : ''}`}
                  onClick={() => updateFilters({ bianzhi: bz })}
                >
                  {bz}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <span className="filter-label">笔试 / 考试科目</span>
            <div className="chip-group">
              {SUBJECT_OPTIONS.map((subj) => (
                <button
                  key={subj}
                  type="button"
                  className={`chip ${filters.subject === subj ? 'is-active' : ''}`}
                  onClick={() => updateFilters({ subject: subj })}
                >
                  {subj === '全部' ? '全部科目' : subj}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <span className="filter-label">考务阶段</span>
            <div className="chip-group">
              {STAGE_OPTIONS.map((st) => (
                <button
                  key={st}
                  type="button"
                  className={`chip ${filters.stage === st ? 'is-active' : ''}`}
                  onClick={() => updateFilters({ stage: st })}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <span className="filter-label">公告性质</span>
            <div className="chip-group">
              {['全部', '仅看招考简章', '考务进展通知'].map((role) => (
                <button
                  key={role}
                  type="button"
                  className={`chip ${filters.noticeRole === role ? 'is-active' : ''}`}
                  onClick={() => updateFilters({ noticeRole: role })}
                >
                  {role}
                </button>
              ))}
            </div>
          </div>

          <div className="filter-group">
            <label className="exam-checkbox-row">
              <input
                type="checkbox"
                checked={filters.unlimitedMajorOnly}
                onChange={(e) => updateFilters({ unlimitedMajorOnly: e.target.checked })}
              />
              <span>仅看含「不限专业」岗位的招考</span>
            </label>
          </div>
        </aside>

        {/* Center Results Section */}
        <section className="results-col exam-results-col" aria-label="考公考编检索结果">
          {/* Search & Sort Toolbar */}
          <div className="search-box-wrap">
            <div className="search-row">
              <div className="search-field">
                <Search size={18} />
                <input
                  type="text"
                  aria-label="搜索招考简章、用人单位、岗位代码或专业"
                  placeholder="搜索招考简章、招录机关、岗位名称、专业（如：省属事业编、选调、教师、法学、计算机）"
                  value={filters.query}
                  onChange={(e) => updateFilters({ query: e.target.value })}
                />
                {filters.query && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="清空搜索"
                    onClick={() => updateFilters({ query: '' })}
                  >
                    <X size={15} />
                  </button>
                )}
              </div>

              <select
                className="exam-sort-select"
                aria-label="排序方式"
                value={filters.sort}
                onChange={(e) => updateFilters({ sort: e.target.value as ExamFilters['sort'] })}
              >
                <option value="smart">智能排序（正在报名优先）</option>
                <option value="published">按发布日期最新</option>
                <option value="reg_end">按报名截止最近</option>
                <option value="headcount">按招录人数最多</option>
              </select>
            </div>

            <div className="search-hints">
              <span>热门检索</span>
              {['事业单位', '选调', '公务员', '教师', '医院', '控制总量', '文职', '三支一扶', '人才引进'].map(
                (kw) => (
                  <button
                    key={kw}
                    type="button"
                    onClick={() => updateFilters({ query: kw })}
                  >
                    {kw}
                  </button>
                ),
              )}
            </div>
          </div>

          {/* View 1 & 3: Announcements / Saved View */}
          {(filters.view === 'announcements' || filters.view === 'saved') && (
            <>
              <div className="results-toolbar">
                <span className="results-count">
                  共找到 <strong>{filteredExams.length}</strong> 条招考公告
                  {profile.onlyMatchProfile ? '（已开启个人报考画像过滤）' : ''}
                </span>
                <div className="exam-view-switch-inline">
                  <button
                    type="button"
                    className="text-btn"
                    onClick={() => updateFilters({ view: 'positions' })}
                  >
                    切换到「跨简章职位表选岗器 ({flattenedPositions.length} 岗)」→
                  </button>
                </div>
              </div>

              {loading && !snapshot ? (
                <div className="empty-state">正在加载考公考编招考数据…</div>
              ) : pagedExams.length === 0 ? (
                <div className="empty-state">
                  <p>没有匹配的招考简章。</p>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={resetAllFilters}>
                    清空筛选条件
                  </button>
                </div>
              ) : (
                <div className="job-list exam-card-list">
                  {pagedExams.map((exam) => (
                    <ExamCard
                      key={exam.id}
                      exam={exam}
                      profile={profile}
                      personal={personal[exam.id]}
                      onSelect={(item) => setSelectedExam(item)}
                      onToggleSave={toggleSaveExam}
                      onChangeStatus={changeTrackStatus}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {/* View 2: Cross-Announcement Position Selector (跨简章选岗器) */}
          {filters.view === 'positions' && (
            <div className="exam-selector-panel">
              <div className="results-toolbar">
                <span className="results-count">
                  跨简章职位库检索：共匹配 <strong>{flattenedPositions.length}</strong> 个具体招考岗位行
                </span>
                <span className="text-muted text-xs">
                  点击任意岗位可打开对应招考简章核对报名时间与原表附件
                </span>
              </div>

              <div className="exam-positions-table-wrap">
                <table className="exam-positions-table">
                  <thead>
                    <tr>
                      <th>地区 / 招考简章</th>
                      <th>招聘单位 / 主管部门</th>
                      <th>岗位名称 & 代码</th>
                      <th>编制 / 人数</th>
                      <th>学历 / 专业要求</th>
                      <th>政治面貌 / 应届 / 其他</th>
                      <th>核验 & 操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedPositions.map((row) => {
                      const rec = personal[row.exam.id];
                      const isCand = rec?.savedPositionIds?.includes(row.row_id);
                      return (
                        <tr
                          key={row.row_id}
                          className={row.eligibility.matched && profileActive ? 'is-eligible' : ''}
                        >
                          <td>
                            <span className="exam-badge is-city">
                              <MapPin size={11} /> {row.city || row.exam.cities[0] || row.exam.province}
                            </span>
                            <button
                              type="button"
                              className="exam-link-title"
                              onClick={() => setSelectedExam(row.exam)}
                            >
                              {row.exam.title}
                            </button>
                          </td>
                          <td>
                            <strong>{row.employer}</strong>
                            {row.department && row.department !== row.employer && (
                              <div className="text-muted text-xs">{row.department}</div>
                            )}
                          </td>
                          <td>
                            <strong>{row.position_name}</strong>
                            {row.position_code && (
                              <div className="exam-code-tag">代码：{row.position_code}</div>
                            )}
                          </td>
                          <td>
                            <div>{row.bianzhi}</div>
                            <strong className="exam-hc-badge">招 {row.recruit_count} 人</strong>
                          </td>
                          <td className="exam-major-cell">
                            <div><strong>{row.education}</strong></div>
                            <div>{row.major_raw}</div>
                          </td>
                          <td>
                            <div className="text-xs">政治面貌：{row.political_status}</div>
                            <div className="text-xs">范围：{row.fresh_grad_rule}</div>
                            {row.other_conditions && (
                              <div className="text-muted text-xs">{row.other_conditions}</div>
                            )}
                          </td>
                          <td>
                            {row.eligibility.matched ? (
                              <span className="elig-badge is-ok">
                                <CheckCircle2 size={12} /> 可报考
                              </span>
                            ) : (
                              <span className="elig-badge is-conflict">
                                {row.eligibility.conflicts[0]}
                              </span>
                            )}
                            <div className="exam-pos-row-actions">
                              <button
                                type="button"
                                className={`btn btn-sm ${isCand ? 'btn-primary' : 'btn-secondary'}`}
                                onClick={() => {
                                  const prevIds = rec?.savedPositionIds || [];
                                  const nextIds = isCand
                                    ? prevIds.filter((id) => id !== row.row_id)
                                    : [...prevIds, row.row_id];
                                  updatePersonalRecord(row.exam.id, {
                                    saved: true,
                                    savedPositionIds: nextIds,
                                    status:
                                      !rec?.status || rec.status === 'none'
                                        ? 'comparing'
                                        : rec.status,
                                  });
                                  setNotice(isCand ? '已移出候选岗位' : `已加入候选对比：${row.position_name}`);
                                }}
                              >
                                {isCand ? '★ 已候选' : '☆ 候选'}
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={() => setSelectedExam(row.exam)}
                              >
                                详情
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {pagedPositions.length === 0 && (
                  <div className="empty-state">
                    没有符合当前筛选条件的岗位表行，请尝试放宽筛选或搜索词。
                  </div>
                )}
              </div>
            </div>
          )}

          {/* View 4: 7-Stage Exam Application Tracker Kanban */}
          {filters.view === 'tracker' && (
            <div className="exam-kanban-wrap">
              <div className="results-toolbar">
                <span className="results-count">
                  考公考编全周期跟进看板（已跟进 <strong>{trackedCount}</strong> 项招考）
                </span>
                <span className="text-muted text-xs">
                  重点盯防「初审通过待缴费」与「准考证打印」，避免错过缴费确认导致报名作废
                </span>
              </div>

              <div className="exam-kanban-grid">
                {EXAM_TRACK_STAGES.map((stage) => {
                  const stageExams = allExams.filter(
                    (ex) => personal[ex.id]?.status === stage.key,
                  );
                  return (
                    <div key={stage.key} className="exam-kanban-col">
                      <div className="exam-kanban-col-head">
                        <strong>{stage.label}</strong>
                        <span className="exam-tab-count">{stage.key === 'audited' && stageExams.length > 0 ? `⚠️ ${stageExams.length}` : stageExams.length}</span>
                      </div>
                      <p className="exam-kanban-hint">{stage.hint}</p>
                      <div className="exam-kanban-cards">
                        {stageExams.map((ex) => {
                          const rec = personal[ex.id];
                          return (
                            <button
                              key={ex.id}
                              type="button"
                              className="exam-kanban-card"
                              onClick={() => setSelectedExam(ex)}
                            >
                              <div className="exam-kanban-card-top">
                                <span className="exam-badge is-category">{ex.exam_category}</span>
                                <span className="text-xs text-muted">{ex.cities[0] || ex.province}</span>
                              </div>
                              <h4>{ex.title}</h4>
                              {rec?.targetPositionCode && (
                                <div className="exam-kanban-target">
                                  <Target size={12} /> {rec.targetPositionCode}
                                </div>
                              )}
                              {rec?.regNumber && (
                                <div className="text-xs text-muted">序号/准考证：{rec.regNumber}</div>
                              )}
                              {rec?.writtenScore && (
                                <div className="text-xs text-muted">成绩：{rec.writtenScore}</div>
                              )}
                              <div className="exam-kanban-dates">
                                {ex.schedule.reg_end && <span>报名截止：{ex.schedule.reg_end}</span>}
                                {ex.schedule.payment_end && (
                                  <span className="is-warn">缴费截止：{ex.schedule.payment_end}</span>
                                )}
                                {ex.schedule.written_exam_date && (
                                  <span>笔试：{ex.schedule.written_exam_date}</span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                        {stageExams.length === 0 && (
                          <div className="exam-kanban-empty">暂无记录</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Pagination */}
          {filters.view !== 'tracker' && totalPages > 1 && (
            <div className="pager">
              <span className="pager-range">
                第 {page} / {totalPages} 页
              </span>
              <div className="pager-nav">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft size={14} /> 上一页
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  下一页 <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </section>

        {/* Right Exam Calendar & Reminders Rail */}
        <aside className="action-rail exam-agenda-rail" aria-label="考务关键节点日历">
          <div className="rail-card">
            <div className="rail-card-head">
              <div>
                <h3>
                  <Calendar size={16} style={{ display: 'inline', marginRight: 6 }} />
                  考务关键时间轴
                </h3>
                <p className="text-muted text-xs">报名截止、缴费确认与笔试日程</p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={exportExamCalendarIcs}
                title="导出考务日历到手机/电脑日历"
              >
                <Download size={13} /> 导出日历
              </button>
            </div>

            <div className="exam-milestone-list">
              {calendarMilestones.map((item, idx) => (
                <button
                  key={`${item.exam.id}-${item.type}-${idx}`}
                  type="button"
                  className={`exam-milestone-item is-${item.tone}`}
                  onClick={() => setSelectedExam(item.exam)}
                >
                  <div className="milestone-top">
                    <span className={`milestone-tag is-${item.tone}`}>{item.type}</span>
                    <strong className="milestone-date">
                      <Clock3 size={12} /> {item.date}
                    </strong>
                  </div>
                  <p className="milestone-title">{item.exam.title}</p>
                  <span className="milestone-meta">
                    {item.exam.cities[0] || item.exam.province} · {item.exam.exam_category} · 招{' '}
                    {item.exam.total_headcount} 人
                  </span>
                </button>
              ))}
              {calendarMilestones.length === 0 && (
                <p className="text-muted text-xs">暂无近期考务时间节点</p>
              )}
            </div>
          </div>

          <div className="rail-card">
            <h3>考公考编避坑提醒</h3>
            <ul className="exam-tips-list">
              <li>
                <strong>严格区分「事业编」与「控制总量」</strong>：山东省属及各地市高校、医院多采用「人员控制总量备案制」，在工资福利、职称评聘上与事业编一致，卡片均已明确标注。
              </li>
              <li>
                <strong>切勿漏掉「网上缴费确认」</strong>：初审通过不代表报名成功！每年均有大量考生通过初审后忘记在截止前缴费而痛失考试资格。
              </li>
              <li>
                <strong>应届身份界定</strong>：请仔细核对简章中是否包含「择业期内未落实工作单位的高校毕业生」或仅限「当年应届毕业生」。
              </li>
            </ul>
          </div>
        </aside>
      </div>

      {/* Exam Detail Drawer */}
      <ExamDetailDrawer
        exam={selectedExam}
        exams={filteredExams}
        profile={profile}
        personal={selectedExam ? personal[selectedExam.id] : undefined}
        onClose={() => setSelectedExam(null)}
        onSelectExam={(ex) => setSelectedExam(ex)}
        onToggleSave={toggleSaveExam}
        onUpdatePersonal={updatePersonalRecord}
        onNotify={(msg) => setNotice(msg)}
      />

      {/* Official Sources Modal */}
      {sourceModalOpen && (
        <div className="drawer-backdrop">
          <button
            type="button"
            className="drawer-backdrop-close"
            aria-label="关闭渠道列表弹窗"
            onClick={() => setSourceModalOpen(false)}
          />
          <aside
            className="drawer"
            style={{ maxWidth: 680 }}
            aria-label="考公考编官方渠道列表"
          >
            <header className="drawer-head">
              <div>
                <h2>考公考编官方信息渠道矩阵</h2>
                <p className="drawer-meta">
                  覆盖国家统考、山东省直、山东 16 地市人社局及高校招考专栏
                </p>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="关闭渠道列表"
                onClick={() => setSourceModalOpen(false)}
              >
                <X size={20} />
              </button>
            </header>
            <div className="drawer-body">
              <div className="exam-sources-grid">
                {(snapshot?.sources || []).map((src) => (
                  <div key={src.id} className="exam-source-item">
                    <div>
                      <strong>{src.name}</strong>
                      <div className="text-muted text-xs">
                        {src.level || '官方招考源'} · {src.city || '山东 / 全国'} · 收录 {src.count ?? 0} 条
                      </div>
                    </div>
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-secondary btn-sm"
                    >
                      官网 <ExternalLink size={12} />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
