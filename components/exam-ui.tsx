'use client';

import { computeExamStageLabel } from '@/lib/exams';
import type { BianzhiCategory, ExamCategory, ExamSchedule, ExamStage } from '@/lib/exams';

/** Short display labels; filter values stay unchanged. */
export const CATEGORY_SHORT: Record<ExamCategory, string> = {
  公务员国考: '国考',
  公务员省考: '省考',
  选调生招录: '选调生',
  事业单位统考: '事业单位统考',
  事业单位单招: '事业单位',
  教师公开招聘: '教师招聘',
  医疗卫生招聘: '医疗卫生',
  '高校 / 科研院所': '高校科研',
  '人才引进 / 优才': '人才引进',
  军队文职招考: '军队文职',
  '三支一扶 / 基层': '三支一扶',
};

export const BIANZHI_SHORT: Record<BianzhiCategory, string> = {
  '公务员（行政编）': '行政编',
  参公管理: '参公',
  事业编: '事业编',
  '控制总量 / 备案制': '控制总量',
  选调生: '选调生',
  教师编: '教师编',
  医疗卫生编: '医疗编',
  军队文职: '军队文职',
  '三支一扶 / 基层项目': '基层项目',
  '高层次 / 紧缺人才': '高层次人才',
};

export function categoryLabel(value: string): string {
  return CATEGORY_SHORT[value as ExamCategory] ?? value;
}

export function bianzhiLabel(value: string): string {
  return BIANZHI_SHORT[value as BianzhiCategory] ?? value;
}

/** 2026-11-09 → 11月9日 */
export function formatShortDate(value?: string | null): string {
  if (!value) return '';
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[2])}月${Number(m[3])}日` : value;
}

/** 2026-11-09 → 11/09 */
export function formatMonthDay(value?: string | null): string {
  if (!value) return '';
  const m = value.match(/^\d{4}-(\d{2})-(\d{2})/);
  return m ? `${m[1]}/${m[2]}` : value;
}

export function formatRegWindow(schedule: ExamSchedule): string | null {
  if (schedule.reg_start && schedule.reg_end) {
    return `${formatShortDate(schedule.reg_start)} – ${formatShortDate(schedule.reg_end)}`;
  }
  if (schedule.reg_end) return `截至 ${formatShortDate(schedule.reg_end)}`;
  return null;
}

/** Beijing calendar date, used only inside event callbacks. */
export function chinaToday(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
}

export function StagePill({ stage }: { stage: ExamStage }) {
  const meta = computeExamStageLabel(stage);
  return (
    <span className={`exw-stage is-${meta.tone}`}>
      <span className="exw-stage-dot" aria-hidden="true" />
      {meta.label}
    </span>
  );
}
