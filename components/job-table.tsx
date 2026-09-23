'use client';
import { Bookmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { publicationText, externalUrl, getDeadlineCountdown, isExpired, isUnread, locationSummary, personalFor } from '@/lib/jobs';
import type { Job, Personal } from '@/lib/jobs';
import { talkDateLabel, talkEventsForCity } from '@/lib/talk-events';

export function JobTable({ jobs, city, personal, ready, now, onDetail, onRead, onReadChange, onToggle }: {
  jobs: Job[];
  city: string;
  personal: Personal;
  ready: boolean;
  now: number;
  onDetail: (job: Job) => void;
  onRead: (job: Job) => void;
  onReadChange: (job: Job, read: boolean) => void;
  onToggle: (job: Job, key: 'saved' | 'applied' | 'hidden') => void;
}) {
  return (
    // A scroll region needs a keyboard focus target so arrow keys can reveal off-screen columns.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <section className="job-table-scroll" tabIndex={0} aria-label="紧凑招聘表格，可横向滚动">
      <table className="job-table">
        <caption className="sr-only">当前页招聘信息，与卡片视图使用相同筛选及排序</caption>
        <thead><tr>
          <th scope="col">企业 / 招聘信息</th><th scope="col">工作地点</th>
          <th scope="col">发布时间 / 来源</th><th scope="col">截止时间</th>
          <th scope="col">阅读 / 投递状态</th><th scope="col">操作</th>
        </tr></thead>
        <tbody>{jobs.map((job) => {
          const record = personalFor(job, personal);
          const unread = isUnread(job, personal);
          const expired = isExpired(job, now);
          const countdown = getDeadlineCountdown(job.deadline, now);
          const href = externalUrl(job.application_url || job.source_url);
          const cityTalks = talkEventsForCity(job, city, now);
          const talk = cityTalks[0];
          return <tr key={job.id} className={expired ? 'expired' : undefined}>
            <th scope="row">
              <button className="job-title table-title" onClick={() => onDetail(job)}>{job.title}</button>
              {job.company && <p className="small muted">{job.company}</p>}
              {job.company_conflict && <p className="small muted">{job.company_note}</p>}
              <p className="small muted">{job.kind} · {job.types.join(' / ') || '类型待确认'}{job.graduation_years.length ? ` · ${job.graduation_years.join(' / ')} 届` : ''}</p>
              {job.classification_note?.startsWith('仅核实') && <span className="tag">详情待核对</span>}
              {talk && <p className="small table-talk">宣讲 {talkDateLabel(talk)} · {talk.school} · {talk.venue}{cityTalks.length > 1 ? ' · 详情查看更多' : ''}</p>}
            </th>
            <td><div className="table-location" title={locationSummary(job)}>{locationSummary(job)}</div></td>
            <td>
              {publicationText(job, now)}
              <p className="small muted">
                {job.date_label || '发布'} · {job.source_name}
                {!!job.duplicate_sources?.length && (
                  <span
                    className="channel-pill-table"
                    title={`同步收录渠道：${[job.source_name, ...job.duplicate_sources.map((s) => s.source_name || s.source || s.title)].filter(Boolean).join('、')}`}
                  >
                    +{job.duplicate_sources.length}渠道
                  </span>
                )}
              </p>
              {job.provenance === '第三方线索' && <p className="small muted">第三方线索 · 待原文复核</p>}
            </td>
            <td>{job.deadline ? <><span>{expired ? '已截止' : countdown && countdown.urgency !== 'normal' ? `⏳ ${countdown.text}` : '公告截止'}</span><p>{new Date(job.deadline).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p></> : '未明确，需核对'}</td>
            <td>
              <Button size="sm" variant="ghost" className={unread ? 'read-status unread' : 'read-status'} disabled={!ready} onClick={() => onReadChange(job, unread)} aria-label={`${unread ? '标为已读' : '标为未读'}：${job.title}`}>{unread ? '未读' : '已读'}</Button>
              <Button size="sm" variant="ghost" disabled={!ready} aria-pressed={!!record.applied} onClick={() => onToggle(job, 'applied')}>{record.applied ? '已投递' : '标记投递'}</Button>
            </td>
            <td><div className="table-actions">
              <Button size="sm" variant="outline" onClick={() => onDetail(job)}>详情</Button>
              <Button size="sm" variant="ghost" disabled={!ready} aria-pressed={!!record.saved} aria-label={`${record.saved ? '取消收藏' : '收藏'}：${job.title}`} onClick={() => onToggle(job, 'saved')}><Bookmark size={16} fill={record.saved ? 'currentColor' : 'none'} /></Button>
              {href && <a href={href} target="_blank" rel="noopener noreferrer" className="quiet-link" onClick={() => onRead(job)}>{job.application_url ? '前往投递 ↗' : '查看原文 ↗'}</a>}
            </div></td>
          </tr>;
        })}</tbody>
      </table>
    </section>
  );
}
