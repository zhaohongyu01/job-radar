import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  cardJobTitle,
  sanitizeDisplayExcerpt,
  sanitizeVenueDisplay,
  stripTrailingAtsCode,
} from '../lib/jobs.ts';
import {
  DEFAULT_UNIFIED_PROFILE,
  examProfileToUnified,
  formatUnifiedProfileSummary,
  isUnifiedProfileConfigured,
  jobFiltersToUnified,
  shouldApplyUnifiedSync,
  unifiedToExamProfilePatch,
  unifiedToJobFiltersPatch,
  unifiedToJobFiltersSyncPatch,
  validateUnifiedProfile,
} from '../lib/unified-profile.ts';
import { buildExamPersonalReminders } from '../lib/reminders.ts';
import { buildJobsSqlQuery, queryRadarJobs } from '../lib/server/radar-db.ts';
import { DEFAULT_EXAM_PROFILE, type ExamAnnouncement, type ExamUserProfile } from '../lib/exams.ts';

void test('display sanitizers strip ATS codes, hide placeholder excerpt, and deduplicate venues', () => {
  assert.equal(stripTrailingAtsCode('Java后端研发工程师(J45816)'), 'Java后端研发工程师');
  assert.equal(stripTrailingAtsCode('算法工程师（职位编号：A-102938）'), '算法工程师');
  assert.equal(
    cardJobTitle('浪潮集团·云原生工程师(J10928)', '浪潮集团', '浪潮集团'),
    '云原生工程师',
  );

  assert.equal(sanitizeDisplayExcerpt('单位介绍与岗位说明请查看原公告。'), '');
  assert.equal(
    sanitizeDisplayExcerpt('岗位职责：：负责核心系统开发；；要求本科及以上，，熟悉分布式。'),
    '岗位职责：负责核心系统开发；要求本科及以上，熟悉分布式。',
  );

  assert.equal(
    sanitizeVenueDisplay('山东大学中心校区中心校区知新楼A座', '山东大学'),
    '中心校区知新楼A座',
  );
  assert.equal(sanitizeVenueDisplay('崂山校区 崂山校区第二报告厅'), '崂山校区第二报告厅');
  assert.equal(
    sanitizeVenueDisplay('燕山校区2号教学楼204教室【燕山校区】', '山东财经大学'),
    '燕山校区2号教学楼204教室',
  );
  assert.equal(
    sanitizeVenueDisplay('【山东财经大学】舜耕校区礼堂', '山东财经大学'),
    '舜耕校区礼堂',
  );
});

void test('unified career profile maps cleanly between jobs filters and exam profile', () => {
  const examProf: ExamUserProfile = {
    ...DEFAULT_EXAM_PROFILE,
    education: '硕士研究生',
    hasDegree: true,
    majorCategory: '计算机类',
    majorQuery: '软件工程',
    politicalStatus: '中共党员',
    gradIdentity: '当年应届',
    hukouCity: '济南',
    birthYear: 2001,
  };
  const unified = examProfileToUnified(examProf, ['济南', '青岛']);
  assert.equal(isUnifiedProfileConfigured(unified), true);
  assert.equal(unified.education, '硕士');
  assert.deepEqual(unified.cities, ['济南', '青岛']);
  assert.match(formatUnifiedProfileSummary(unified), /济南、青岛/);

  const jobPatch = unifiedToJobFiltersPatch(unified);
  assert.deepEqual(jobPatch.workCities, ['济南', '青岛']);
  assert.equal(jobPatch.education, '硕士');
  assert.equal(jobPatch.major, '软件工程');
  assert.equal(jobPatch.type, '校招');

  const roundtripUnified = jobFiltersToUnified(
    {
      workCities: ['烟台'],
      city: '烟台',
      education: '本科',
      major: '法学',
      type: '社招',
    },
    unified,
  );
  const examPatch = unifiedToExamProfilePatch(roundtripUnified);
  assert.equal(examPatch.education, '本科');
  assert.equal(examPatch.majorQuery, '法学');
  assert.equal(examPatch.gradIdentity, '在职/社会人员');

  const validated = validateUnifiedProfile({
    cities: ['济南', '全部城市', ''],
    education: '博士',
    majorCategory: '电子信息类',
    majorQuery: '通信工程',
    gradIdentity: '择业期应届',
  });
  assert.deepEqual(validated.cities, ['济南']);
  assert.equal(validated.education, '博士');
});

void test('P2.2 unified profile supports true bidirectional clearing and timestamp watermark sync', () => {
  const initialUnified = examProfileToUnified(
    {
      ...DEFAULT_EXAM_PROFILE,
      education: '硕士研究生',
      majorCategory: '计算机类',
      majorQuery: '软件工程',
      gradIdentity: '择业期应届',
    },
    ['济南', '山东省直', '全国'],
  );
  // Special exam-only scope chips (山东省直 / 全国) are excluded from prefecture workCities
  assert.deepEqual(initialUnified.cities, ['济南']);

  // Preserves 择业期应届 when job workspace stays on 校招, and preserves majorCategory while majorQuery matches
  const keptOnJobs = jobFiltersToUnified(
    { workCities: ['济南'], city: '济南', education: '硕士', major: '软件工程', type: '校招' },
    initialUnified,
  );
  assert.equal(keptOnJobs.gradIdentity, '择业期应届');
  assert.equal(keptOnJobs.majorCategory, '计算机类');

  // Clearing cities, education, major, and type on jobs workspace cleanly clears unified profile
  const clearedFromJobs = jobFiltersToUnified(
    { workCities: [], city: '全部城市', education: '', major: '', type: '全部' },
    keptOnJobs,
  );
  assert.deepEqual(clearedFromJobs.cities, []);
  assert.equal(clearedFromJobs.education, '全部');
  assert.equal(clearedFromJobs.majorCategory, '');
  assert.equal(clearedFromJobs.majorQuery, '');
  assert.equal(clearedFromJobs.gradIdentity, '不限');
  assert.equal(isUnifiedProfileConfigured(clearedFromJobs), false);

  // Sync patch propagates cleared values back onto workspace filters
  const syncPatch = unifiedToJobFiltersSyncPatch(clearedFromJobs);
  assert.deepEqual(syncPatch, {
    workCities: [],
    city: '全部城市',
    education: '',
    major: '',
    type: '全部',
  });

  // Clearing cities to ['全部'] on /exams clears unified cities while undefined preserves existing cities
  const clearedExamCities = examProfileToUnified(DEFAULT_EXAM_PROFILE, ['全部'], initialUnified);
  assert.deepEqual(clearedExamCities.cities, []);
  const preservedExamCities = examProfileToUnified(DEFAULT_EXAM_PROFILE, undefined, initialUnified);
  assert.deepEqual(preservedExamCities.cities, ['济南']);

  // Watermark sync rules: unconfigured without prior sync does not clobber; newer updatedAt triggers sync (including clear)
  assert.equal(shouldApplyUnifiedSync(DEFAULT_UNIFIED_PROFILE, null), false);
  assert.equal(
    shouldApplyUnifiedSync({ ...initialUnified, updatedAt: '2026-11-14T10:00:00Z' }, null),
    true,
  );
  assert.equal(
    shouldApplyUnifiedSync(
      { ...initialUnified, updatedAt: '2026-11-14T10:00:00Z' },
      '2026-11-14T10:00:00Z',
    ),
    false,
  );
  assert.equal(
    shouldApplyUnifiedSync(
      { ...clearedFromJobs, updatedAt: '2026-11-14T11:00:00Z' },
      '2026-11-14T10:00:00Z',
    ),
    true,
  );
});

void test('buildExamPersonalReminders surfaces upcoming registration and written exam milestones', () => {
  const now = Date.parse('2026-11-11T09:00:00+08:00');
  const exams: ExamAnnouncement[] = [
    {
      id: 'ex-1',
      title: '2027山东省属事业单位公开招聘公告',
      organizer: '山东省人社厅',
      region_level: '省级',
      province: '山东',
      cities: ['济南'],
      bianzhi_types: ['事业编'],
      exam_category: '事业单位统考',
      stage: 'registering',
      notice_role: '招考简章',
      total_positions: 45,
      total_headcount: 80,
      schedule: {
        reg_start: '2026-11-08',
        reg_end: '2026-11-13',
        written_exam_date: '2026-11-20',
      },
      exam_subjects: ['公基'],
      exam_ratio: '1:3',
      age_limit: '35周岁以下',
      service_years: null,
      hukou_summary: '不限',
      fresh_grad_summary: '应往届均可',
      political_summary: '不限',
      education_min: '本科及以上',
      degree_summary: '学士',
      has_unlimited_major: false,
      majors: ['计算机科学与技术'],
      registration_url: 'https://hrss.shandong.gov.cn/1',
      registration_method: '网上报名',
      contact_phones: [],
      emails: [],
      source_id: 'sd-hrss',
      source_name: '山东省人社厅',
      source_url: 'https://hrss.shandong.gov.cn/1',
      published_at: '2026-11-05',
      last_verified_at: '2026-11-10',
      excerpt: '摘要',
      positions: [],
    },
  ];
  const reminders = buildExamPersonalReminders(
    exams,
    { 'ex-1': { saved: true, status: 'comparing' } },
    now,
  );
  assert.ok(reminders.length >= 1);
  assert.equal(reminders[0].exam.id, 'ex-1');
  assert.match(reminders[0].label, /考编报名截止/);
});

void test('queryRadarJobs supports portable node:sqlite and graceful static fallback', async () => {
  const fallbackRes = await queryRadarJobs({ q: '测试' }, null);
  assert.deepEqual(fallbackRes, { ok: false, fallback: 'static', reason: 'no_db_binding' });

  process.env.RADAR_SQLITE_PATH = path.resolve(process.cwd(), 'data', 'radar.sqlite');
  const liveRes = await queryRadarJobs({ cities: ['济南'], pageSize: 5 });
  if (liveRes.ok) {
    assert.equal(liveRes.engine, 'sqlite');
    assert.ok(liveRes.total > 0);
    assert.ok(liveRes.jobs.length > 0 && liveRes.jobs.length <= 5);
    assert.ok(liveRes.facets && Object.keys(liveRes.facets.cities).length > 0);
  }

  // Cloudflare D1 mode omits FTS5 shadow table and uses direct INSTR(j.search_text, ?)
  const d1Sql = buildJobsSqlQuery({ q: '后端研发 济南', cities: ['济南'] }, { useFts: false });
  assert.ok(!d1Sql.countSql.includes('jobs_fts'));
  assert.ok(d1Sql.countSql.includes('INSTR(j.search_text, ?) > 0'));
});

void test('cross-workspace navigation uses native anchors instead of broken vinext next/link chunk', () => {
  const files = [
    'components/workspace-switch.tsx',
    'components/bottom-tab-bar.tsx',
    'app/not-found.tsx',
  ];
  for (const rel of files) {
    const src = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf-8');
    assert.ok(
      !src.includes("from 'next/link'") && !src.includes('from "next/link"'),
      `${rel} must not import next/link (Rolldown production bundle mangles navigateClientSide)`,
    );
    assert.match(src, /href="\/exams"/);
    assert.match(src, /href="\/"/);
  }
});
