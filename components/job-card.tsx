import { useState, useMemo } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  Bookmark,
  Briefcase,
  Check,
  Clock3,
  GraduationCap,
  MapPin,
  Share2,
  Paperclip,
  Mail,
  Users,
} from 'lucide-react';
import {
  externalUrl,
  sdeiPositionListUrl,
  getDeadlineCountdown,
  getLifecycleStage,
  isExpired,
  publicationText,
  isUnread,
  locationMatch,
  locationSummary,
  personalFor,
  selectedWorkCities,
  formatCompanyDisplay,
  duplicateSourceNames,
} from '@/lib/jobs';
import type { Job, Personal, Filters } from '@/lib/jobs';
import { HighlightText } from '@/components/highlight-text';
import { TalkEvents } from '@/components/talk-events';
import { assessOpportunityValidity } from '@/lib/opportunity-validity';
import { positionMatches } from '@/lib/eligibility';
import { extractSalary } from '@/lib/salary-display';

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
  children: React.ReactNode;
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

export function JobCard({
  job,
  filters,
  personal,
  ready,
  now,
  since,
  onDetail,
  onRead,
  onReadChange,
  onToggle,
  onCopy,
}: {
  job: Job;
  filters: Filters;
  personal: Personal;
  ready: boolean;
  now: number;
  since: string | null;
  onDetail: (job: Job) => void;
  onRead: (job: Job) => void;
  onReadChange: (job: Job, read: boolean) => void;
  onToggle: (job: Job, key: 'saved' | 'applied' | 'hidden') => void;
  onCopy: (job: Job) => void;
}) {
  const workCities = selectedWorkCities(filters);
  const hasCityFilter = workCities.length > 0;
  const locationScopes = workCities.map((city) => locationMatch(job, city));
  const matchedCityLabel = workCities.filter((_, index) => locationScopes[index] === 'exact').join(' / ');
  const possibleCityLabel = workCities.filter((_, index) => locationScopes[index] === 'possible').join(' / ');
  const talkCityLabel = [...new Set(job.talk_events?.filter((event) => workCities.includes(event.city || '') && event.status !== 'cancelled' && Date.parse(`${event.date}T${event.end_time || '23:59'}:00+08:00`) >= now).map((event) => event.city))].join(' / ');
  const location = !workCities.length || locationScopes.includes('exact') ? 'exact' : locationScopes.includes('possible') ? 'possible' : 'unknown';
  const hasSelectedCityTalk =
    Boolean(filters.includeRelatedTalks && job.talk_events?.some((event) => workCities.includes(event.city || '') && event.status !== 'cancelled' && Date.parse(`${event.date}T${event.end_time || '23:59'}:00+08:00`) >= now));
  const saved = personalFor(job, personal).saved;
  const applied = personalFor(job, personal).applied;
  const expired = isExpired(job, now);
  const unread = isUnread(job, personal);
  const countdown = getDeadlineCountdown(job.deadline, now);
  const { cleanTitle, salary } = extractSalary(job);
  const excerptText = cleanExcerpt(job.excerpt);
  const stageInfo = getLifecycleStage(job, now);
  const changeAlert =
    (job.recent_change?.detail &&
    job.recent_change.detail !== '招聘公告正文或附件内容已同步最新变动'
      ? job.recent_change.detail
      : null) ||
    (stageInfo.stage === 'extended'
      ? '报名截止时间已延期（详见原公告）'
      : null) ||
    (stageInfo.stage === 'supplemental' ? '补录 / 追加招聘批次进行中' : null) ||
    (stageInfo.stage === 'selection' ? '发布考核选拔或录用进展通知' : null);
  const { displayCompany, monogram } = formatCompanyDisplay(job.company, cleanTitle, job.source_id);
  const isNew = !!since && Date.parse(job.first_seen_at) > Date.parse(since);
  const showStage = !['accepting', 'expired', 'expiring_soon'].includes(stageInfo.stage);
  const deadlineState = expired
    ? 'is-closed'
    : countdown?.urgency === 'urgent'
      ? 'is-urgent'
      : countdown?.urgency === 'warning'
        ? 'is-warning'
        : '';

  const matchingPositions = useMemo(() => (job.position_matches || job.positions || []).filter((position) => positionMatches(position, {
    cities: selectedWorkCities(filters), education: filters.education, major: filters.major || '',
    year: filters.type === '校招' ? filters.year : '全部', includeUnknown: filters.includeUncertain,
  })), [job.position_matches, job.positions, filters]);
  const displayPositions = useMemo(() => {
    if (matchingPositions.length) return [...new Set(matchingPositions.map((position) => position.name))].slice(0, 5);
    if (job.sample_positions?.length) return job.sample_positions.slice(0, 5);
    if (job.positions?.length) {
      const names = Array.from(new Set(job.positions.map((p) => p.name).filter(Boolean)));
      return names.slice(0, 5);
    }
    if (job.directions?.length && job.directions[0] !== '全部') {
      return job.directions.slice(0, 5);
    }
    return [];
  }, [job.sample_positions, job.positions, job.directions, matchingPositions]);

  const displayMajors = useMemo(() => {
    const set = new Set<string>();
    for (const pos of job.positions ?? []) {
      for (const m of pos.majors ?? []) {
        if (m && m.length <= 16 && !['不限', '无', '见原表', '相关专业'].includes(m)) {
          set.add(m);
        }
      }
    }
    return Array.from(set).slice(0, 6);
  }, [job.positions]);

  const hasJobTableAttachment = useMemo(() => {
    return (job.attachments ?? []).some(
      (a) => a.parse_status === 'parsed' || /岗位|职位|专业|需求|一览表|需求表/.test(a.title),
    );
  }, [job.attachments]);

  const directEmail = job.emails?.[0];
  const [copiedEmail, setCopiedEmail] = useState(false);
  const handleCopyEmail = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (directEmail) {
      void navigator.clipboard.writeText(directEmail).then(() => {
        setCopiedEmail(true);
        setTimeout(() => setCopiedEmail(false), 2000);
      });
    }
  };

  return (
    <article
      className={
        'opp-card' +
        (expired ? ' is-expired' : '') +
        (saved ? ' is-saved' : '')
      }
    >
      <header className="opp-head">
        <div className="opp-logo" data-tone={monogramTone(monogram)} aria-hidden="true">
          {monogram}
        </div>
        <div className="opp-identity">
          <p className="opp-company">
            {unread && <span className="opp-unread-dot" title="未读" />}
            <span className="opp-company-name">{displayCompany}</span>
            {job.sectors[0] && <span className="opp-sector">{job.sectors[0] === '综合' ? '单位性质未明确' : job.sectors[0]}</span>}
            {job.kind === '具体岗位' && <span className="opp-tag-sm">具体岗位</span>}
            {job.provenance === '第三方线索' && <span className="opp-sector">第三方线索</span>}
            {!!duplicateSourceNames(job).length && (
              <span className="opp-tag-sm" title={`已同步 ${duplicateSourceNames(job).length + 1} 个官方渠道`}>
                {duplicateSourceNames(job).length + 1} 渠道同步
              </span>
            )}
          </p>
          <h2 className="opp-title">
            <button onClick={() => onDetail(job)}>
              <HighlightText text={cleanTitle} query={filters.query} />
            </button>
          </h2>
        </div>
        <div className="opp-aside">
          <div className="opp-quick">
            <button
              className="icon-btn"
              aria-label={`复制岗位信息：${job.title}`}
              title="复制岗位信息"
              onClick={() => onCopy(job)}
            >
              <Share2 size={16} />
            </button>
            <button
              className="icon-btn"
              aria-label={(saved ? '取消收藏：' : '收藏：') + job.title}
              title={saved ? '取消收藏' : '收藏'}
              aria-pressed={!!saved}
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
          <li title={locationSummary(job)}>
            <MapPin />
            {job.cities.length > 4
              ? `${job.cities.slice(0, 3).join(' / ')} 等 ${job.cities.length} 城市`
              : locationSummary(job)}
          </li>
          <li>
            <GraduationCap />
            {job.education || '学历待核实'}
          </li>
          <li>
            <Briefcase />
            {job.types.join(' / ') || '招聘类型待确认'}
            {!!job.graduation_years.length && ` · ${job.graduation_years.join(' / ')} 届`}
          </li>
          {!!job.position_count && (
            <li>
              <Users size={14} />
              共 {job.position_count} 个在招岗位
            </li>
          )}
        </ul>
        {hasCityFilter && (
          <p className={'opp-loc-note' + (location === 'exact' ? ' is-exact' : '')}>
            {location === 'exact'
              ? `工作地含${matchedCityLabel}`
              : hasSelectedCityTalk
                ? `宣讲地在${talkCityLabel}，工作地需另核对`
                : location === 'possible'
                  ? `覆盖全省 / 全国，${possibleCityLabel}岗位待核实`
                  : '工作地点尚未明确'}
          </p>
        )}

        {(showStage || isNew || applied || job.kind !== '宣讲会') && (
          <div className="opp-badges">
            {job.kind !== '宣讲会' && <span className="chip" title={`${assessOpportunityValidity(job, now).reason}；最近核验：${assessOpportunityValidity(job, now).checkedAt || '未知'}`}>{assessOpportunityValidity(job, now).label}</span>}
            {job.employment_type && job.employment_type !== 'unknown' && <span className="chip">{({ full_time: '全职', internship: '实习', part_time: '兼职' })[job.employment_type]}</span>}
            {showStage && (
              <span className={`chip ${stageInfo.badgeClass}`}>{stageInfo.badge}</span>
            )}
            {isNew && <span className="chip chip-brand">新收录</span>}
            {applied && (
              <span className="chip chip-brand">
                <Check />
                已投递
              </span>
            )}
          </div>
        )}

        {displayPositions.length > 0 && (
          <div className="opp-positions">
            <span className="opp-positions-label">{matchingPositions.length ? `匹配岗位 ${matchingPositions.length}` : '岗位信息'}</span>
            {displayPositions.map((pos, idx) => (
              <span key={idx} className="opp-pos-pill">
                <HighlightText text={pos} query={filters.query} />
              </span>
            ))}
            {job.position_count && job.position_count > displayPositions.length && (
              <span className="text-muted text-xs">等 {job.position_count} 个职位</span>
            )}
          </div>
        )}

        {displayMajors.length > 0 && (
          <div className="opp-majors">
            <span className="opp-majors-label">需求专业</span>
            {displayMajors.map((m, idx) => (
              <span key={idx} className="opp-major-pill">
                <HighlightText text={m} query={filters.query} />
              </span>
            ))}
          </div>
        )}

        {(hasJobTableAttachment || directEmail) && (
          <div className="opp-extras">
            {hasJobTableAttachment && (
              <span className="opp-extra-pill" title="公告附带官方岗位需求表，点击详情可查看解析明细">
                <Paperclip size={12} />
                附官方岗位需求表
              </span>
            )}
            {directEmail && (
              <button
                type="button"
                className="opp-email-btn"
                onClick={handleCopyEmail}
                title="点击复制投递邮箱"
              >
                <Mail size={12} />
                <span>{directEmail}</span>
                <small>{copiedEmail ? '已复制！' : '复制邮箱'}</small>
              </button>
            )}
          </div>
        )}

        {changeAlert && (
          <p className="opp-alert">
            <AlertCircle size={14} />
            <span>
              <strong>变更提醒：</strong>
              {changeAlert}
            </span>
          </p>
        )}
        {job.company_conflict && <p className="opp-note">{job.company_note}</p>}
        {excerptText && (
          <p className="opp-excerpt" title="点击标题查看完整招聘详情">
            <HighlightText text={excerptText} query={filters.query} />
          </p>
        )}
        <TalkEvents
          job={job}
          city={filters.city}
          now={now}
          limit={2}
          onOpen={() => onRead(job)}
        />
      </div>

      <footer className="opp-foot">
        <div className="opp-meta">
          <p className={`opp-deadline ${deadlineState}`}>
            <Clock3 />
            {job.deadline ? (
              <span>
                <strong>{expired ? '已截止' : countdown?.text || '公告截止'}</strong>
                <span className="opp-deadline-date">
                  {' '}
                  · {formatDate(job.deadline, true)}
                  {job.deadline_precision === 'day' ? '（原文仅日期）' : ''}
                </span>
              </span>
            ) : (
              <span>截止日期未明确 · 投递前请核实</span>
            )}
          </p>
          <div className="opp-source">
            <span
              className={
                job.provenance === '第三方线索' ? 'opp-trust is-unverified' : 'opp-trust'
              }
            >
              {job.provenance === '第三方线索' ? '第三方线索 · 待核验' : '公开原始来源'}
            </span>
            <span>
              {job.source_name}
              {!!duplicateSourceNames(job).length &&
                ` · ${duplicateSourceNames(job).length + 1} 渠道收录`}{' '}
              · {job.date_label || '发布'} {publicationText(job, now)}
            </span>
            <button
              className={unread ? 'read-toggle is-unread' : 'read-toggle'}
              disabled={!ready}
              aria-label={`${unread ? '标为已读' : '标为未读'}：${job.title}`}
              title={unread ? '点击标为已读' : '点击标为未读'}
              onClick={() => onReadChange(job, unread)}
            >
              {unread ? '未读' : '已读'}
            </button>
          </div>
        </div>
        <div className="opp-actions">
          <button
            className="btn btn-ghost btn-sm"
            disabled={!ready}
            aria-pressed={!!applied}
            onClick={() => onToggle(job, 'applied')}
            title="仅记录投递状态，不会代为提交申请"
          >
            <Check />
            {applied ? '已投递' : '标记已投'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => onDetail(job)}>
            详情
          </button>
          <OutLink
            className="btn btn-primary btn-sm"
            url={job.application_url || job.source_url}
            onOpen={() => onRead(job)}
          >
            {job.application_url
              ? '前往投递'
              : job.provenance === '第三方线索'
                ? '查看线索'
                : '查看原公告'}
          </OutLink>
        </div>
      </footer>
      {sdeiPositionListUrl(job.source_url) && (
        <div className="opp-fallback">
          <OutLink
            className=""
            url={sdeiPositionListUrl(job.source_url)}
            onOpen={() => onRead(job)}
          >
            原文打不开？查看来源岗位列表
          </OutLink>
        </div>
      )}
    </article>
  );
}
