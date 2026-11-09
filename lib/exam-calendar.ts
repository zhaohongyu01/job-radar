import { fold, stamp, text } from './calendar-export.ts';
import type { ExamAnnouncement } from './exams.ts';

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
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Job Radar//Civil Exam Calendar//ZH',
    'CALSCALE:GREGORIAN',
  ];

  const dtstamp = stamp(now);
  const seenUids = new Set<string>();

  for (const exam of exams) {
    const s = exam.schedule || {};
    for (const def of SCHEDULE_EVENT_DEFS) {
      const rawDate = s[def.field];
      if (!rawDate || !/^20\d{2}-\d{2}-\d{2}/.test(rawDate)) continue;
      const dateStr = rawDate.slice(0, 10);
      if (new Date(`${dateStr}T00:00:00Z`).toISOString().slice(0, 10) !== dateStr) continue;

      const uid = `exam-${exam.id}-${def.field}@job-radar.local`;
      if (seenUids.has(uid)) continue;
      seenUids.add(uid);

      const dayCompact = dateStr.replaceAll('-', '');
      const summary = `【${def.label}】${exam.title}`;
      const descParts = [
        `招录机关：${exam.organizer}`,
        `事项：${def.label}（${dateStr}）`,
        exam.registration_url ? `报名入口：${exam.registration_url}` : '',
        `原公告：${exam.source_url}`,
      ].filter(Boolean);

      lines.push(
        'BEGIN:VEVENT',
        `UID:${text(uid)}`,
        `DTSTAMP:${dtstamp}`,
        `DTSTART;VALUE=DATE:${dayCompact}`,
        `SUMMARY:${text(summary)}`,
        `DESCRIPTION:${text(descParts.join('\n'))}`,
        'STATUS:CONFIRMED',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${text(`提前3天提醒：${summary}`)}`,
        'TRIGGER:-P3D',
        'END:VALARM',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${text(`提前1天提醒：${summary}`)}`,
        'TRIGGER:-P1D',
        'END:VALARM',
        'END:VEVENT',
      );
    }
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function downloadExamCalendar(
  exams: ExamAnnouncement[],
  now: number,
  filename = '考公考编-我的考试日历.ics',
): void {
  const ics = exportExamCalendar(exams, now);
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
