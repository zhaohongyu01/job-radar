'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Bookmark,
  Check,
  Share2,
  Briefcase,
  Search,
  FileSpreadsheet,
  Clock,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  MoreHorizontal,
  EyeOff,
  Eye,
  ExternalLink,
  MapPin,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import {
  publicationText,
  generateJobTimeline,
  getLifecycleStage,
  getDeadlineCountdown,
  isExpired,
  isUnread,
  personalFor,
  displayJobTitle,
  sdeiPositionListUrl,
  effectiveJobTypes,
  formatEducationDisplay,
  selectedWorkCities,
} from '@/lib/jobs';
import type { Filters, Job, Personal, PersonalRecord } from '@/lib/jobs';
import { buildGroupRoleItems } from '@/lib/grouping';
import type { GroupRoleItem } from '@/lib/grouping';
import { positionMatches } from '@/lib/eligibility';
import { ApplicationTracker } from '@/components/application-tracker';
import { formatDate, OutLink } from '@/components/job-card';
import { TalkEvents } from '@/components/talk-events';
import { EmployerEntry } from '@/components/employer-workspace';
import { StructuredJobProse } from '@/components/jobs/structured-job-prose';
import {
  buildLocationPresentation,
  formatDetailTitle,
  parseStructuredJobBody,
} from '@/lib/job-detail-format';
import { report } from '@/lib/rum';

export { parseAnnouncementSections } from '@/lib/card-summary';

const COLLAPSED_CITY_LIMIT = 6;

export function DetailDrawer({
  selected,
  city,
  now,
  personal,
  ready,
  detailLoading,
  detailError,
  onClose,
  onRead,
  onReadChange,
  onToggle,
  onCopy,
  setNotice,
  onPersonalSave,
  filters,
  currentIndex = -1,
  totalCount = 0,
  onNavigate,
  siblingJobs = [],
  onSelectJob,
}: {
  filters?: Filters;
  selected: Job | null;
  city: string | string[];
  now: number;
  personal: Personal;
  ready: boolean;
  detailLoading: boolean;
  detailError: string;
  onClose: () => void;
  onRead: (job: Job) => void;
  onReadChange: (job: Job, read: boolean) => void;
  onToggle: (job: Job, key: 'saved' | 'applied' | 'hidden') => void;
  onCopy: (job: Job) => void;
  setNotice: (msg: string) => void;
  onPersonalSave: (job: Job, patch: PersonalRecord, expected?: PersonalRecord) => boolean | Promise<boolean>;
  currentIndex?: number;
  totalCount?: number;
  onNavigate?: (delta: -1 | 1) => void;
  siblingJobs?: Job[];
  onSelectJob?: (job: Job) => void;
}) {
  const [positionSearch, setPositionSearch] = useState({ jobId: '', value: '' });
  const [expandedCityJobId, setExpandedCityJobId] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const positionFilter = positionSearch.jobId === selected?.id ? positionSearch.value : '';
  const citiesExpanded = Boolean(selected && expandedCityJobId === selected.id);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = 0;
    }
  }, [selected?.id]);

  useEffect(() => {
    if (!selected || !onNavigate || totalCount <= 1) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey) return;
      if (event.key === 'j' || event.key === 'J' || (event.altKey && event.key === 'ArrowDown')) {
        event.preventDefault();
        onNavigate(1);
      } else if (event.key === 'k' || event.key === 'K' || (event.altKey && event.key === 'ArrowUp')) {
        event.preventDefault();
        onNavigate(-1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected, onNavigate, totalCount]);

  const preferredCities = useMemo(() => {
    if (filters) return selectedWorkCities(filters);
    if (Array.isArray(city)) return city;
    return city && city !== '全部城市' ? [city] : [];
  }, [filters, city]);

  const titleInfo = useMemo(
    () => (selected ? formatDetailTitle(selected) : null),
    [selected],
  );

  const locationInfo = useMemo(
    () => (selected ? buildLocationPresentation(selected, preferredCities) : null),
    [selected, preferredCities],
  );

  const structuredBody = useMemo(
    () => (selected ? parseStructuredJobBody(selected) : null),
    [selected],
  );

  const headingAnchors = useMemo(
    () => (structuredBody?.sections ?? []).filter((s) => Boolean(s.heading)),
    [structuredBody],
  );

  const highlightQuery = useMemo(() => {
    const terms = [filters?.query, filters?.major, filters?.education]
      .map((t) => (t || '').trim())
      .filter(Boolean);
    return terms.join(' ');
  }, [filters?.query, filters?.major, filters?.education]);

  const scrollToSection = (elementId: string) => {
    const el = document.getElementById(elementId);
    if (el) {
      el.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      });
    }
  };

  const displayedPositions = useMemo(() => {
    const list = selected?.positions ?? [];
    if (!positionFilter.trim()) return list;
    const kw = positionFilter.trim().toLowerCase();
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(kw) ||
        (p.category ?? '').toLowerCase().includes(kw) ||
        (p.city ?? '').toLowerCase().includes(kw) ||
        (p.education ?? '').toLowerCase().includes(kw) ||
        (p.majors ?? []).some((m) => m.toLowerCase().includes(kw)),
    );
  }, [selected?.positions, positionFilter]);

  const matchingPositions = useMemo(() => {
    const list = selected?.positions ?? [];
    if (!filters || !list.length) return new Set<typeof list[number]>();
    const criteria = {
      cities: selectedWorkCities(filters),
      education: filters.education,
      major: filters.major || '',
      year: filters.type === '校招' ? filters.year : '全部',
      includeUnknown: filters.includeUncertain,
      includeUnlimitedMajor: Boolean(filters.includeUnlimitedMajor),
    };
    const matched = list.filter((position) => positionMatches(position, criteria));
    return new Set(matched.length < list.length ? matched : []);
  }, [selected?.positions, filters]);

  const timelineEvents = useMemo(
    () => (selected ? generateJobTimeline(selected) : []),
    [selected],
  );

  const currentStage = useMemo(
    () => (selected ? getLifecycleStage(selected, now) : null),
    [selected, now],
  );

  const siblingRoleItems = useMemo(
    () => (siblingJobs.length > 1 ? buildGroupRoleItems(siblingJobs) : []),
    [siblingJobs],
  );
  const siblingIndex = useMemo(
    () => (selected && siblingJobs.length > 1 ? siblingJobs.findIndex((j) => j.id === selected.id) : -1),
    [selected, siblingJobs],
  );

  const renderSiblingChip = (roleItem: GroupRoleItem, idx: number) => {
    const item = roleItem.job;
    const isActive = Boolean(selected && selected.id === item.id);
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
        key={item.id || `sibling-role-${idx}`}
        type="button"
        className={`opp-group-role-chip${isActive ? ' is-active' : ''}${stateClass}`}
        onClick={() => onSelectJob?.(item)}
        title={`${roleItem.rawRole}${roleItem.tooltipMeta ? ` · ${roleItem.tooltipMeta}` : ''}${itemApplied ? '（已投递）' : itemSaved ? '（已收藏）' : ''}（点击切换查看此岗位）`}
      >
        {itemApplied && (
          <>
            <span className="opp-group-role-status" aria-hidden="true">✓</span>
            <span className="sr-only">已投递</span>
          </>
        )}
        {!itemApplied && itemSaved && (
          <>
            <span className="opp-group-role-status" aria-hidden="true">★</span>
            <span className="sr-only">已收藏</span>
          </>
        )}
        <span className="opp-group-role-name">{roleItem.cleanRole}</span>
        {roleItem.suffix && <span className="opp-group-role-meta">· {roleItem.suffix}</span>}
      </button>
    );
  };

  const resolvedEducation = useMemo(() => {
    if (!selected) return { text: '未注明', muted: true };
    const formatted = formatEducationDisplay(selected.education, '');
    if (formatted) return { text: formatted, muted: false };
    if (structuredBody?.extractedEducation) {
      return { text: structuredBody.extractedEducation, muted: false };
    }
    return { text: '未注明', muted: true };
  }, [selected, structuredBody]);

  const resolvedDeadline = useMemo(() => {
    if (!selected) return { text: '未注明', badge: null as string | null, muted: true };
    if (selected.deadline) {
      const expired = isExpired(selected, now);
      const cd = getDeadlineCountdown(selected.deadline, now);
      return {
        text: formatDate(selected.deadline, false),
        badge: expired ? '已截止' : cd?.text || null,
        muted: false,
      };
    }
    if (structuredBody?.extractedDeadline) {
      return { text: structuredBody.extractedDeadline, badge: null, muted: false };
    }
    return { text: '未注明', badge: null, muted: true };
  }, [selected, structuredBody, now]);

  const mergedLocationSupplement = useMemo(() => {
    const parts = [
      locationInfo?.supplement,
      structuredBody?.extractedLocationSupplement,
    ].filter((v): v is string => Boolean(v));
    if (parts.length === 0) return null;
    if (parts.length === 2 && (parts[0].includes(parts[1]) || parts[1].includes(parts[0]))) {
      return parts[0].length >= parts[1].length ? parts[0] : parts[1];
    }
    return parts.join('；');
  }, [locationInfo, structuredBody]);

  const salaryMeta = structuredBody?.extraMeta.find((m) => m.label === '薪资参考')?.value || null;
  const displaySalary = titleInfo?.salary || (salaryMeta && salaryMeta !== '面议' ? salaryMeta : null);
  const filteredExtraMeta = useMemo(
    () =>
      (structuredBody?.extraMeta ?? []).filter(
        (m) => !(m.label === '薪资参考' && displaySalary && m.value === displaySalary),
      ),
    [structuredBody, displaySalary],
  );

  const visibleCities = useMemo(() => {
    const all = locationInfo?.chips ?? [];
    return citiesExpanded ? all : all.slice(0, COLLAPSED_CITY_LIMIT);
  }, [locationInfo, citiesExpanded]);

  const showJumpSubbar = Boolean(
    selected && ((selected.positions ?? []).length > 0 || headingAnchors.length >= 2),
  );

  return (
    <Sheet
      open={!!selected}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="detail-sheet">
        {selected && titleInfo && locationInfo && structuredBody && (
          <>
            <SheetHeader className="detail-header">
              <div className="detail-eyebrow-row">
                {selected.company && (
                  <span className="opp-company-name font-semibold text-sm">
                    <EmployerEntry job={selected} name={titleInfo.displayCompany} />
                  </span>
                )}
                <span className="eyebrow">
                  {selected.kind} · {selected.source_name} · {selected.date_label || '发布'}{' '}
                  {publicationText(selected)}
                </span>
                {!!selected.duplicate_sources?.length && (
                  <span className="channel-badge primary">
                    多渠道 ({selected.duplicate_sources.length + 1})
                  </span>
                )}
              </div>
              <div className="detail-title-row">
                <SheetTitle className="detail-main-title">
                  {titleInfo.title}
                </SheetTitle>
                {titleInfo.atsCode && (
                  <span className="detail-ats-code" title="原系统职位编号">
                    {titleInfo.atsCode}
                  </span>
                )}
                {displaySalary && <span className="opp-salary">{displaySalary}</span>}
              </div>
              <SheetDescription className="sr-only">
                {selected.date_label || '发布'} {publicationText(selected)}，最近核验{' '}
                {formatDate(selected.last_verified_at, true)}
              </SheetDescription>
            </SheetHeader>

            <div className="detail-sticky-bar">
              <div className="detail-actions">
                {onNavigate && currentIndex >= 0 && totalCount > 1 && (
                  <fieldset className="detail-nav-group" aria-label="上下条岗位切换">
                    <button
                      type="button"
                      className="detail-nav-btn"
                      disabled={currentIndex <= 0}
                      onClick={() => onNavigate(-1)}
                      title="上一条岗位（快捷键 K 或 Alt+↑）"
                      aria-label="上一条岗位"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <span className="detail-nav-index">
                      {currentIndex + 1} / {totalCount}
                    </span>
                    <button
                      type="button"
                      className="detail-nav-btn"
                      disabled={currentIndex >= totalCount - 1}
                      onClick={() => onNavigate(1)}
                      title="下一条岗位（快捷键 J 或 Alt+↓）"
                      aria-label="下一条岗位"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </fieldset>
                )}

                <Button
                  size="sm"
                  className="detail-desktop-only"
                  variant={personalFor(selected, personal).saved ? 'default' : 'outline'}
                  disabled={!ready}
                  onClick={() => onToggle(selected, 'saved')}
                >
                  <Bookmark size={14} />
                  {personalFor(selected, personal).saved ? '已收藏' : '收藏'}
                </Button>
                <Button
                  size="sm"
                  className="detail-desktop-only"
                  variant={personalFor(selected, personal).applied ? 'default' : 'outline'}
                  disabled={!ready}
                  onClick={() => onToggle(selected, 'applied')}
                >
                  <Check size={14} />
                  {personalFor(selected, personal).applied ? '已投递' : '标记已投递'}
                </Button>
                {!isUnread(selected, personal) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!ready || detailLoading}
                    onClick={() => onReadChange(selected, false)}
                  >
                    标为未读
                  </Button>
                )}

                <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                  <PopoverTrigger
                    type="button"
                    className="icon-btn detail-more-btn"
                    aria-label="更多操作"
                    title="复制分享、屏蔽或打开原公告"
                  >
                    <MoreHorizontal size={16} />
                  </PopoverTrigger>
                  <PopoverContent align="start" sideOffset={6} className="opp-more-menu">
                    <button
                      type="button"
                      className="opp-more-item"
                      onClick={() => {
                        onCopy(selected);
                        setMoreOpen(false);
                      }}
                    >
                      <Share2 size={14} />
                      <span>复制分享链接</span>
                    </button>
                    <button
                      type="button"
                      className="opp-more-item"
                      onClick={() => {
                        onToggle(selected, 'hidden');
                        setMoreOpen(false);
                      }}
                    >
                      <EyeOff size={14} />
                      <span>{personalFor(selected, personal).hidden ? '恢复显示' : '不感兴趣'}</span>
                    </button>
                    {!isUnread(selected, personal) && (
                      <button
                        type="button"
                        className="opp-more-item"
                        disabled={!ready || detailLoading}
                        onClick={() => {
                          onReadChange(selected, false);
                          setMoreOpen(false);
                        }}
                      >
                        <Eye size={14} />
                        <span>标为未读</span>
                      </button>
                    )}
                    {selected.application_url &&
                      selected.source_url &&
                      selected.application_url !== selected.source_url && (
                        <a
                          href={selected.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="opp-more-item"
                          onClick={() => {
                            onRead(selected);
                            setMoreOpen(false);
                          }}
                        >
                          <ExternalLink size={14} />
                          <span>查看原公告</span>
                        </a>
                      )}
                  </PopoverContent>
                </Popover>

                <div className="detail-sticky-cta detail-desktop-only">
                  {selected.application_url &&
                    selected.source_url &&
                    selected.application_url !== selected.source_url && (
                      <OutLink
                        url={selected.source_url}
                        onOpen={() => onRead(selected)}
                        className="quiet-link detail-sticky-source"
                      >
                        原公告
                      </OutLink>
                    )}
                  <OutLink
                    primary
                    className="primary-link detail-sticky-apply"
                    url={selected.application_url || selected.source_url}
                    onOpen={() => {
                      report('event', 'click_apply');
                      onRead(selected);
                    }}
                  >
                    {selected.application_url ? '前往投递' : '查看原公告'}
                  </OutLink>
                </div>
              </div>

              {showJumpSubbar && (
                <div className="detail-subbar">
                  <nav className="detail-jump-nav" aria-label="详情章节快速跳转">
                    {(selected.positions ?? []).length > 0 && (
                      <button
                        type="button"
                        className="detail-jump-pill"
                        onClick={() => scrollToSection('drawer-sec-positions')}
                      >
                        岗位明细 ({selected.positions?.length})
                      </button>
                    )}
                    <button
                      type="button"
                      className="detail-jump-pill"
                      onClick={() => scrollToSection('drawer-sec-body')}
                    >
                      公告正文
                    </button>
                    {headingAnchors.map((sec) => (
                      <button
                        key={sec.id}
                        type="button"
                        className="detail-jump-pill is-sub"
                        onClick={() => scrollToSection(sec.id)}
                      >
                        {sec.shortLabel || sec.heading}
                      </button>
                    ))}
                  </nav>
                </div>
              )}
            </div>

            <div className="detail-body" ref={bodyRef}>
              <div className="detail-grid">
                {/* Left Main Column: Structured JD, Position Table, Talks & Attachments */}
                <div className="detail-main-col">
                  {detailLoading && (
                    <output className="inline-note detail-main-banner">
                      正在读取完整公告，列表筛选仍可继续使用……
                    </output>
                  )}
                  {detailError && (
                    <div className="notice warning detail-main-banner" role="alert">
                      {detailError}
                    </div>
                  )}

                  <TalkEvents job={selected} city={city} now={now} onOpen={() => onRead(selected)} />

                  {(selected.positions ?? []).length > 0 && (
                    <div className="positions-panel" id="drawer-sec-positions" aria-label="岗位需求明细">
                      <div className="positions-header">
                        <div className="positions-title-box">
                          <Briefcase size={16} className="positions-icon" />
                          <span className="positions-title">岗位需求与资格要求明细</span>
                          <span className="positions-count-badge">
                            共 {selected.positions?.length} 个岗位
                          </span>
                          {matchingPositions.size > 0 && (
                            <span className="positions-match-note">
                              高亮 {matchingPositions.size} 个符合当前筛选
                            </span>
                          )}
                        </div>
                        {(selected.positions ?? []).length > 3 && (
                          <div className="positions-filter-box">
                            <Search size={13} className="positions-filter-icon" />
                            <input
                              type="text"
                              className="positions-filter-input"
                              placeholder="搜索职位或专业..."
                              value={positionFilter}
                              onChange={(e) => setPositionSearch({ jobId: selected.id, value: e.target.value })}
                              aria-label="筛选当前公告具体岗位"
                            />
                          </div>
                        )}
                      </div>

                      <div className="positions-table-wrap">
                        <table className="positions-table">
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>岗位名称</th>
                              <th>需求专业</th>
                              <th>学历</th>
                              <th>地点</th>
                              <th>人数</th>
                            </tr>
                          </thead>
                          <tbody>
                            {displayedPositions.map((pos, idx) => (
                              <tr key={idx} className={matchingPositions.has(pos) ? 'is-match' : undefined}>
                                <td className="pos-col-idx">{idx + 1}</td>
                                <td className="pos-col-name">
                                  <span className="pos-name">{pos.name}</span>
                                  {pos.category && <span className="pos-cat-tag">{pos.category}</span>}
                                  {pos.source_file && <span className="pos-source-tag">{pos.source_file}</span>}
                                </td>
                                <td className="pos-col-majors">
                                  {pos.majors && pos.majors.length > 0 ? (
                                    <div className="major-tags-row">
                                      {pos.majors.map((m, mIdx) => (
                                        <span key={mIdx} className="major-tag">
                                          {m}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-muted">不限 / 见原表</span>
                                  )}
                                </td>
                                <td className="pos-col-edu">
                                  {pos.education ? (
                                    <span className="edu-tag">{pos.education}</span>
                                  ) : (
                                    <span className="text-muted">-</span>
                                  )}
                                </td>
                                <td className="pos-col-city">
                                  {pos.city ? (
                                    <span className="city-tag">{pos.city}</span>
                                  ) : (
                                    <span className="text-muted">-</span>
                                  )}
                                </td>
                                <td className="pos-col-count">
                                  {pos.count ? (
                                    <span className="count-text">{pos.count}</span>
                                  ) : (
                                    <span className="text-muted">-</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  <section className="detail-prose-card" id="drawer-sec-body" aria-label="公告正文内容">
                    <div className="detail-card-head">
                      <h3 className="detail-card-title">公告文字</h3>
                      <OutLink
                        url={selected.source_url}
                        onOpen={() => onRead(selected)}
                        className="quiet-link"
                      >
                        原网页核对
                      </OutLink>
                    </div>
                    <div className="announcement-text">
                      <StructuredJobProse
                        sections={structuredBody.sections}
                        highlightQuery={highlightQuery}
                        fallbackMetaCount={filteredExtraMeta.length}
                      />
                    </div>
                  </section>

                  {((selected.attachments ?? []).length > 0 ||
                    selected.qr_attachment ||
                    (selected.links ?? []).length > 0) && (
                    <section className="detail-attachments-card" aria-label="附件与相关链接">
                      {((selected.attachments ?? []).length > 0 || selected.qr_attachment) && (
                        <>
                          <h3 className="detail-card-title">附件与文档</h3>
                          {(selected.attachments ?? []).map((a, i) => (
                            <div className="attachment" key={i}>
                              <OutLink url={a.url}>{a.title}</OutLink>
                              {a.parse_status === 'deferred' && (
                                <span className="text-muted">岗位表尚未解析完整，请查看原附件</span>
                              )}
                              {(() => {
                                const positions = selected.positions ?? [];
                                const hasBoundPositionSources = positions.some((p) => Boolean(p.source_url));
                                const isParsed = hasBoundPositionSources
                                  ? positions.some((p) => Boolean(p.source_url && a.url && p.source_url === a.url))
                                  : positions.some(
                                      (p) =>
                                        Boolean(
                                          p.source_file &&
                                            (a.title.includes(p.source_file) ||
                                              p.source_file.includes(a.title) ||
                                              (a.url && a.url.includes(p.source_file))),
                                        ),
                                    );
                                if (isParsed) {
                                  return (
                                    <span className="attachment-parsed-badge">
                                      <FileSpreadsheet size={11} />
                                      已解析岗位表
                                    </span>
                                  );
                                }
                                return null;
                              })()}
                            </div>
                          ))}
                          {selected.qr_attachment && (
                            <p className="inline-note">
                              公告含二维码或扫码说明，未自动解析其中内容，请打开原公告查看。
                            </p>
                          )}
                        </>
                      )}

                      {(selected.links ?? []).length > 0 && (
                        <>
                          <h3 className="detail-card-title">公告中的其他链接</h3>
                          {(selected.links ?? []).map((a, i) => (
                            <div className="attachment" key={i}>
                              <OutLink url={a.url}>{a.title}</OutLink>
                            </div>
                          ))}
                        </>
                      )}
                    </section>
                  )}
                </div>

                {/* Right Context Rail: Key Facts, Sibling Roles, Tracker & Provenance */}
                <aside className="detail-side-col" aria-label="岗位要素与个人跟进">
                  <section className="detail-meta-card" aria-label="核心要素">
                    <div className="detail-loc-block">
                      <div className="detail-loc-label">
                        <MapPin size={13} />
                        <span>工作地点</span>
                        {locationInfo.chips.length > 1 && (
                          <small className="detail-loc-count">{locationInfo.chips.length} 城</small>
                        )}
                      </div>
                      {locationInfo.chips.length > 0 ? (
                        <div className="detail-city-chips">
                          {visibleCities.map((c, idx) => (
                            <span
                              key={c}
                              className={`detail-city-chip${idx < locationInfo.prioritizedCount ? ' is-priority' : ''}`}
                            >
                              {c}
                            </span>
                          ))}
                          {locationInfo.chips.length > COLLAPSED_CITY_LIMIT && (
                            <button
                              type="button"
                              className="detail-city-more"
                              onClick={() =>
                                setExpandedCityJobId(citiesExpanded ? null : selected.id)
                              }
                            >
                              {citiesExpanded
                                ? '收起'
                                : `+${locationInfo.chips.length - COLLAPSED_CITY_LIMIT} 城`}
                            </button>
                          )}
                        </div>
                      ) : (
                        <p className="detail-loc-fallback">{locationInfo.fallbackText}</p>
                      )}
                      {locationInfo.chips.length > 0 && mergedLocationSupplement && (
                        <p className="detail-loc-supplement">{mergedLocationSupplement}</p>
                      )}
                    </div>

                    <dl className="detail-facts">
                      <div>
                        <dt>招聘对象</dt>
                        <dd>
                          {effectiveJobTypes(selected).join(' / ') || '类型待核实'}
                          {selected.graduation_years.length
                            ? ` · ${selected.graduation_years.join(' / ')}届`
                            : ''}
                        </dd>
                      </div>
                      <div>
                        <dt>学历要求</dt>
                        <dd className={resolvedEducation.muted ? 'is-muted' : undefined}>
                          {resolvedEducation.text}
                        </dd>
                      </div>
                      <div>
                        <dt>报名截止</dt>
                        <dd className={resolvedDeadline.muted ? 'is-muted' : undefined}>
                          <span>{resolvedDeadline.text}</span>
                          {resolvedDeadline.badge && (
                            <span className="detail-deadline-pill">{resolvedDeadline.badge}</span>
                          )}
                          {selected.deadline_evidence && (
                            <small className="detail-fact-sub">{selected.deadline_evidence}</small>
                          )}
                        </dd>
                      </div>
                      {filteredExtraMeta.map((meta) => (
                        <div key={`${meta.label}-${meta.value}`} className={meta.value.length > 10 ? 'is-wide' : undefined}>
                          <dt>{meta.label}</dt>
                          <dd>{meta.value}</dd>
                        </div>
                      ))}
                    </dl>

                    {(Boolean(sdeiPositionListUrl(selected.source_url)) ||
                      (selected.emails ?? []).length > 0) && (
                      <div className="apply-extra-bar" id="drawer-sec-apply">
                        {sdeiPositionListUrl(selected.source_url) && (
                          <div className="apply-extra-row">
                            <span className="small muted">原页打不开时可查高校列表：</span>
                            <OutLink url={sdeiPositionListUrl(selected.source_url)!} onOpen={() => onRead(selected)}>
                              来源岗位列表
                            </OutLink>
                          </div>
                        )}
                        {(selected.emails ?? []).map((email) => (
                          <div className="email-row" key={email}>
                            <code>{email}</code>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                void navigator.clipboard
                                  .writeText(email)
                                  .then(() => setNotice('报名邮箱已复制，请自行核对材料并发送。'))
                                  .catch(() => setNotice('复制失败，请手动选择邮箱地址复制。'))
                              }
                            >
                              复制邮箱
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {siblingRoleItems.length > 1 && onSelectJob && (
                    <section className="detail-siblings-panel" id="drawer-sec-siblings" aria-label="同企业其余在招岗位">
                      <div className="detail-siblings-head">
                        <span className="opp-group-directory-label">同企本批次岗位</span>
                        <span className="detail-siblings-count">
                          {siblingIndex >= 0
                            ? `${siblingIndex + 1} / ${siblingRoleItems.length}`
                            : `共 ${siblingRoleItems.length} 个`}
                        </span>
                      </div>
                      <div className="opp-group-role-list">
                        {siblingRoleItems.slice(0, 8).map((roleItem, idx) => renderSiblingChip(roleItem, idx))}
                      </div>
                      {siblingRoleItems.length > 8 && (
                        <details className="opp-group-roles-more" open={siblingIndex >= 8 ? true : undefined}>
                          <summary>
                            <span className="when-closed">展开其余 {siblingRoleItems.length - 8} 个岗位</span>
                            <span className="when-open">收起其余岗位</span>
                            <ChevronDown size={12} />
                          </summary>
                          <div className="opp-group-role-list opp-group-role-list-extra">
                            {siblingRoleItems.slice(8).map((roleItem, idx) => renderSiblingChip(roleItem, idx + 8))}
                          </div>
                        </details>
                      )}
                    </section>
                  )}

                  <div id="drawer-sec-tracker" className="detail-tracker-wrap">
                    <ApplicationTracker
                      key={selected.id}
                      job={selected}
                      record={personalFor(selected, personal)}
                      onSave={onPersonalSave}
                    />
                  </div>

                  {!!selected.duplicate_sources?.length && (
                    <details className="drawer-fold drawer-fold-channels">
                      <summary>整合发布渠道（{(selected.duplicate_sources?.length ?? 0) + 1}）</summary>
                      <div className="channels-panel">
                        <div className="channels-panel-header">
                          <h3>整合全网发布渠道 ({selected.duplicate_sources.length + 1})</h3>
                          <span className="channels-panel-badge">智能合并去重</span>
                        </div>
                        <p className="channels-panel-desc">
                          已合并该单位在多平台发布的同一招聘信息：
                        </p>
                        <div className="channels-list">
                          <div className="channel-card primary">
                            <div className="channel-card-top">
                              <span className="channel-tag primary">主来源</span>
                              <span className="channel-name">
                                {selected.source_name || selected.source || selected.source_id}
                              </span>
                              {selected.published_at && (
                                <span className="channel-date">{selected.published_at}</span>
                              )}
                            </div>
                            <div className="channel-card-title">{displayJobTitle(selected)}</div>
                            <div className="channel-card-actions">
                              <OutLink url={selected.source_url} onOpen={() => onRead(selected)}>
                                查看原公告
                              </OutLink>
                              {selected.application_url &&
                                selected.application_url !== selected.source_url && (
                                  <OutLink primary url={selected.application_url} onOpen={() => onRead(selected)}>
                                    直达投递
                                  </OutLink>
                                )}
                            </div>
                          </div>
                          {selected.duplicate_sources.map((dup, idx) => (
                            <div className="channel-card" key={`${dup.url}-${idx}`}>
                              <div className="channel-card-top">
                                <span className="channel-tag">同步渠道</span>
                                <span className="channel-name">{dup.source_name || dup.source || dup.title}</span>
                                {dup.published_at && <span className="channel-date">{dup.published_at}</span>}
                              </div>
                              <div className="channel-card-title">{dup.title || dup.source_name || dup.source}</div>
                              <div className="channel-card-actions">
                                <OutLink url={dup.url} onOpen={() => onRead(selected)}>
                                  查看原公告
                                </OutLink>
                                {dup.application_url && dup.application_url !== dup.url && (
                                  <OutLink primary url={dup.application_url} onOpen={() => onRead(selected)}>
                                    直达投递
                                  </OutLink>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </details>
                  )}

                  {timelineEvents.length > 0 && (
                    <details className="drawer-fold drawer-fold-timeline">
                      <summary>招聘全流程与变更时间线</summary>
                      <div className="drawer-timeline-section">
                        <div className="drawer-timeline-header">
                          <div className="timeline-header-title">
                            <Clock size={16} className="timeline-clock-icon" />
                            <h3>招聘全流程与变更时间线</h3>
                          </div>
                          {currentStage && (
                            <span className={`tag ${currentStage.badgeClass}`}>
                              {currentStage.badge}
                            </span>
                          )}
                        </div>
                        <div className="timeline-track">
                          {timelineEvents.map((evt, idx) => {
                            const isLast = idx === timelineEvents.length - 1;
                            const isCurrent = evt.date === '当前状态';
                            return (
                              <div
                                key={`${evt.date}-${evt.type}-${idx}`}
                                className={`timeline-item ${isCurrent ? 'current' : ''}`}
                              >
                                <div className="timeline-marker">
                                  <span className={`timeline-dot dot-${evt.type}`} />
                                  {!isLast && <span className="timeline-line" />}
                                </div>
                                <div className="timeline-content">
                                  <div className="timeline-top">
                                    <span className="timeline-title">{evt.title}</span>
                                    <span className="timeline-date">{evt.date}</span>
                                  </div>
                                  <p className="timeline-detail">{evt.detail}</p>
                                  {evt.source && (
                                    <span className="timeline-source">来源渠道：{evt.source}</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </details>
                  )}

                  <div className="source-note">
                    {structuredBody.sourceDisclaimer && (
                      <p className="detail-foot-note">{structuredBody.sourceDisclaimer}</p>
                    )}
                    {selected.company_note && (
                      <p className="detail-foot-note">
                        {selected.company_note}
                        {selected.company_original ? `（原字段：${selected.company_original}）` : ''}
                      </p>
                    )}
                    <p className="detail-foot-note">
                      自动提炼要素供快速筛选，应届资格与专业条件以原公告为准 · 最近核验{' '}
                      {formatDate(selected.last_verified_at, true)} · 版本 v{selected.revision} · 按{' '}
                      <kbd className="kbd">?</kbd> 查看快捷键
                    </p>
                  </div>
                </aside>
              </div>
            </div>

            <footer className="detail-mobile-bar" aria-label="详情底部操作栏">
              <Button
                variant={personalFor(selected, personal).saved ? 'default' : 'outline'}
                disabled={!ready}
                onClick={() => onToggle(selected, 'saved')}
              >
                <Bookmark size={16} />
                {personalFor(selected, personal).saved ? '已收藏' : '收藏'}
              </Button>
              <Button
                variant={personalFor(selected, personal).applied ? 'default' : 'outline'}
                disabled={!ready}
                onClick={() => onToggle(selected, 'applied')}
              >
                <Check size={16} />
                {personalFor(selected, personal).applied ? '已投递' : '标记已投'}
              </Button>
              <OutLink
                primary
                className="primary-link detail-mobile-apply"
                url={selected.application_url || selected.source_url}
                onOpen={() => {
                  report('event', 'click_apply');
                  onRead(selected);
                }}
              >
                {selected.application_url ? '前往投递' : '查看原公告'}
              </OutLink>
            </footer>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
