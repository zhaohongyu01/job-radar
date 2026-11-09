import { fold, stamp, text } from './calendar-export.ts';
import type { ExamAnnouncement } from './exams.ts';
import { shanghaiDay } from './jobs.ts';
import type { Job } from './jobs.ts';

export type DateCalendarItem = {
  uid: string;
  date: string;
  summary: string;
  description: string;
};

export function exportDateReminderCalendar(
  items: DateCalendarItem[],
  now: number,
  prodId = '-//Job Radar//Civil Exam Calendar//ZH',
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${prodId}`,
    'CALSCALE:GREGORIAN',
  ];

  const dtstamp = stamp(now);
  const seenUids = new Set<string>();

  for (const item of items) {
    if (!item.date || !/^20\d{2}-\d{2}-\d{2}$/.test(item.date)) continue;
    if (new Date(`${item.date}T00:00:00Z`).toISOString().slice(0, 10) !== item.date) continue;
    if (seenUids.has(item.uid)) continue;
    seenUids.add(item.uid);

    const dayCompact = item.date.replaceAll('-', '');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${text(item.uid)}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${dayCompact}`,
      `SUMMARY:${text(item.summary)}`,
      `DESCRIPTION:${text(item.description)}`,
      'STATUS:CONFIRMED',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${text(`提前3天提醒：${item.summary}`)}`,
      'TRIGGER:-P3D',
      'END:VALARM',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${text(`提前1天提醒：${item.summary}`)}`,
      'TRIGGER:-P1D',
      'END:VALARM',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function downloadIcsContent(ics: string, filename: string): void {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const SCHEDULE_EVENT_DEFS: {
  field: 'reg_end' | 'payment_end' | 'admit_card_start' | 'written_exam_date' | 'interview_date';
  label: string;
}[] = [
  { field: 'reg_end', label: '报名截止' },
  { field: 'payment_end', label: '缴费确认截止' },
  { field: 'admit_card_start', label: '准考证打印开始' },
  { field: 'written_exam_date', label: '笔试' },
  { field: 'interview_date', label: '面试' },
];

export function exportExamCalendar(exams: ExamAnnouncement[], now: number): string {
  const items: DateCalendarItem[] = [];
  for (const exam of exams) {
    const s = exam.schedule || {};
    for (const def of SCHEDULE_EVENT_DEFS) {
      const rawDate = s[def.field];
      if (!rawDate || !/^20\d{2}-\d{2}-\d{2}/.test(rawDate)) continue;
      const dateStr = rawDate.slice(0, 10);
      const descParts = [
        `招录机关：${exam.organizer}`,
        `事项：${def.label}（${dateStr}）`,
        exam.registration_url ? `报名入口：${exam.registration_url}` : '',
        `原公告：${exam.source_url}`,
      ].filter(Boolean);
      items.push({
        uid: `exam-${exam.id}-${def.field}@job-radar.local`,
        date: dateStr,
        summary: `【${def.label}】${exam.title}`,
        description: descParts.join('\n'),
      });
    }
  }
  return exportDateReminderCalendar(items, now, '-//Job Radar//Civil Exam Calendar//ZH');
}

export function downloadExamCalendar(
  exams: ExamAnnouncement[],
  now: number,
  filename = '考公考编-我的考试日历.ics',
): void {
  downloadIcsContent(exportExamCalendar(exams, now), filename);
}

export function exportPendingDeadlinesCalendar(jobs: Job[], now: number): string {
  const items: DateCalendarItem[] = [];
  for (const job of jobs) {
    if (!job.deadline) continue;
    const dateStr = shanghaiDay(job.deadline);
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(dateStr)) continue;
    const descParts = [
      `招聘企业：${job.company}`,
      `岗位标题：${job.title}`,
      `截止日期：${dateStr}`,
      job.application_url ? `投递入口：${job.application_url}` : '',
      `原公告：${job.source_url}`,
    ].filter(Boolean);
    items.push({
      uid: `job-deadline-${job.id}@job-radar.local`,
      date: dateStr,
      summary: `【投递截止】${job.company} · ${job.title}`,
      description: descParts.join('\n'),
    });
  }
  return exportDateReminderCalendar(items, now, '-//Job Radar//Pending Deadlines//ZH');
}

export function downloadPendingDeadlinesCalendar(
  jobs: Job[],
  now: number,
  filename = '职讯雷达-待投递截止日.ics',
): void {
  downloadIcsContent(exportPendingDeadlinesCalendar(jobs, now), filename);
}
