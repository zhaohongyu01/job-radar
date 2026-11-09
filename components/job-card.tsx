import { memo, useState, useMemo, useId } from 'react';
import type { ReactNode, MouseEvent } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  Bookmark,
  Briefcase,
  Check,
  Clock3,
  EyeOff,
  GraduationCap,
  Mail,
  MapPin,
  MoreHorizontal,
  Share2,
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  externalUrl,
  sdeiPositionListUrl,
  getDeadlineCountdown,
  getLifecycleStage,
  cardChangeAlert,
  isExpired,
  publicationText,
  locationMatch,
  locationSummary,
  personalFor,
  selectedWorkCities,
  formatCompanyDisplay,
  effectiveJobTypes,
  formatEducationDisplay,
  cardJobTitle,
  chinaDayStart,
  duplicateSourceNames,
} from '@/lib/jobs';
import type { Job, Personal, PersonalRecord, Filters } from '@/lib/jobs';
import { HighlightText } from '@/components/highlight-text';
import { TalkEvents } from '@/components/talk-events';
import { assessOpportunityValidity } from '@/lib/opportunity-validity';
import { positionMatches } from '@/lib/eligibility';
import { report } from '@/lib/rum';
import { extractSalary } from '@/lib/salary-display';
import { EmployerEntry } from '@/components/employer-workspace';
import { APPLICATION_STAGES } from '@/lib/personal-records';
import { cardSummaryFor } from '@/lib/card-summary';

export { extractSalary } from '@/lib/salary-display';

export function cleanExcerpt(excerpt: string | null | undefined): string {
  if (!excerpt) return '';
  return excerpt.replace(/^[\s*•·-]+/, '').trim();
}

export function formatDate(value: string | null | undefined, time = false) {
  if (!value) return '尚无成功记录';
  return new Date(
    value.length === 10 ? value + 'T00:00:00+08:00' : value,
  ).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export function OutLink({
  url,
  children,
  primary = false,
  onOpen,
  className,
}: {
  url: string | null | undefined;
  children: ReactNode;
  primary?: boolean;
  onOpen?: () => void;
  /** Overrides the legacy primary-link / quiet-link classes. */
  className?: string;
}) {
  const href = externalUrl(url);
  return href ? (
    <a
      href={href}
      onClick={onOpen}
      target="_blank"
      rel="noopener noreferrer"
      className={className ?? (primary ? 'primary-link' : 'quiet-link')}
    >
      {children}
      <ArrowUpRight size={15} />
    </a>
  ) : null;
}

/** Stable, purely decorative tone so the same employer is recognisable while scanning. */
function monogramTone(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return String(hash % 6);
}

export interface JobCardProps {
  job: Job;
  filters: Filters;
  record?: PersonalRecord;
  personal?: Personal;
  ready: boolean;
  now: number;
  since: string | null;
  density?: 'standard' | 'compact';
  onDetail: (job: Job) => void;
  onRead: (job: Job) => void;
  onReadChange: (job: Job, read: boolean) => void;
  onToggle: (job: Job, key: 'saved' | 'applied' | 'hidden') => void;
  onStageChange?: (job: Job, stage: NonNullable<Filters['applicationStage']>) => void;
  onCopy: (job: Job) => void;
}

function JobCardInner({
  job,
  filters,
  record,
  personal,
  ready,
  now,
  since,
  density = 'standard',
  onDetail,
  onRead,
  onReadChange,
  onToggle,
  onStageChange,
  onCopy,
}: JobCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const workCities = selectedWorkCities(filters);
  const hasCityFilter = workCities.length > 0;
  const locationScopes = workCities.map((city) => locationMatch(job, city));
  const matchedCityLabel = workCities.filter((_, index) => locationScopes[index] === 'exact').join(' / ');
  const possibleCityLabel = workCities.filter((_, index) => locationScopes[index] === 'possible').join(' / ');
  const talkCityLabel = [
    ...new Set(
      job.talk_events
        ?.filter(
          (event) =>
            workCities.includes(event.city || '') &&
            event.status !== 'cancelled' &&
            Date.parse(`${event.date}T${event.end_time || '23:59'}:00+08:00`) >= now,
        )
        .map((event) => event.city),
    ),
  ].join(' / ');
  const location =
    !workCities.length || locationScopes.includes('exact')
      ? 'exact'
      : locationScopes.includes('possible')
        ? 'possible'
        : 'unknown';
  const hasSelectedCityTalk = Boolean(
    filters.includeRelatedTalks &&
      job.talk_events?.some(
        (event) =>
          workCities.includes(event.city || '') &&
          event.status !== 'cancelled' &&
          Date.parse(`${event.date}T${event.end_time || '23:59'}:00+08:00`) >= now,
      ),
  );

  const personalRecord = useMemo(
    () =>
      record ??
      (personal
        ? personalFor(job, personal)
        : { saved: false, applied: false, hidden: false }),
    [record, personal, job],
  );
  const saved = Boolean(personalRecord.saved);
  const applied = Boolean(personalRecord.applied);
  const expired = isExpired(job, now);
  const unread = personalRecord.readAt
    ? Date.parse(job.updated_at) > Date.parse(personalRecord.readAt)
    : true;
  const countdown = getDeadlineCountdown(job.deadline, now);
  const { cleanTitle, salary } = extractSalary(job);
  const summary = cardSummaryFor(job);
  const excerptText = summary.text;
  const summaryId = useId();
  const summaryLabel = { company: '单位介绍', responsibilities: '岗位职责', notice: '招聘说明' }[summary.kind];
  const stageInfo = getLifecycleStage(job, now);
  const changeAlert = cardChangeAlert(job, now);
  const { displayCompany, monogram } = formatCompanyDisplay(job.company, cleanTitle, job.source_id);
  const displayTitle = cardJobTitle(cleanTitle, job.company, displayCompany);
  const displayTypes = effectiveJobTypes(job);
  const displayEducation = formatEducationDisplay(job.education, '学历待核实');
  const isNew = !!since && Date.parse(job.first_seen_at) > Date.parse(since);
  const showStage = !['accepting', 'expired', 'expiring_soon'].includes(stageInfo.stage);
  const validity = assessOpportunityValidity(job, now);
  const showValidityChip =
    job.kind !== '宣讲会' &&
    Boolean(filters.validity && filters.validity !== 'all' && validity.status !== 'unconfirmed');
  const dupSourceNames = useMemo(() => duplicateSourceNames(job), [job]);

  const deadlineState = expired
    ? 'is-closed'
    : countdown?.urgency === 'urgent'
      ? 'is-urgent'
      : countdown?.urgency === 'warning'
        ? 'is-warning'
        : '';

  const matchingPositions = useMemo(
    () =>
      (job.position_matches || job.positions || []).filter((position) =>
        positionMatches(position, {
          cities: selectedWorkCities(filters),
          education: filters.education,
          major: filters.major || '',
          year: filters.type === '校招' ? filters.year : '全部',
          includeUnknown: filters.includeUncertain,
        }),
      ),
    [job.position_matches, job.positions, filters],
  );

  const activePositionPills = useMemo(() => {
    if (!filters.query.trim() && !(filters.major || '').trim()) return [];
    return [...new Set(matchingPositions.map((position) => position.name).filter(Boolean))].slice(0, 3);
  }, [filters.query, filters.major, matchingPositions]);

  const directEmail = job.emails?.[0];
  const [copiedEmail, setCopiedEmail] = useState(false);
  const handleCopyEmail = (e: MouseEvent) => {
    e.stopPropagation();
    if (directEmail) {
      void navigator.clipboard.writeText(directEmail).then(() => {
        setCopiedEmail(true);
        setTimeout(() => setCopiedEmail(false), 2000);
      });
    }
  };

  const isCompact = density === 'compact';
  const currentStageKey = personalRecord.application_stage || (applied ? 'applied' : 'planned');
  const showAppliedStageBadge = Boolean(
    applied || (personalRecord.application_stage && personalRecord.application_stage !== 'planned'),
  );

  const primaryUnitBadge =
    job.sectors[0] && job.sectors[0] !== '综合'
      ? { text: job.sectors[0], className: 'opp-sector' }
      : job.kind === '具体岗位'
        ? { text: '具体岗位', className: 'opp-tag-sm' }
        : null;

  const statusBadges: ReactNode[] = [];
  if (changeAlert) {
    statusBadges.push(
      <span
        key="change"
        className={`chip opp-alert${changeAlert.tone === 'warning' ? ' is-warning' : ''}`}
        title={changeAlert.text}
      >
        <AlertCircle size={12} />
        <span>{changeAlert.text}</span>
      </span>,
    );
  }
  if (showAppliedStageBadge && statusBadges.length < 2) {
    statusBadges.push(
      <span key="applied-stage" className="chip opp-stage-badge">
        {APPLICATION_STAGES[currentStageKey]}
      </span>,
    );
  }
  if (isNew && statusBadges.length < 2) {
    statusBadges.push(
      <span key="new" className="chip chip-brand">
        新收录
      </span>,
    );
  }
  if (showStage && statusBadges.length < 2) {
    statusBadges.push(
      <span key="lifecycle" className={`chip ${stageInfo.badgeClass}`}>
        {stageInfo.badge}
      </span>,
    );
  }
  if (showValidityChip && statusBadges.length < 2) {
    statusBadges.push(
      <span
        key="validity"
        className={`chip ${validity.status === 'confirmed_open' ? 'chip-brand' : ''}`}
        title={`${validity.reason}；最近核验：${validity.checkedAt || '未知'}`}
      >
        {validity.label}
      </span>,
    );
  }

  return (
    <article
      className={
        'opp-card' +
        (expired ? ' is-expired' : '') +
        (saved ? ' is-saved' : '') +
        (applied ? ' is-applied' : '') +
        (unread ? ' is-unread' : ' is-read') +
        (isCompact ? ' is-compact' : '') +
        (deadlineState ? ` ${deadlineState}` : '')
      }
    >
      <header className="opp-head">
        <div className="opp-logo" data-tone={monogramTone(monogram)} aria-hidden="true">
          {monogram}
        </div>
        <div className="opp-identity">
          <p className="opp-company">
            {unread && (
              <span className="opp-unread-dot" title="未读">
                <span className="sr-only">未读</span>
              </span>
            )}
            <span className="opp-company-name">
              <EmployerEntry job={job} name={displayCompany} />
            </span>
            {primaryUnitBadge && (
              <span className={primaryUnitBadge.className}>{primaryUnitBadge.text}</span>
            )}
          </p>
          <h2 className="opp-title">
            <button
              type="button"
              className="opp-card-title-btn"
              onClick={() => onDetail(job)}
            >
              <HighlightText text={displayTitle} query={filters.query} />
            </button>
          </h2>
        </div>
        <div className="opp-aside">
          <div className="opp-quick">
            <button
              type="button"
              className="icon-btn"
              aria-label={(saved ? '取消收藏：' : '收藏：') + job.title}
              title={saved ? '取消收藏' : '收藏'}
              aria-pressed={saved}
              disabled={!ready}
              onClick={() => onToggle(job, 'saved')}
            >
              <Bookmark size={17} fill={saved ? 'currentColor' : 'none'} />
            </button>
          </div>
          {salary && <span className="opp-salary">{salary}</span>}
        </div>
      </header>

      <div className="opp-body">
        <ul className="opp-facts">
          <li title={locationSummary(job)} className="opp-fact-location">
            <MapPin />
            {job.cities.length > 4
              ? `${job.cities.slice(0, 3).join(' / ')} 等 ${job.cities.length} 城市`
              : locationSummary(job)}
            {hasCityFilter && (
              <span className={'opp-loc-note' + (location === 'exact' ? ' is-exact' : '')}>
                {location === 'exact'
                  ? `工作地含${matchedCityLabel}`
                  : hasSelectedCityTalk
                    ? `宣讲地在${talkCityLabel}，工作地需另核对`
                    : location === 'possible'
                      ? `覆盖全省 / 全国，${possibleCityLabel}岗位待核实`
                      : '工作地点尚未明确'}
              </span>
            )}
          </li>
          <li>
            <GraduationCap />
            {displayEducation}
          </li>
          <li>
            <Briefcase />
            {displayTypes.join(' / ') || '招聘类型待确认'}
            {!!job.graduation_years.length && ` · ${job.graduation_years.join(' / ')} 届`}
            {!!job.position_count && ` · ${job.position_count} 岗`}
          </li>
          <li className={`opp-fact-deadline ${deadlineState}`}>
            <Clock3 />
            {job.deadline ? (
              <span>
                <strong>{expired ? '已截止' : countdown?.text || '公告截止'}</strong>
                <span className="opp-deadline-date"> · {formatDate(job.deadline, false)}</span>
              </span>
            ) : (
              <span>截止日期待核实</span>
            )}
          </li>
        </ul>

        {activePositionPills.length > 0 && (
          <div className="opp-positions">
            <span className="opp-positions-label">匹配岗位 {matchingPositions.length}</span>
            {activePositionPills.map((pos, idx) => (
              <span key={idx} className="opp-pos-pill">
                <HighlightText text={pos} query={filters.query} />
              </span>
            ))}
          </div>
        )}

        {job.company_conflict && <p className="opp-note">{job.company_note}</p>}

        {!isCompact && excerptText && (
          <div className="opp-summary">
            <p id={summaryId} className="opp-excerpt">
              <strong className="opp-summary-label">{summaryLabel}：</strong>
              <HighlightText text={excerptText} query={filters.query} />
            </p>
            {summary.source_url && (
              <div className="opp-summary-actions">
                <a
                  href={externalUrl(summary.source_url)}
                  target="_blank"
                  rel="noreferrer"
                  title="介绍摘自同名单位的另一份来源公告，未据此更新本岗位核验时间"
                >
                  介绍来源{summary.source_published_at ? ` · ${summary.source_published_at.slice(0, 10)}` : ''} ↗
                </a>
              </div>
            )}
          </div>
        )}

        {!isCompact && (job.kind === '宣讲会' || hasSelectedCityTalk) && (
          <TalkEvents
            job={job}
            city={workCities}
            now={now}
            limit={2}
            onOpen={() => onRead(job)}
          />
        )}
      </div>

      <footer className="opp-foot">
        <div className="opp-meta">
          <div className="opp-source">
            {statusBadges.length > 0 && <span className="opp-foot-badges">{statusBadges}</span>}
            {job.provenance === '第三方线索' && (
              <span className="opp-trust is-unverified">第三方线索 · 待核验</span>
            )}
            <span>
              {job.source_name}
              {dupSourceNames.length > 0 ? ` 等 ${dupSourceNames.length + 1} 源` : ''} ·{' '}
              {job.date_label || '发布'} {publicationText(job, now)}
            </span>
            {sdeiPositionListUrl(job.source_url) && (
              <span className="opp-fallback">
                ·{' '}
                <OutLink
                  className=""
                  url={sdeiPositionListUrl(job.source_url)}
                  onOpen={() => onRead(job)}
                >
                  来源岗位列表
                </OutLink>
              </span>
            )}
          </div>
        </div>

        <div className="opp-actions">
          <OutLink
            className="btn btn-primary btn-sm"
            url={job.application_url || job.source_url}
            onOpen={() => {
              report('event', 'click_apply');
              onRead(job);
            }}
          >
            {job.application_url
              ? '前往投递'
              : job.provenance === '第三方线索'
                ? '查看线索'
                : '查看原公告'}
          </OutLink>

          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger
              className="btn btn-ghost btn-sm opp-more-btn"
              aria-label={`更多操作：${job.title}`}
              title="更多操作"
            >
              <MoreHorizontal size={16} />
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={6} className="opp-more-menu">
              <button
                type="button"
                className="opp-more-item"
                disabled={!ready}
                aria-pressed={applied}
                onClick={() => {
                  onToggle(job, 'applied');
                  setMenuOpen(false);
                }}
              >
                <Check size={14} />
                <span>{applied ? '取消已投递（改回待投递）' : '标记已投递'}</span>
              </button>

              {onStageChange && (
                <fieldset className="opp-more-stages" aria-label={`快捷切换阶段：${job.title}`}>
                  <span className="opp-more-stages-label">修改跟进阶段</span>
                  <div className="opp-more-stages-grid">
                    {Object.entries(APPLICATION_STAGES).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        disabled={!ready}
                        className={`opp-more-stage-pill${
                          currentStageKey === key && (applied || personalRecord.application_stage)
                            ? ' is-active'
                            : ''
                        }`}
                        onClick={() => {
                          onStageChange(job, key as NonNullable<Filters['applicationStage']>);
                          setMenuOpen(false);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </fieldset>
              )}

              <button
                type="button"
                className="opp-more-item"
                aria-label={`复制岗位信息：${job.title}`}
                onClick={() => {
                  onCopy(job);
                  setMenuOpen(false);
                }}
              >
                <Share2 size={14} />
                <span>分享</span>
              </button>

              <button
                type="button"
                className="opp-more-item"
                disabled={!ready}
                aria-label={`${unread ? '标为已读' : '标为未读'}：${job.title}`}
                onClick={() => {
                  onReadChange(job, unread);
                  setMenuOpen(false);
                }}
              >
                <Clock3 size={14} />
                <span>{unread ? '标为已读' : '标为未读'}</span>
              </button>

              <button
                type="button"
                className="opp-more-item"
                disabled={!ready}
                onClick={() => {
                  onToggle(job, 'hidden');
                  setMenuOpen(false);
                }}
              >
                <EyeOff size={14} />
                <span>{personalRecord.hidden ? '恢复显示' : '不感兴趣'}</span>
              </button>

              {directEmail && (
                <button
                  type="button"
                  className="opp-more-item"
                  onClick={handleCopyEmail}
                >
                  <Mail size={14} />
                  <span>{copiedEmail ? '已复制投递邮箱' : `复制邮箱：${directEmail}`}</span>
                </button>
              )}

              {externalUrl(job.source_url) && (
                <a
                  href={externalUrl(job.source_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="opp-more-item"
                  onClick={() => {
                    onRead(job);
                    setMenuOpen(false);
                  }}
                >
                  <ArrowUpRight size={14} />
                  <span>查看原文来源</span>
                </a>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </footer>
    </article>
  );
}

function samePersonalRecord(a?: PersonalRecord, b?: PersonalRecord): boolean {
  if (a === b) return true;
  const sa = Boolean(a?.saved);
  const sb = Boolean(b?.saved);
  const aa = Boolean(a?.applied);
  const ab = Boolean(b?.applied);
  const ha = Boolean(a?.hidden);
  const hb = Boolean(b?.hidden);
  return (
    sa === sb &&
    aa === ab &&
    ha === hb &&
    (a?.readAt || '') === (b?.readAt || '') &&
    (a?.application_stage || '') === (b?.application_stage || '') &&
    (a?.personal_updated_at || '') === (b?.personal_updated_at || '')
  );
}

export const JobCard = memo(JobCardInner, (prev, next) => {
  const sameClock =
    prev.job.talk_events?.length || next.job.talk_events?.length
      ? prev.now === next.now
      : prev.now === next.now || chinaDayStart(prev.now) === chinaDayStart(next.now);
  return (
    prev.job === next.job &&
    prev.filters === next.filters &&
    prev.ready === next.ready &&
    sameClock &&
    prev.since === next.since &&
    prev.density === next.density &&
    prev.onDetail === next.onDetail &&
    prev.onRead === next.onRead &&
    prev.onReadChange === next.onReadChange &&
    prev.onToggle === next.onToggle &&
    prev.onStageChange === next.onStageChange &&
    prev.onCopy === next.onCopy &&
    prev.personal === next.personal &&
    samePersonalRecord(prev.record, next.record)
  );
});
