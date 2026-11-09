'use client';

import { useState } from 'react';
import { CalendarPlus, ChevronDown, ChevronRight, Kanban, MapPin } from 'lucide-react';
import {
  computeExamNextStep,
  EXAM_TERMINAL_STAGES,
  EXAM_TRACK_STAGES,
  isTerminalTrackStatus,
} from '@/lib/exams';
import type { ExamAnnouncement, ExamPersonalStore } from '@/lib/exams';
import { downloadExamCalendar } from '@/lib/exam-calendar';
import { categoryLabel, formatMonthDay } from '@/components/exam-ui';

export interface ExamTrackerBoardProps {
  allExams: ExamAnnouncement[];
  personal: ExamPersonalStore;
  trackedCount: number;
  today?: string;
  onSelectExam: (exam: ExamAnnouncement) => void;
  onNotify?: (msg: string) => void;
}

export function ExamTrackerBoard({
  allExams,
  personal,
  trackedCount,
  today = '',
  onSelectExam,
  onNotify,
}: ExamTrackerBoardProps) {
  const [terminalExpanded, setTerminalExpanded] = useState(false);

  if (trackedCount === 0) {
    return (
      <div className="exw-empty">
        <Kanban size={28} />
        <p>还没有跟进中的报考</p>
        <span className="exw-muted">打开任一公告，在详情中设置「报考进度」即可加入看板</span>
      </div>
    );
  }

  const activeTrackedExams = allExams.filter((ex) => {
    const status = personal[ex.id]?.status;
    return Boolean(status && status !== 'none' && !isTerminalTrackStatus(status));
  });

  const terminalExams = allExams.filter((ex) => isTerminalTrackStatus(personal[ex.id]?.status));

  const handleExportCalendar = () => {
    if (activeTrackedExams.length === 0) {
      onNotify?.('暂无跟进中的有效考试可导出');
      return;
    }
    downloadExamCalendar(activeTrackedExams, Date.now());
    onNotify?.('已导出我的考试日历（.ics）');
  };

  return (
    <div className="exw-tracker-wrap">
      <div
        className="exw-results-head"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}
      >
        <p className="exw-count">
          共跟进 <strong>{activeTrackedExams.length}</strong> 场进行中考试
          {terminalExams.length > 0 && <span className="exw-muted"> · 已结束 {terminalExams.length} 场</span>}
        </p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={handleExportCalendar}>
          <CalendarPlus size={14} />
          导出我的考试日历
        </button>
      </div>

      <div className="exw-kanban">
        {EXAM_TRACK_STAGES.map((stage) => {
          const stageExams = allExams.filter((ex) => personal[ex.id]?.status === stage.key);
          return (
            <section
              key={stage.key}
              className={`exw-kcol${stage.key === 'audited' ? ' is-warn' : ''}`}
            >
              <header className="exw-kcol-head">
                <span>{stage.shortLabel}</span>
                <span className="exw-kcount">{stageExams.length}</span>
              </header>
              <div className="exw-kcards">
                {stageExams.map((ex) => {
                  const rec = personal[ex.id];
                  const nextStep = computeExamNextStep(ex, rec?.status, today);
                  const stepDateLabel = nextStep?.date ? formatMonthDay(nextStep.date) : '';
                  const daysText =
                    nextStep?.daysLeft !== null && nextStep?.daysLeft !== undefined
                      ? nextStep.daysLeft >= 0
                        ? `（还剩 ${nextStep.daysLeft} 天）`
                        : '（已截止）'
                      : '';
                  return (
                    <button
                      key={ex.id}
                      type="button"
                      className="exw-kcard"
                      onClick={() => onSelectExam(ex)}
                    >
                      <span className="exw-kcard-title">{ex.title}</span>
                      <span className="exw-kcard-meta">
                        <MapPin size={11} />
                        {ex.cities[0] || ex.province} · {categoryLabel(ex.exam_category)}
                      </span>
                      {rec?.targetPositionCode && (
                        <span className="exw-kcard-note">主报：{rec.targetPositionCode}</span>
                      )}
                      {nextStep && (
                        <span className="exw-kcard-date">
                          下一步：{nextStep.label}
                          {stepDateLabel ? ` · 截止 ${stepDateLabel}${daysText}` : ''}
                        </span>
                      )}
                    </button>
                  );
                })}
                {stageExams.length === 0 && <p className="exw-kempty">—</p>}
              </div>
            </section>
          );
        })}

        <section className="exw-kcol is-terminal">
          <header className="exw-kcol-head">
            <button
              type="button"
              className="text-btn"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontWeight: 600 }}
              aria-expanded={terminalExpanded}
              onClick={() => setTerminalExpanded((v) => !v)}
            >
              {terminalExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span>已结束</span>
            </button>
            <span className="exw-kcount">{terminalExams.length}</span>
          </header>
          {terminalExpanded && (
            <div className="exw-kcards">
              {terminalExams.map((ex) => {
                const rec = personal[ex.id];
                const termStage = EXAM_TERMINAL_STAGES.find((s) => s.key === rec?.status);
                return (
                  <button
                    key={ex.id}
                    type="button"
                    className="exw-kcard"
                    style={{ opacity: 0.72 }}
                    onClick={() => onSelectExam(ex)}
                  >
                    <span className="exw-kcard-title">{ex.title}</span>
                    <span className="exw-kcard-meta">
                      <MapPin size={11} />
                      {ex.cities[0] || ex.province} · {termStage?.shortLabel || '已结束'}
                    </span>
                    {rec?.targetPositionCode && (
                      <span className="exw-kcard-note">主报：{rec.targetPositionCode}</span>
                    )}
                  </button>
                );
              })}
              {terminalExams.length === 0 && <p className="exw-kempty">—</p>}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
