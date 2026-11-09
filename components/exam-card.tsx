'use client';

import {
  Bookmark,
  Calendar,
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  GraduationCap,
  MapPin,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  computeExamStageLabel,
  evaluateExamPositionEligibility,
  EXAM_TRACK_STAGES,
  isExamProfileActive,
} from '@/lib/exams';
import type {
  ExamAnnouncement,
  ExamPersonalRecord,
  ExamTrackStatus,
  ExamUserProfile,
} from '@/lib/exams';

interface ExamCardProps {
  exam: ExamAnnouncement;
  profile: ExamUserProfile;
  personal?: ExamPersonalRecord;
  onSelect: (exam: ExamAnnouncement) => void;
  onToggleSave: (examId: string) => void;
  onChangeStatus: (examId: string, status: ExamTrackStatus) => void;
}

export function ExamCard({
  exam,
  profile,
  personal,
  onSelect,
  onToggleSave,
  onChangeStatus,
}: ExamCardProps) {
  const stageMeta = computeExamStageLabel(exam.stage);
  const isSaved = Boolean(personal?.saved);
  const trackStatus = personal?.status || 'none';
  const profileActive = isExamProfileActive(profile);

  const positions = exam.positions || [];
  const matchedPositions = profileActive
    ? positions.filter((row) => evaluateExamPositionEligibility(row, profile).matched)
    : positions;

  const previewPositions = (matchedPositions.length > 0 ? matchedPositions : positions).slice(0, 3);
  const applyHref = exam.registration_url || exam.source_url;

  return (
    <article
      className={`job-card exam-card ${isSaved ? 'is-saved' : ''} ${trackStatus !== 'none' ? 'is-applied' : ''}`}
    >
      <div className="exam-card-top">
        <div className="exam-card-badges">
          <span className="exam-badge is-category">{exam.exam_category}</span>
          {exam.bianzhi_types.slice(0, 2).map((bz) => (
            <span key={bz} className="exam-badge is-bianzhi">
              <ShieldCheck size={12} />
              {bz}
            </span>
          ))}
          <span className="exam-badge is-level">{exam.region_level}</span>
          {exam.cities.length > 0 ? (
            <span className="exam-badge is-city">
              <MapPin size={12} />
              {exam.cities.slice(0, 3).join(' / ')}
              {exam.cities.length > 3 ? ` 等${exam.cities.length}地` : ''}
            </span>
          ) : (
            <span className="exam-badge is-city">
              <MapPin size={12} />
              {exam.province}
            </span>
          )}
          {exam.has_unlimited_major && (
            <span className="exam-badge is-highlight">含不限专业岗</span>
          )}
        </div>

        <div className="exam-card-status">
          <span className={`exam-stage-pill is-${stageMeta.tone}`}>
            {stageMeta.label}
          </span>
          {exam.notice_role !== '招考简章' && (
            <span className="exam-role-pill">{exam.notice_role}</span>
          )}
        </div>
      </div>

      <div className="exam-card-header">
        <h3 className="exam-card-title">
          <button type="button" className="exam-title-btn" onClick={() => onSelect(exam)}>
            {exam.title}
          </button>
        </h3>
        <div className="exam-card-sub">
          <span>招录主管：{exam.organizer}</span>
          <span>·</span>
          <span>来源：{exam.source_name}</span>
          {exam.published_at && (
            <>
              <span>·</span>
              <span>发布于 {exam.published_at}</span>
            </>
          )}
        </div>
      </div>

      <div className="exam-metrics-grid">
        <div className="exam-metric-cell">
          <span className="exam-metric-label">
            <Users size={13} /> 招考规模
          </span>
          <strong className="exam-metric-val is-primary">
            {exam.total_positions} 个岗位 / 共招 {exam.total_headcount} 人
          </strong>
        </div>

        <div className="exam-metric-cell">
          <span className="exam-metric-label">笔试科目</span>
          <strong className="exam-metric-val">
            {exam.exam_subjects.join(' + ') || '详见简章'}
          </strong>
        </div>

        <div className="exam-metric-cell">
          <span className="exam-metric-label">
            <GraduationCap size={13} /> 学历与应届要求
          </span>
          <strong className="exam-metric-val">
            {exam.education_min} · {exam.fresh_grad_summary}
          </strong>
        </div>

        <div className="exam-metric-cell">
          <span className="exam-metric-label">年龄 / 户籍 / 比例</span>
          <strong className="exam-metric-val">
            {exam.age_limit || '35周岁以下'} · {exam.hukou_summary} · {exam.exam_ratio || '1:3'}
          </strong>
        </div>
      </div>

      <div className="exam-schedule-strip" aria-label="考务关键时间节点">
        <div className={`exam-schedule-node ${exam.schedule.reg_end ? 'is-set' : ''}`}>
          <span className="node-k"><Calendar size={12} /> 网上报名</span>
          <span className="node-v">
            {exam.schedule.reg_start && exam.schedule.reg_end
              ? `${exam.schedule.reg_start.slice(5)} ~ ${exam.schedule.reg_end.slice(5)}`
              : exam.schedule.reg_end
                ? `截至 ${exam.schedule.reg_end}`
                : '见简章正文'}
          </span>
        </div>
        <div className={`exam-schedule-node ${exam.schedule.audit_end ? 'is-set' : ''}`}>
          <span className="node-k">资格初审</span>
          <span className="node-v">{exam.schedule.audit_end ? `截至 ${exam.schedule.audit_end.slice(5)}` : '随报随审'}</span>
        </div>
        <div className={`exam-schedule-node ${exam.schedule.payment_end ? 'is-set is-warn' : ''}`}>
          <span className="node-k">缴费确认</span>
          <span className="node-v">{exam.schedule.payment_end ? `截至 ${exam.schedule.payment_end.slice(5)}` : '初审通过后'}</span>
        </div>
        <div className={`exam-schedule-node ${exam.schedule.written_exam_date ? 'is-set' : ''}`}>
          <span className="node-k">笔试时间</span>
          <span className="node-v">{exam.schedule.written_exam_date || '待定 / 另行通知'}</span>
        </div>
      </div>

      {previewPositions.length > 0 ? (
        <div className="exam-pos-preview">
          <div className="exam-pos-preview-head">
            <span className="exam-pos-preview-title">
              <FileSpreadsheet size={13} />
              {profileActive && matchedPositions.length > 0 ? (
                <span className="is-matched">
                  <Sparkles size={12} /> 符合您报考画像的岗位（{matchedPositions.length}/{positions.length}）
                </span>
              ) : (
                <span>岗位表预览（已解析 {positions.length} 个具体岗位）</span>
              )}
            </span>
            <button type="button" className="text-btn" onClick={() => onSelect(exam)}>
              查看完整岗位表 →
            </button>
          </div>
          <div className="exam-pos-preview-list">
            {previewPositions.map((pos) => (
              <button
                key={pos.row_id}
                type="button"
                className="exam-pos-chip"
                onClick={() => onSelect(exam)}
              >
                <strong>{pos.employer !== exam.organizer ? `${pos.employer} · ` : ''}{pos.position_name}</strong>
                <span>招 {pos.recruit_count} 人</span>
                <span>{pos.education}</span>
                <span className="exam-pos-major">{pos.major_raw}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <p className="exam-card-excerpt">{exam.excerpt}</p>
      )}

      <div className="exam-card-footer">
        <div className="exam-card-actions-left">
          <button
            type="button"
            className={`btn btn-sm ${isSaved ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => onToggleSave(exam.id)}
          >
            <Bookmark size={14} />
            {isSaved ? '已收藏' : '收藏简章'}
          </button>

          <select
            className={`exam-status-select ${trackStatus !== 'none' ? 'is-active' : ''}`}
            aria-label="更新报考进度状态"
            value={trackStatus}
            onChange={(e) => onChangeStatus(exam.id, e.target.value as ExamTrackStatus)}
          >
            <option value="none">+ 加入报考跟进</option>
            {EXAM_TRACK_STAGES.map((st) => (
              <option key={st.key} value={st.key}>
                跟进：{st.label}
              </option>
            ))}
          </select>

          {trackStatus !== 'none' && (
            <span className="exam-tracked-tag">
              <CheckCircle2 size={13} />
              {EXAM_TRACK_STAGES.find((s) => s.key === trackStatus)?.shortLabel}
            </span>
          )}
        </div>

        <div className="exam-card-actions-right">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onSelect(exam)}>
            简章与职位表 {positions.length > 0 ? `(${positions.length})` : ''}
          </button>
          <a
            className="btn btn-primary btn-sm"
            href={applyHref}
            target="_blank"
            rel="noopener noreferrer"
          >
            {exam.registration_url ? '报名入口' : '查看原公告'} <ExternalLink size={13} />
          </a>
        </div>
      </div>
    </article>
  );
}
