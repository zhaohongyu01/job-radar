import assert from 'node:assert/strict';
import test from 'node:test';
import { exportExamCalendar, exportPendingDeadlinesCalendar } from '../lib/exam-calendar.ts';
import type { ExamAnnouncement } from '../lib/exams.ts';
import { fixtureJob } from './fixtures/job.ts';

function sampleExam(overrides: Partial<ExamAnnouncement> = {}): ExamAnnouncement {
  return {
    id: 'exam-cal-1',
    title: '2026年山东省属事业单位初级综合类岗位公开招聘工作人员简章,含特别说明;测试折行与转义',
    organizer: '山东省人力资源和社会保障厅',
    region_level: '省级',
    province: '山东',
    cities: ['济南'],
    bianzhi_types: ['事业编'],
    exam_category: '事业单位统考',
    stage: 'registering',
    notice_role: '招考简章',
    total_positions: 10,
    total_headcount: 20,
    schedule: {
      reg_start: '2026-11-05',
      reg_end: '2026-11-15',
      payment_end: '2026-11-17',
      admit_card_start: '2026-11-25',
      written_exam_date: '2026-11-29',
      interview_date: '2026-12-20',
    },
    exam_subjects: ['职测', '综应'],
    hukou_summary: '',
    fresh_grad_summary: '',
    political_summary: '',
    education_min: '本科及以上',
    degree_summary: '',
    has_unlimited_major: true,
    majors: [],
    registration_url: 'https://hrss.shandong.gov.cn/apply',
    registration_method: '网上报名系统',
    source_id: 'sd-hrss-rsks',
    source_name: '山东省人社厅',
    source_url: 'https://hrss.shandong.gov.cn/notice/1.html',
    published_at: '2026-11-01',
    last_verified_at: '2026-11-09',
    excerpt: '',
    ...overrides,
  };
}

void test('exportExamCalendar generates RFC 5545 all-day events with DTSTAMP, VALARMs, escaping, and 75-octet folding', () => {
  const now = Date.parse('2026-11-09T08:00:00Z');
  const ics = exportExamCalendar([sampleExam()], now);

  assert.match(ics, /BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTAMP:20261109T080000Z\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261115\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261117\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261125\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261129\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261220\r\n/);

  // VALARM -P3D and -P1D
  assert.match(ics, /TRIGGER:-P3D\r\n/);
  assert.match(ics, /TRIGGER:-P1D\r\n/);

  // Unfold lines and verify escaping of comma and semicolon
  const unfolded = ics.replace(/\r\n /g, '');
  assert.match(unfolded, /\\,含特别说明\\;测试折行与转义/);

  // Verify every physical line is <= 75 UTF-8 bytes
  for (const line of ics.split('\r\n')) {
    const byteLen = new TextEncoder().encode(line).length;
    assert.ok(byteLen <= 75, `Line exceeded 75 bytes (${byteLen}): ${line}`);
  }
});

void test('exportPendingDeadlinesCalendar exports pending job deadlines with VALARMs and skips null deadlines', () => {
  const now = Date.parse('2026-11-09T08:00:00Z');
  const jobs = [
    fixtureJob({
      id: 'aa000000000000000001',
      company: '浪潮集团',
      title: '2027届校园招聘',
      deadline: '2026-11-20T23:59:59+08:00',
      application_url: 'https://join.inspur.com',
    }),
    fixtureJob({
      id: 'aa000000000000000002',
      company: '无截止企业',
      title: '长期招聘',
      deadline: null,
    }),
  ];

  const ics = exportPendingDeadlinesCalendar(jobs, now);
  assert.match(ics, /UID:job-deadline-aa000000000000000001@job-radar\.local\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261120\r\n/);
  assert.match(ics, /TRIGGER:-P3D\r\n/);
  assert.match(ics, /TRIGGER:-P1D\r\n/);
  assert.doesNotMatch(ics, /aa000000000000000002/);
});
