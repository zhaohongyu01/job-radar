'use client';

import { Kanban, MapPin } from 'lucide-react';
import { EXAM_TRACK_STAGES } from '@/lib/exams';
import type { ExamAnnouncement, ExamPersonalStore } from '@/lib/exams';
import { categoryLabel, formatMonthDay } from '@/components/exam-ui';

export interface ExamTrackerBoardProps {
  allExams: ExamAnnouncement[];
  personal: ExamPersonalStore;
  trackedCount: number;
  onSelectExam: (exam: ExamAnnouncement) => void;
}

export function ExamTrackerBoard({
  allExams,
  personal,
  trackedCount,
  onSelectExam,
}: ExamTrackerBoardProps) {
  if (trackedCount === 0) {
    return (
      <div className="exw-empty">
        <Kanban size={28} />
        <p>还没有跟进中的报考</p>
        <span className="exw-muted">打开任一公告，在详情中设置「报考进度」即可加入看板</span>
      </div>
    );
  }

  return (
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
                    {(ex.schedule.payment_end || ex.schedule.written_exam_date) && (
                      <span className="exw-kcard-date">
                        {ex.schedule.payment_end
                          ? `缴费截止 ${formatMonthDay(ex.schedule.payment_end)}`
                          : `笔试 ${formatMonthDay(ex.schedule.written_exam_date)}`}
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
    </div>
  );
}
