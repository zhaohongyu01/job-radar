'use client';

import { useState, useMemo } from 'react';
import { Bookmark, Check, Share2, Briefcase, Search, FileSpreadsheet, Clock } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { generateJobTimeline, getLifecycleStage, isUnread, personalFor } from '@/lib/jobs';
import type { Job, Personal } from '@/lib/jobs';
import { formatDate, OutLink } from '@/components/job-card';

export function DetailDrawer({
  selected,
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
}: {
  selected: Job | null;
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
}) {
  const [positionFilter, setPositionFilter] = useState('');

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

  const timelineEvents = useMemo(
    () => (selected ? generateJobTimeline(selected) : []),
    [selected],
  );

  const currentStage = useMemo(
    () => (selected ? getLifecycleStage(selected) : null),
    [selected],
  );
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
                {selected.title}
              </SheetTitle>
              <SheetDescription>
                {selected.date_label || '发布'} {selected.published_at || '日期未明确'} · 最近读取{' '}
                {formatDate(selected.last_verified_at, true)}
              </SheetDescription>
            </SheetHeader>
            <div className="detail-body">
              {detailLoading && (
                <output className="inline-note">
                  正在读取完整公告，列表筛选仍可继续使用……
                </output>
              )}
              {detailError && (
                <div className="notice warning" role="alert">
                  {detailError}
                </div>
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
              <div className="detail-actions">
                <Button
                  variant="outline"
                  disabled={!ready || detailLoading}
                  onClick={() => onReadChange(selected, isUnread(selected, personal))}
                >
                  {isUnread(selected, personal) ? '标为已读' : '标为未读'}
                </Button>
                <Button
                  variant={personalFor(selected, personal).saved ? 'default' : 'outline'}
                  onClick={() => onToggle(selected, 'saved')}
                >
                  <Bookmark size={16} />
                  {personalFor(selected, personal).saved ? '已收藏' : '收藏'}
                </Button>
                <Button
                  variant={personalFor(selected, personal).applied ? 'default' : 'outline'}
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
              </div>
              <div className="apply-panel">
                <h3>报名入口</h3>
                <OutLink
                  primary
                  url={selected.application_url || selected.source_url}
                  onOpen={() => onRead(selected)}
                >
                  {selected.application_url
                    ? '打开投递页面'
                    : '打开原公告查看报名方式'}
                </OutLink>
                {(selected.emails ?? []).map((email) => (
                  <div className="email-row" key={email}>
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
                <p>跳转不会提交简历，也不会自动标记已投递。</p>
                {selected.deadline_evidence && (
                  <p className="deadline-evidence">
                    {selected.deadline_evidence}
                  </p>
                )}
              </div>
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
                      <div className="channel-card-title">{selected.title}</div>
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
              <h3>地点与资格</h3>
              <p>
                {selected.location_evidence.length
                  ? selected.location_evidence.join('；')
                  : '未提取到明确工作地点，请以岗位表为准。'}
              </p>
              <p className="inline-note">
                自动整理标签可能不完整；应届资格、专业和工作经验要求请核对原文。
              </p>
              {((selected.attachments ?? []).length > 0 ||
                selected.qr_attachment) && (
                <>
                  <h3>附件与文档</h3>
                  {(selected.attachments ?? []).map((a, i) => (
                    <div className="attachment" key={i}>
                      <OutLink url={a.url}>{a.title}</OutLink>
                      {(() => {
                        const isParsed = (selected.positions ?? []).some(
                          (p) =>
                            (p.source_url && a.url && p.source_url === a.url) ||
                            (p.source_file &&
                              (a.title.includes(p.source_file) ||
                                p.source_file.includes(a.title) ||
                                (a.url && a.url.includes(p.source_file)))),
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

              {/* Parsed Positions Panel */}
              {(selected.positions ?? []).length > 0 && (
                <div className="positions-panel" aria-label="岗位需求明细">
                  <div className="positions-header">
                    <div className="positions-title-box">
                      <Briefcase size={16} className="positions-icon" />
                      <span className="positions-title">岗位需求与资格要求明细</span>
                      <span className="positions-count-badge">
                        共 {selected.positions?.length} 个岗位
                      </span>
                    </div>
                    {(selected.positions ?? []).length > 3 && (
                      <div className="positions-filter-box">
                        <Search size={13} className="positions-filter-icon" />
                        <input
                          type="text"
                          className="positions-filter-input"
                          placeholder="搜索职位或专业..."
                          value={positionFilter}
                          onChange={(e) => setPositionFilter(e.target.value)}
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
                          <tr key={idx}>
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

              <h3>公告文字</h3>
              <div className="announcement-text">
                {selected.body || '完整公告尚未读取，请打开原公告核对。'}
              </div>

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
              <p className="source-note">
                首次收录 {formatDate(selected.first_seen_at, true)} · 内容版本{' '}
                {selected.revision}
                <br />
                最近内容变化 {formatDate(selected.updated_at, true)}
              </p>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
