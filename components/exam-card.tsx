'use client';

import { useState } from 'react';
import { Bookmark, CheckCircle2, ExternalLink, EyeOff, MapPin, MoreHorizontal } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  computeDaysLeft,
  evaluateExamPositionEligibility,
  getTrackStageInfo,
  isExamProfileActive,
} from '@/lib/exams';
import type { ExamAnnouncement, ExamPersonalRecord, ExamUserProfile } from '@/lib/exams';
import {
  bianzhiLabel,
  categoryLabel,
  formatRegWindow,
  formatShortDate,
  StagePill,
} from '@/components/exam-ui';
import { report } from '@/lib/rum';

interface ExamCardProps {
  exam: ExamAnnouncement;
  profile: ExamUserProfile;
  personal?: ExamPersonalRecord;
  today?: string;
  onSelect: (exam: ExamAnnouncement) => void;
  onToggleSave: (examId: string) => void;
  onToggleHide?: (examId: string) => void;
}

export function ExamCard({ exam, profile, personal, today = '', onSelect, onToggleSave, onToggleHide }: ExamCardProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const isSaved = Boolean(personal?.saved);
  const isHidden = Boolean(personal?.hidden);
  const isEnded = exam.stage === 'ended';
  const trackStage = getTrackStageInfo(personal?.status);
  const isNotice = exam.notice_role !== '招考简章';
  const isRegistering = exam.stage === 'registering' || exam.stage === 'closing_soon';
  const regDaysLeft = isRegistering ? computeDaysLeft(exam.schedule.reg_end, today) : null;
  const positions = exam.positions || [];
  const profileActive = isExamProfileActive(profile);
  const eligList = profileActive ? positions.map((row) => evaluateExamPositionEligibility(row, profile)) : [];
  const eligibleCount = eligList.filter((r) => r.status === 'eligible').length;
  const unknownCount = eligList.filter((r) => r.status === 'unknown').length;
  const regWindow = formatRegWindow(exam.schedule);
  const regDisplay =
    regWindow ||
    (exam.schedule.reg_mode === 'rolling'
      ? exam.schedule.rolling_until
        ? `长期招聘（至 ${formatShortDate(exam.schedule.rolling_until)}）`
        : '长期招聘'
      : '见公告');
  const cityLabel = exam.cities.length
    ? exam.cities.slice(0, 2).join('、') + (exam.cities.length > 2 ? ` 等${exam.cities.length}地` : '')
    : exam.province;
  const applyHref = exam.registration_url || exam.source_url;

  return (
    <article
      className={`exw-card${isSaved ? ' is-saved' : ''}${personal?.readAt ? ' is-read' : ''}${isEnded ? ' is-ended' : ''}`}
      style={isEnded ? { opacity: 0.62 } : undefined}
    >
      <div className="exw-card-body">
        <div className="exw-card-meta">
          <StagePill stage={exam.stage} />
          {regDaysLeft !== null && regDaysLeft >= 0 && (
            <span className="exw-tag is-brand">还剩 {regDaysLeft} 天</span>
          )}
          {isNotice ? (
            <span className="exw-tag is-notice">{exam.notice_role}</span>
          ) : (
            <span className="exw-tag">{categoryLabel(exam.exam_category)}</span>
          )}
          <span className="exw-card-loc">
            <MapPin size={12} />
            {cityLabel}
          </span>
          {trackStage && <span className="exw-tag is-brand">{trackStage.shortLabel}</span>}
        </div>

        <h3 className="exw-card-title">
          <button type="button" onClick={() => onSelect(exam)}>
            {exam.title}
          </button>
        </h3>
        <p className="exw-card-org">
          {exam.organizer}
          {exam.published_at ? <span> · {formatShortDate(exam.published_at)}发布</span> : null}
        </p>
        {exam.parent_exam_title && (
          <p className="exw-muted" style={{ margin: '2px 0 0' }}>
            属于：{exam.parent_exam_title}
          </p>
        )}

        {!isNotice && !isEnded && (
          <dl className="exw-facts">
            <div>
              <dt>招录</dt>
              <dd>
                {exam.total_headcount != null ? (
                  <>
                    <strong>{exam.total_headcount}</strong> 人
                  </>
                ) : (
                  '见公告'
                )}
                {exam.total_positions != null
                  ? ` · ${exam.total_positions} 岗`
                  : exam.positions_status === 'attachment_only'
                    ? ' · 岗位表在附件'
                    : ''}
              </dd>
            </div>
            <div>
              <dt>报名时间</dt>
              <dd>{regDisplay}</dd>
            </div>
            <div>
              <dt>学历</dt>
              <dd>{exam.education_min || '见公告'}</dd>
            </div>
            <div>
              <dt>编制</dt>
              <dd>{exam.bianzhi_types.slice(0, 2).map(bianzhiLabel).join(' / ')}</dd>
            </div>
          </dl>
        )}

        {profileActive && !isNotice && !isEnded && (
          exam.positions === undefined && (exam.parsed_position_count ?? 0) > 0 ? (
            <p className="exw-card-match is-unknown">正在核对岗位条件…</p>
          ) : positions.length === 0 ? (
            <p className="exw-card-match is-unknown">? 岗位需核实</p>
          ) : eligibleCount > 0 || unknownCount > 0 ? (
            <p className={`exw-card-match ${eligibleCount > 0 ? 'is-ok' : 'is-unknown'}`}>
              {eligibleCount > 0 ? <CheckCircle2 size={13} /> : null}
              {[
                eligibleCount > 0 ? `✓ ${eligibleCount} 个可报` : '',
                unknownCount > 0 ? `? ${unknownCount} 个待核实` : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          ) : (
            <p className="exw-card-match is-no">暂无符合你条件的岗位</p>
          )
        )}
      </div>

      <div className="exw-card-actions">
        <button
          type="button"
          className={`exw-icon-btn${isSaved ? ' is-on' : ''}`}
          aria-pressed={isSaved}
          aria-label={isSaved ? '取消收藏' : '收藏'}
          title={isSaved ? '取消收藏' : '收藏'}
          onClick={() => onToggleSave(exam.id)}
        >
          <Bookmark size={16} fill={isSaved ? 'currentColor' : 'none'} />
        </button>
        <a
          className="exw-card-link"
          href={applyHref}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => report('event', 'click_apply')}
        >
          {exam.registration_url ? '报名' : '原文'}
          <ExternalLink size={12} />
        </a>
        {onToggleHide && (
          <Popover open={moreOpen} onOpenChange={setMoreOpen}>
            <PopoverTrigger
              type="button"
              className="exw-icon-btn"
              aria-label="更多操作"
              title="更多操作"
            >
              <MoreHorizontal size={16} />
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={6} className="opp-more-menu">
              <a
                href={exam.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="opp-more-item"
                onClick={() => setMoreOpen(false)}
              >
                <ExternalLink size={14} />
                <span>查看原公告</span>
              </a>
              <button
                type="button"
                className="opp-more-item is-danger"
                onClick={() => {
                  onToggleHide(exam.id);
                  setMoreOpen(false);
                }}
              >
                <EyeOff size={14} />
                <span>{isHidden ? '恢复显示' : '不感兴趣'}</span>
              </button>
            </PopoverContent>
          </Popover>
        )}
      </div>
    </article>
  );
}
