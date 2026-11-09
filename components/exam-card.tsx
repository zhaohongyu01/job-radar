'use client';

import { Bookmark, CheckCircle2, ExternalLink, MapPin } from 'lucide-react';
import {
  evaluateExamPositionEligibility,
  EXAM_TRACK_STAGES,
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

interface ExamCardProps {
  exam: ExamAnnouncement;
  profile: ExamUserProfile;
  personal?: ExamPersonalRecord;
  onSelect: (exam: ExamAnnouncement) => void;
  onToggleSave: (examId: string) => void;
}

export function ExamCard({ exam, profile, personal, onSelect, onToggleSave }: ExamCardProps) {
  const isSaved = Boolean(personal?.saved);
  const trackStage =
    personal?.status && personal.status !== 'none'
      ? EXAM_TRACK_STAGES.find((s) => s.key === personal.status)
      : undefined;
  const isNotice = exam.notice_role !== '招考简章';
  const positions = exam.positions || [];
  const profileActive = isExamProfileActive(profile);
  const matchedCount = profileActive
    ? positions.filter((row) => evaluateExamPositionEligibility(row, profile).matched).length
    : 0;
  const regWindow = formatRegWindow(exam.schedule);
  const cityLabel = exam.cities.length
    ? exam.cities.slice(0, 2).join('、') + (exam.cities.length > 2 ? ` 等${exam.cities.length}地` : '')
    : exam.province;
  const applyHref = exam.registration_url || exam.source_url;

  return (
    <article className={`exw-card${isSaved ? ' is-saved' : ''}${personal?.readAt ? ' is-read' : ''}`}>
      <div className="exw-card-body">
        <div className="exw-card-meta">
          <StagePill stage={exam.stage} />
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

        {!isNotice && (
          <dl className="exw-facts">
            <div>
              <dt>招录</dt>
              <dd>
                <strong>{exam.total_headcount}</strong> 人 · {exam.total_positions} 岗
              </dd>
            </div>
            <div>
              <dt>报名时间</dt>
              <dd>{regWindow || '见公告'}</dd>
            </div>
            <div>
              <dt>学历</dt>
              <dd>{exam.education_min}</dd>
            </div>
            <div>
              <dt>编制</dt>
              <dd>{exam.bianzhi_types.slice(0, 2).map(bianzhiLabel).join(' / ')}</dd>
            </div>
          </dl>
        )}

        {profileActive && !isNotice && positions.length > 0 && (
          <p className={`exw-card-match ${matchedCount > 0 ? 'is-ok' : 'is-no'}`}>
            {matchedCount > 0 ? (
              <>
                <CheckCircle2 size={13} />
                {matchedCount} 个岗位符合你的条件
              </>
            ) : (
              '暂无符合你条件的岗位'
            )}
          </p>
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
        <a className="exw-card-link" href={applyHref} target="_blank" rel="noopener noreferrer">
          {exam.registration_url ? '报名' : '原文'}
          <ExternalLink size={12} />
        </a>
      </div>
    </article>
  );
}
