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
import { publicationText, generateJobTimeline, getLifecycleStage, isUnread, personalFor, displayJobTitle, sdeiPositionListUrl, locationSummary, formatCompanyDisplay, effectiveJobTypes, formatEducationDisplay, selectedWorkCities } from '@/lib/jobs';
import type { Filters, Job, Personal } from '@/lib/jobs';
import { buildGroupRoleItems } from '@/lib/grouping';
import type { GroupRoleItem } from '@/lib/grouping';
import { positionMatches } from '@/lib/eligibility';
import type { PersonalRecord } from '@/lib/jobs';
import { ApplicationTracker } from '@/components/application-tracker';
import { formatDate, OutLink } from '@/components/job-card';
import { HighlightText } from '@/components/highlight-text';
import { TalkEvents } from '@/components/talk-events';
import { EmployerEntry } from '@/components/employer-workspace';
import { parseAnnouncementSections } from '@/lib/card-summary';
import { report } from '@/lib/rum';

export { parseAnnouncementSections } from '@/lib/card-summary';

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
  const [moreOpen, setMoreOpen] = useState(false);
  const positionFilter = positionSearch.jobId === selected?.id ? positionSearch.value : '';
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

  const announcementSections = useMemo(
    () => parseAnnouncementSections(selected?.body),
    [selected?.body],
  );
  const headingAnchors = useMemo(
    () => announcementSections.filter((s) => Boolean(s.heading)),
    [announcementSections],
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

  // Highlight rows that satisfy the list's education/major/city/cohort filters,
  // only when that actually narrows the table.
  const matchingPositions = useMemo(() => {
    const list = selected?.positions ?? [];
    if (!filters || !list.length) return new Set<typeof list[number]>();
    const criteria = { cities: selectedWorkCities(filters), education: filters.education, major: filters.major || '',
      year: filters.type === '校招' ? filters.year : '全部', includeUnknown: filters.includeUncertain };
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

  return (
    <Sheet
      open={!!selected}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="detail-sheet">
        {selected && (
          <>
            <SheetHeader className="detail-header">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                {selected.company && (
                  <span className="opp-company-name font-semibold text-sm">
                    <EmployerEntry job={selected} name={formatCompanyDisplay(selected.company, selected.title, selected.source_id).displayCompany} />
                  </span>
                )}
                <span className="eyebrow">
                  {selected.kind} · {selected.source_name}
                </span>
                {!!selected.duplicate_sources?.length && (
                  <span className="channel-badge primary">
                    多渠道同步 · 共 {selected.duplicate_sources.length + 1} 个发布源
                  </span>
                )}
              </div>
              <SheetTitle className="text-xl leading-relaxed pr-6">
                {displayJobTitle(selected)}
              </SheetTitle>
              <SheetDescription>
                {selected.date_label || '发布'} {publicationText(selected)} · 最近读取{' '}
                {formatDate(selected.last_verified_at, true)}
              </SheetDescription>
            </SheetHeader>
            <div className="detail-sticky-bar">
              <div className="detail-actions">
                {/* Opening the drawer already marks it read; offer only the reverse. */}
                {!isUnread(selected, personal) && (
                  <Button
                    variant="outline"
                    disabled={!ready || detailLoading}
                    onClick={() => onReadChange(selected, false)}
                  >
                    标为未读
                  </Button>
                )}
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
                  {personalFor(selected, personal).applied ? '已投递' : '标记已投递'}
                </Button>
                <Button variant="outline" onClick={() => onCopy(selected)}>
                  <Share2 size={16} />
                  复制分享
                </Button>
                <Button variant="ghost" onClick={() => onToggle(selected, 'hidden')}>
                  {personalFor(selected, personal).hidden ? '恢复显示' : '不感兴趣'}
                </Button>
                <div className="detail-sticky-cta">
                  {selected.application_url && selected.source_url && selected.application_url !== selected.source_url && (
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
              <div className="detail-subbar">
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
                      <span>上一条</span>
                    </button>
                    <span className="detail-nav-index">{currentIndex + 1} / {totalCount}</span>
                    <button
                      type="button"
                      className="detail-nav-btn"
                      disabled={currentIndex >= totalCount - 1}
                      onClick={() => onNavigate(1)}
                      title="下一条岗位（快捷键 J 或 Alt+↓）"
                      aria-label="下一条岗位"
                    >
                      <span>下一条</span>
                      <ChevronRight size={14} />
                    </button>
                  </fieldset>
                )}
                <nav className="detail-jump-nav" aria-label="详情章节快速跳转">
                  {siblingRoleItems.length > 1 && (
                    <button type="button" className="detail-jump-pill" onClick={() => scrollToSection('drawer-sec-siblings')}>
                      同企岗位 ({siblingRoleItems.length})
                    </button>
                  )}
                  {(selected.positions ?? []).length > 0 && (
                    <button type="button" className="detail-jump-pill" onClick={() => scrollToSection('drawer-sec-positions')}>
                      岗位明细 ({selected.positions?.length})
                    </button>
                  )}
                  <button type="button" className="detail-jump-pill" onClick={() => scrollToSection('drawer-sec-body')}>
                    公告正文
                  </button>
                  <button type="button" className="detail-jump-pill" onClick={() => scrollToSection('drawer-sec-tracker')}>
                    投递跟进
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
                <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                  <PopoverTrigger
                    type="button"
                    className="icon-btn detail-more-btn"
                    aria-label="更多操作"
                    title="更多操作"
                  >
                    <MoreHorizontal size={16} />
                  </PopoverTrigger>
                  <PopoverContent align="end" sideOffset={6} className="opp-more-menu">
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
                    <button
                      type="button"
                      className="opp-more-item"
                      onClick={() => {
                        onCopy(selected);
                        setMoreOpen(false);
                      }}
                    >
                      <Share2 size={14} />
                      <span>复制分享</span>
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
              </div>
            </div>
            <div className="detail-body" ref={bodyRef}>
              <dl className="detail-facts">
                <div><dt>工作地点</dt><dd>{locationSummary(selected)}</dd></div>
                <div><dt>学历要求</dt><dd>{formatEducationDisplay(selected.education, '原公告未明确')}</dd></div>
                <div><dt>招聘对象</dt><dd>{effectiveJobTypes(selected).join(' / ') || '类型待核实'}{selected.graduation_years.length ? ` · ${selected.graduation_years.join(' / ')}届` : ''}</dd></div>
                <div>
                  <dt>报名截止</dt>
                  <dd>
                    {selected.deadline ? formatDate(selected.deadline, true) : '日期未明确，请核实'}
                    {selected.deadline_evidence && (
                      <small className="detail-fact-sub">{selected.deadline_evidence}</small>
                    )}
                  </dd>
                </div>
              </dl>
              {detailLoading && (
                <output className="inline-note">
                  正在读取完整公告，列表筛选仍可继续使用……
                </output>
              )}
              {detailError && (
                <div className="notice warning" role="alert">
                  {detailError}
                </div >
              )}
              {selected.classification_note && (
                <p className="inline-note">{selected.classification_note}</p>
              )}
              {selected.company_note && (
                <p className="inline-note">
                  {selected.company_note}
                  {selected.company_original
                    ? ` 来源原单位字段：${selected.company_original}`
                    : ''}
                </p>
              )}
              <TalkEvents job={selected} city={city} now={now} onOpen={() => onRead(selected)} />
              {(Boolean(sdeiPositionListUrl(selected.source_url)) || (selected.emails ?? []).length > 0) && (
                <div className="apply-extra-bar" id="drawer-sec-apply">
                  {sdeiPositionListUrl(selected.source_url) && (
                    <div className="apply-extra-row">
                      <span className="small muted">若原公告打不开，可进入高校岗位列表按单位或岗位查找：</span>
                      <OutLink url={sdeiPositionListUrl(selected.source_url)!} onOpen={() => onRead(selected)}>
                        打开来源岗位列表
                      </OutLink>
                    </div>
                  )}
                  {(selected.emails ?? []).map((email) => (
                    <div className="email-row" key={email}>
                      <span className="small muted">投递邮箱：</span>
                      <code>{email}</code>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(email)
                            .then(() =>
                              setNotice('报名邮箱已复制，请自行核对材料并发送。'),
                            )
                            .catch(() =>
                              setNotice('复制失败，请手动选择邮箱地址复制。'),
                            )
                        }
                      >
                        复制邮箱
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {siblingRoleItems.length > 1 && onSelectJob && (
                <div className="detail-siblings-panel" id="drawer-sec-siblings" aria-label="同企业其余在招岗位">
                  <div className="detail-siblings-head">
                    <span className="opp-group-directory-label">同企业本批次在招岗位</span>
                    <span className="detail-siblings-count">
                      {siblingIndex >= 0 ? `当前 ${siblingIndex + 1} / 共 ${siblingRoleItems.length} 个` : `共 ${siblingRoleItems.length} 个`}
                    </span>
                  </div>
                  <div className="opp-group-role-list">
                    {siblingRoleItems.slice(0, 12).map((roleItem, idx) => renderSiblingChip(roleItem, idx))}
                  </div>
                  {siblingRoleItems.length > 12 && (
                    <details className="opp-group-roles-more" open={siblingIndex >= 12 ? true : undefined}>
                      <summary>
                        <span className="when-closed">展开其余 {siblingRoleItems.length - 12} 个同企岗位</span>
                        <span className="when-open">收起其余同企岗位</span>
                        <ChevronDown size={12} />
                      </summary>
                      <div className="opp-group-role-list opp-group-role-list-extra">
                        {siblingRoleItems.slice(12).map((roleItem, idx) => renderSiblingChip(roleItem, idx + 12))}
                      </div>
                    </details>
                  )}
                </div>
              )}
              {/* Parsed Positions Panel */}
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
                        <span className="positions-match-note">高亮 {matchingPositions.size} 个符合当前筛选</span>
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
                              {pos.category && (
                                <span className="pos-cat-tag">{pos.category}</span>
                              )}
                              {pos.source_file && (
                                <span className="pos-source-tag">{pos.source_file}</span>
                              )}
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

              <h3>地点与资格</h3>
              <p>
                {selected.location_evidence.length
                  ? selected.location_evidence.join('；')
                  : '未提取到明确工作地点，请以岗位表为准。'}
              </p>
              <p className="inline-note">
                自动整理标签可能不完整；应届资格、专业和工作经验要求请核对原文。
              </p>
              <h3 id="drawer-sec-body">公告文字</h3>
              <div className="announcement-text">
                {!selected.body ? (
                  '完整公告尚未读取，请打开原公告核对。'
                ) : headingAnchors.length >= 2 ? (
                  <div className="announcement-sections">
                    {announcementSections.map((sec) => (
                      <section key={sec.id} id={sec.id} className="announcement-sec">
                        {sec.heading && <h4 className="announcement-sec-heading">{sec.heading}</h4>}
                        {sec.content && (
                          <div className="announcement-sec-body">
                            {highlightQuery ? <HighlightText text={sec.content} query={highlightQuery} /> : sec.content}
                          </div>
                        )}
                      </section>
                    ))}
                  </div>
                ) : (
                  selected.body
                )}
              </div>

              {((selected.attachments ?? []).length > 0 ||
                selected.qr_attachment) && (
                <>
                  <h3>附件与文档</h3>
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
                  <h3>公告中的其他链接</h3>
                  {(selected.links ?? []).map((a, i) => (
                    <div className="attachment" key={i}>
                      <OutLink url={a.url}>{a.title}</OutLink>
                    </div>
                  ))}
                </>
              )}

              <div id="drawer-sec-tracker">
                <ApplicationTracker key={selected.id} job={selected} record={personalFor(selected, personal)} onSave={onPersonalSave} />
              </div>
              {!!selected.duplicate_sources?.length && (
                <details className="drawer-fold drawer-fold-channels">
                  <summary>整合发布渠道（{(selected.duplicate_sources?.length ?? 0) + 1}）</summary>
                  {!!selected.duplicate_sources?.length && (
                    <div className="channels-panel">
                      <div className="channels-panel-header">
                        <h3>整合全网发布渠道 ({selected.duplicate_sources.length + 1})</h3>
                        <span className="channels-panel-badge">智能合并去重</span>
                      </div>
                      <p className="channels-panel-desc">
                        系统已自动合并该单位在多所高校/官方平台发布的同一招聘信息，方便多源核对与投递：
                      </p>
                      <div className="channels-list">
                        <div className="channel-card primary">
                          <div className="channel-card-top">
                            <span className="channel-tag primary">主来源</span>
                            <span className="channel-name">{selected.source_name || selected.source || selected.source_id}</span>
                            {selected.published_at && (
                              <span className="channel-date">{selected.published_at}</span>
                            )}
                          </div>
                          <div className="channel-card-title">{displayJobTitle(selected)}</div>
                          <div className="channel-card-actions">
                            <OutLink url={selected.source_url} onOpen={() => onRead(selected)}>
                              查看该渠道原公告
                            </OutLink>
                            {selected.application_url && selected.application_url !== selected.source_url && (
                              <OutLink primary url={selected.application_url} onOpen={() => onRead(selected)}>
                                直达投递入口
                              </OutLink>
                            )}
                          </div>
                        </div>
                        {selected.duplicate_sources.map((dup, idx) => (
                          <div className="channel-card" key={`${dup.url}-${idx}`}>
                            <div className="channel-card-top">
                              <span className="channel-tag">同步渠道</span>
                              <span className="channel-name">{dup.source_name || dup.source || dup.title}</span>
                              {dup.published_at && (
                                <span className="channel-date">{dup.published_at}</span>
                              )}
                            </div>
                            <div className="channel-card-title">{dup.title || dup.source_name || dup.source}</div>
                            <div className="channel-card-actions">
                              <OutLink url={dup.url} onOpen={() => onRead(selected)}>
                                查看该渠道原公告
                              </OutLink>
                              {dup.application_url && dup.application_url !== dup.url && (
                                <OutLink primary url={dup.application_url} onOpen={() => onRead(selected)}>
                                  直达投递入口
                                </OutLink>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </details>
              )}
              {timelineEvents.length > 0 && (
                <details className="drawer-fold drawer-fold-timeline">
                  <summary>招聘全流程与变更时间线</summary>
                  {timelineEvents.length > 0 && (
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
                  )}
                </details>
              )}
              <p className="source-note">
                首次收录 {formatDate(selected.first_seen_at, true)} · 内容版本{' '}
                {selected.revision}
                <br />
                最近内容变化 {formatDate(selected.updated_at, true)} · 按{' '}
                <kbd className="kbd">?</kbd> 查看快捷键
              </p>
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
                {personalFor(selected, personal).applied ? '已投递' : '已投递'}
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
