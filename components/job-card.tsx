'use client';

import {
  Bookmark,
  Building2,
  Clock3,
  ChevronRight,
  GraduationCap,
  MapPin,
  Share2,
  ArrowUpRight,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  externalUrl,
  getDeadlineCountdown,
  getLifecycleStage,
  isExpired,
  isUnread,
  locationMatch,
  locationSummary,
  personalFor,
} from '@/lib/jobs';
import type { Job, Personal, Filters } from '@/lib/jobs';
import { HighlightText } from '@/components/highlight-text';

export function extractSalary(job: Job): { cleanTitle: string; salary: string | null } {
  let cleanTitle = job.title;
  let salary: string | null = null;
  const titleSalaryRegex = /(?:[（(])?(\d+(?:\.\d+)?(?:k|K|万|元)?\s*[-~至–]\s*\d+(?:\.\d+)?(?:k|K|万|元)?(?:·\d+薪)?(?:元|\/月|\/年|\/天)?)(?:[)）])?$/;
  const match = cleanTitle.match(titleSalaryRegex);
  if (match) {
    salary = match[1].trim();
    cleanTitle = cleanTitle.replace(titleSalaryRegex, '').trim();
  } else {
    const excerptMatch = job.excerpt?.match(/薪资(?:待遇)?[:：]\s*([^\s,，;；\n*]+)/);
    if (excerptMatch) {
      salary = excerptMatch[1].trim();
    }
  }
  return { cleanTitle: cleanTitle || job.title, salary };
}

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
}: {
  url: string | null | undefined;
  children: React.ReactNode;
  primary?: boolean;
  onOpen?: () => void;
}) {
  const href = externalUrl(url);
  return href ? (
    <a
      href={href}
      onClick={onOpen}
      target="_blank"
      rel="noopener noreferrer"
      className={primary ? 'primary-link' : 'quiet-link'}
    >
      {children}
      <ArrowUpRight size={15} />
    </a>
  ) : null;
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
  const location = locationMatch(job, filters.city);
  const saved = personalFor(job, personal).saved;
  const applied = personalFor(job, personal).applied;
  const expired = isExpired(job, now);
  const unread = isUnread(job, personal);
  const countdown = getDeadlineCountdown(job.deadline, now);
  const { cleanTitle, salary } = extractSalary(job);
  const excerptText = cleanExcerpt(job.excerpt);
  const stageInfo = getLifecycleStage(job, now);
  const changeAlert =
    job.recent_change?.detail ||
    (stageInfo.stage === 'extended' ? '报名截止时间已延期（详见原公告）' : null) ||
    (stageInfo.stage === 'supplemental' ? '补录 / 追加招聘批次进行中' : null) ||
    (stageInfo.stage === 'selection' ? '发布考核选拔或录用进展通知' : null);

  return (
    <article className={'job-card' + (expired ? ' expired' : '')}>
      <div className="job-top">
        <div className="tags">
          <button
            className={unread ? 'tag read-status unread' : 'tag read-status'}
            disabled={!ready}
            aria-label={`${unread ? '标为已读' : '标为未读'}：${job.title}`}
            onClick={() => onReadChange(job, unread)}
          >
            {unread ? '未读' : '已读'}
          </button>
          {stageInfo.stage !== 'accepting' &&
            stageInfo.stage !== 'expired' &&
            stageInfo.stage !== 'expiring_soon' && (
              <span className={`tag ${stageInfo.badgeClass}`}>
                {stageInfo.badge}
              </span>
            )}
          {countdown && countdown.urgency !== 'expired' && countdown.urgency !== 'normal' && (
            <span className={`tag deadline-${countdown.urgency}`}>
              ⏳ {countdown.text}
            </span>
          )}
          {filters.city !== '全部城市' && (
            <span className="tag">
              {location === 'exact'
                ? `工作地含${filters.city}`
                : location === 'possible'
                  ? '全省 / 全国待核实'
                  : '地点未明确'}
            </span>
          )}
          <span className={'tag ' + (job.types.includes('校招') ? 'blue' : '')}>
            {job.types.join(' / ') || '招聘类型待确认'}
          </span>
          {job.graduation_years.length > 0 && (
            <span className="tag">{job.graduation_years.join(' / ')} 届</span>
          )}
          <span className="tag">{job.sectors[0]}</span>
          {job.classification_note?.startsWith('仅核实') && (
            <span className="tag">详情待核对</span>
          )}
          {since && Date.parse(job.first_seen_at) > Date.parse(since) && (
            <span className="tag new">首次收录</span>
          )}
          {!!job.duplicate_sources?.length && (
            <span
              className="tag channel-pill"
              title={`同步收录渠道：${[job.source_name, ...job.duplicate_sources.map((s) => s.source_name || s.source || s.title)].filter(Boolean).join('、')}`}
            >
              {job.duplicate_sources.length + 1} 渠道同步
            </span>
          )}
          {!!job.position_count && job.position_count > 0 && (
            <span
              className="tag position-count-pill"
              title={
                job.sample_positions?.length
                  ? `包含岗位：${job.sample_positions.join('、')}`
                  : `已解析 ${job.position_count} 个具体岗位`
              }
            >
              📋 {job.position_count} 岗位
            </span>
          )}
          {applied && <span className="tag new">已投递</span>}
        </div>
        <div className="card-top-actions">
          <button
            className="copy-button"
            aria-label={`复制岗位信息：${job.title}`}
            title="复制岗位信息"
            onClick={() => onCopy(job)}
          >
            <Share2 size={16} />
          </button>
          <button
            className={'bookmark-button' + (saved ? ' saved' : '')}
            aria-label={(saved ? '取消收藏：' : '收藏：') + job.title}
            aria-pressed={!!saved}
            disabled={!ready}
            onClick={() => onToggle(job, 'saved')}
          >
            <Bookmark size={18} fill={saved ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>
      <div className="job-title-row">
        <h2 className="job-title-wrap">
          <button className="job-title" onClick={() => onDetail(job)}>
            <HighlightText text={cleanTitle} query={filters.query} />
          </button>
        </h2>
        {salary && <span className="salary-badge">{salary}</span>}
      </div>
      {job.company && (
        <p className="company-name">
          <Building2 size={14} className="company-icon" />
          <span>
            <HighlightText text={job.company} query={filters.query} />
          </span>
        </p>
      )}
      {job.sample_positions && job.sample_positions.length > 0 && (
        <div className="card-sample-positions">
          <span className="sample-pos-label">需求职位：</span>
          <span className="sample-pos-list">
            <HighlightText
              text={
                job.sample_positions.slice(0, 3).join(' · ') +
                (job.position_count && job.position_count > 3
                  ? ` 等 ${job.position_count} 个职位`
                  : '')
              }
              query={filters.query}
            />
          </span>
        </div>
      )}
      {job.company_conflict && <p className="small muted">{job.company_note}</p>}
      {changeAlert && (
        <div className="card-change-callout">
          <AlertCircle size={14} className="change-callout-icon" />
          <span className="change-callout-text">
            <strong>变更提醒：</strong>
            {changeAlert}
          </span>
        </div>
      )}
      <div className="job-meta">
        <span>
          <MapPin size={14} />
          {locationSummary(job)}
        </span>
        {job.education && (
          <span>
            <GraduationCap size={14} />
            {job.education}
          </span>
        )}
      </div>
      {job.directions.length > 0 && (
        <p className="inline-note">
          公告涉及：{job.directions.join('、')} · 以具体岗位要求为准
        </p>
      )}
      {excerptText && (
        <p className="job-excerpt">
          <HighlightText text={excerptText} query={filters.query} />
        </p>
      )}
      <div className="card-foot">
        <div>
          <p className={'deadline ' + (expired ? 'closed' : '')}>
            {job.deadline ? (
              <>
                <Clock3 size={14} />
                {expired ? (
                  '已截止 '
                ) : countdown ? (
                  <span className={`deadline-highlight ${countdown.urgency}`}>
                    {countdown.text} · 截止{' '}
                  </span>
                ) : (
                  '公告截止 '
                )}
                {formatDate(job.deadline, true)}
                {job.deadline_precision === 'day' ? '（原文仅日期）' : ''}
              </>
            ) : (
              <>未明确截止日期，请先核对是否仍可报名</>
            )}
          </p>
          <p className="small muted">
            {job.kind} · {job.source_name}
            {!!job.duplicate_sources?.length && ` 等 ${job.duplicate_sources.length + 1} 渠道`}
            {' · '}
            {job.date_label || '发布'}{' '}
            {job.published_at || '日期未明确'}
            {job.provenance === '第三方线索' && ' · 未经企业原文复核'}
          </p>
        </div>
        <div className="card-actions">
          <Button variant="ghost" size="sm" onClick={() => onDetail(job)}>
            详情
            <ChevronRight size={14} />
          </Button>
          <OutLink
            primary
            url={job.application_url || job.source_url}
            onOpen={() => onRead(job)}
          >
            {job.application_url
              ? '前往投递'
              : job.provenance === '第三方线索'
                ? '查看线索来源'
                : '查看原公告'}
          </OutLink>
        </div>
      </div>
    </article>
  );
}
