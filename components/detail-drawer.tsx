'use client';

import { Bookmark, Check, Share2 } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { isUnread, personalFor } from '@/lib/jobs';
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
              <span className="eyebrow">
                {selected.kind} · {selected.source_name}
              </span>
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
                  <h3>附件</h3>
                  {(selected.attachments ?? []).map((a, i) => (
                    <div className="attachment" key={i}>
                      <OutLink url={a.url}>{a.title}</OutLink>
                    </div>
                  ))}
                  {selected.qr_attachment && (
                    <p className="inline-note">
                      公告含二维码或扫码说明，未自动解析其中内容，请打开原公告查看。
                    </p>
                  )}
                </>
              )}
              <h3>公告文字</h3>
              <div className="announcement-text">
                {selected.body || '完整公告尚未读取，请打开原公告核对。'}
              </div>
              {!!selected.duplicate_sources?.length && (
                <>
                  <h3>相同内容的其他来源</h3>
                  {selected.duplicate_sources.map((s) => (
                    <div className="attachment" key={s.url}>
                      <OutLink url={s.application_url || s.url}>
                        {s.title}
                        {s.application_url ? ' · 投递入口' : ''}
                      </OutLink>
                    </div>
                  ))}
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
