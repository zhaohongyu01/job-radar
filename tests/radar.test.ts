import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeRadarMetrics,
  DEFAULT_RADAR_PRESETS,
  loadRadarPresets,
} from '../lib/radar.ts';
import { defaultFilters, filterJobs } from '../lib/jobs.ts';
import type { Job } from '../lib/jobs.ts';

const baseJob: Job = {
  id: 'test-1',
  title: '某央企2027校园招聘',
  company: '某央企集团',
  source_id: 'sdu',
  source_name: '山东大学就业信息网',
  source_url: 'https://example.com/job',
  published_at: '2026-09-01',
  first_seen_at: '2026-09-01T08:00:00+08:00',
  updated_at: '2026-09-01T08:00:00+08:00',
  last_verified_at: '2026-09-01T08:00:00+08:00',
  kind: '招聘公告',
  types: ['校招'],
  graduation_years: ['2027'],
  sectors: ['国企'],
  directions: ['技术 / 研发'],
  cities: ['济南'],
  location_evidence: ['工作地点：济南'],
  education: '本科',
  deadline: '2026-10-31T23:59:59+08:00',
  deadline_precision: 'day',
  application_url: 'https://example.com/apply',
  excerpt: '薪资待遇：12000-18000元/月',
  revision: 1,
};

void test('DEFAULT_RADAR_PRESETS and loadRadarPresets return sensible defaults', () => {
  assert.ok(DEFAULT_RADAR_PRESETS.length >= 2);
  const loaded = loadRadarPresets();
  assert.ok(loaded.length >= 2);
  const jnPreset = loaded.find((p) => p.name.includes('济南'));
  assert.ok(jnPreset);
  assert.equal(jnPreset.filters.city, '济南');
});

void test('computeRadarMetrics correctly calculates today, supplement, urgent, and highSalary counts', () => {
  const now = Date.parse('2026-09-14T12:00:00+08:00');

  const todayJob = {
    ...baseJob,
    id: 'today-1',
    published_at: '2026-09-14',
    first_seen_at: '2026-09-14T08:00:00+08:00',
  };
  const suppJob = {
    ...baseJob,
    id: 'supp-1',
    title: '字节跳动2027秋招补录公告',
    published_at: '2026-09-10',
    deadline: '2026-10-15T23:59:59+08:00',
  };
  const urgentJob = {
    ...baseJob,
    id: 'urgent-1',
    title: '即将截止岗位',
    published_at: '2026-09-01',
    deadline: '2026-09-15T23:59:59+08:00', // 1 day left
  };
  const normalJob = {
    ...baseJob,
    id: 'normal-1',
    title: '普通招聘',
    published_at: '2026-09-01',
    deadline: '2026-10-30T23:59:59+08:00',
    excerpt: '薪资面议',
  };

  const metrics = computeRadarMetrics([todayJob, suppJob, urgentJob, normalJob], now);

  assert.equal(metrics.todayCount, 1, '今日新发应为 1');
  assert.equal(metrics.supplementCount, 1, '新开补录应为 1');
  assert.equal(metrics.urgentCount, 1, '3天内截止应为 1');
  assert.equal(metrics.highSalaryCount, 3, '薪资 >= 10k 应为 3');
});

void test('filterJobs accurately filters by radarFocus (today, supplement, urgent, change) matching metrics', () => {
  const now = Date.parse('2026-09-14T12:00:00+08:00');
  const todayJob = {
    ...baseJob,
    id: 'today-1',
    published_at: '2026-09-14',
    first_seen_at: '2026-09-14T08:00:00+08:00',
  };
  const suppJob = {
    ...baseJob,
    id: 'supp-1',
    title: '字节跳动2027秋招补录公告',
    published_at: '2026-09-10',
    deadline: '2026-10-15T23:59:59+08:00',
  };
  const urgentJob = {
    ...baseJob,
    id: 'urgent-1',
    title: '即将截止岗位',
    published_at: '2026-09-01',
    deadline: '2026-09-15T23:59:59+08:00', // 1 day left
  };
  const changeJob = {
    ...baseJob,
    id: 'change-1',
    title: '某央企招聘考核安排通知',
    published_at: '2026-09-01',
    recent_change: {
      type: 'selection_stage' as const,
      label: '考核阶段',
      detail: '笔试面试安排已发布',
      date: '2026-09-14',
    },
  };
  const normalJob = {
    ...baseJob,
    id: 'normal-1',
    title: '普通招聘',
    published_at: '2026-09-01',
    deadline: '2026-10-30T23:59:59+08:00',
  };

  const pool = [todayJob, suppJob, urgentJob, changeJob, normalJob];
  const personal = {};

  const todayFiltered = filterJobs(pool, { ...defaultFilters, radarFocus: 'today' }, personal, null, now);
  assert.equal(todayFiltered.length, 1);
  assert.equal(todayFiltered[0].id, 'today-1');

  const suppFiltered = filterJobs(pool, { ...defaultFilters, radarFocus: 'supplement' }, personal, null, now);
  assert.equal(suppFiltered.length, 1);
  assert.equal(suppFiltered[0].id, 'supp-1');

  const urgentFiltered = filterJobs(pool, { ...defaultFilters, radarFocus: 'urgent' }, personal, null, now);
  assert.equal(urgentFiltered.length, 1);
  assert.equal(urgentFiltered[0].id, 'urgent-1');

  const changeFiltered = filterJobs(pool, { ...defaultFilters, radarFocus: 'change' }, personal, null, now);
  assert.equal(changeFiltered.length, 2); // changeJob and suppJob

  const noneFiltered = filterJobs(pool, { ...defaultFilters, radarFocus: 'none' }, personal, null, now);
  assert.equal(noneFiltered.length, 5);
});
