import type { Filters, Job } from './jobs.ts';
import { restoreBrowsing } from './browsing.ts';
import { getDeadlineCountdown, hasRecentJobChange, parseSalaryRange, isTodayOpportunity, isSupplementOpportunity } from './jobs.ts';

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
    name: '全国 · 银行机会',
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
      return parsed.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && p.filters)
        .map((p) => ({ ...p, filters: restoreBrowsing({ filters: p.filters }).filters }));
    }
  } catch {
    // fallback
  }
  return DEFAULT_RADAR_PRESETS;
}

export function saveRadarPresets(presets: RadarPreset[]): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(RADAR_PRESETS_STORAGE, JSON.stringify(presets));
    return true;
  } catch {
    return false;
  }
}

export function computeRadarMetrics(jobs: Job[], now = Date.now()): RadarMetrics {
  let todayCount = 0;
  let supplementCount = 0;
  let urgentCount = 0;
  let highSalaryCount = 0;
  let changeCount = 0;

  for (const job of jobs) {
    if (isTodayOpportunity(job, now)) {
      todayCount++;
    }
    if (isSupplementOpportunity(job)) {
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
