import type { Filters, Job } from './jobs.ts';
import { getDeadlineCountdown, hasRecentJobChange, parseSalaryRange } from './jobs.ts';

export type RadarPreset = {
  id: string;
  name: string;
  filters: Partial<Filters>;
  createdAt: string;
};

export type RadarMetrics = {
  todayCount: number;
  supplementCount: number;
  urgentCount: number;
  highSalaryCount: number;
  changeCount: number;
};

export const RADAR_PRESETS_STORAGE = 'job-radar-presets-v1';
export const RADAR_ACTIVE_PRESET_STORAGE = 'job-radar-active-preset-v1';

export const DEFAULT_RADAR_PRESETS: RadarPreset[] = [
  {
    id: 'preset-jn-2027',
    name: '济南 · 2027届校招',
    filters: {
      city: '济南',
      year: '2027',
      type: '校招',
      locationScope: 'exact',
    },
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'preset-qd-tech',
    name: '青岛 · 研发技术',
    filters: {
      city: '青岛',
      year: '2027',
      direction: '技术 / 研发',
      locationScope: 'exact',
    },
    createdAt: '2026-09-01T00:00:00.000Z',
  },
  {
    id: 'preset-sd-finance',
    name: '全省 · 国企银行',
    filters: {
      city: '全部城市',
      sector: '银行',
      locationScope: 'possible',
    },
    createdAt: '2026-09-01T00:00:00.000Z',
  },
];

export function loadRadarPresets(): RadarPreset[] {
  if (typeof window === 'undefined') return DEFAULT_RADAR_PRESETS;
  try {
    const raw = window.localStorage.getItem(RADAR_PRESETS_STORAGE);
    if (!raw) return DEFAULT_RADAR_PRESETS;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && p.filters);
    }
  } catch {
    // fallback
  }
  return DEFAULT_RADAR_PRESETS;
}

export function saveRadarPresets(presets: RadarPreset[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RADAR_PRESETS_STORAGE, JSON.stringify(presets));
  } catch {
    // ignore
  }
}

export function computeRadarMetrics(jobs: Job[], now = Date.now()): RadarMetrics {
  const todayStr = new Date(now).toLocaleString('en-CA', { timeZone: 'Asia/Shanghai' }).slice(0, 10);

  let todayCount = 0;
  let supplementCount = 0;
  let urgentCount = 0;
  let highSalaryCount = 0;
  let changeCount = 0;

  for (const job of jobs) {
    if (job.published_at === todayStr || job.first_seen_at?.slice(0, 10) === todayStr) {
      todayCount++;
    }
    if (/补录|补招|追加|第[二两三]批|春招补录|秋招补录|续聘/.test(job.title)) {
      supplementCount++;
    }
    const countdown = getDeadlineCountdown(job.deadline, now);
    if (countdown && countdown.urgency === 'urgent') {
      urgentCount++;
    }
    const sal = parseSalaryRange(job);
    if (sal && sal.min >= 10000) {
      highSalaryCount++;
    }
    if (hasRecentJobChange(job, now)) {
      changeCount++;
    }
  }

  return {
    todayCount,
    supplementCount,
    urgentCount,
    highSalaryCount,
    changeCount,
  };
}
