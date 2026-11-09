export type RumType = 'error' | 'vital' | 'event';
export type RumPage = '/' | '/exams';

export interface RumPayload {
  type: RumType;
  name: string;
  value?: number;
  page: RumPage;
  ts: number;
}

const RUM_TYPES = new Set<string>(['error', 'vital', 'event']);
const RUM_PAGES = new Set<string>(['/', '/exams']);
export const RUM_SAMPLE_STORAGE_KEY = 'job-radar-rum-sample-v1';
export const RUM_VITAL_EVENT_SAMPLE_RATE = 0.2;

let fallbackSessionRoll: number | null = null;

export function resolveRumPage(pathname?: string): RumPage {
  return pathname?.startsWith('/exams') ? '/exams' : '/';
}

export function validateRumPayload(input: unknown): RumPayload | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.type !== 'string' || !RUM_TYPES.has(raw.type)) return null;
  if (typeof raw.name !== 'string') return null;
  const cleanName = raw.name.replace(/[\r\n\t]+/g, ' ').trim();
  if (cleanName.length === 0 || cleanName.length > 60) return null;
  if (typeof raw.page !== 'string' || !RUM_PAGES.has(raw.page)) return null;
  if (typeof raw.ts !== 'number' || !Number.isFinite(raw.ts) || raw.ts <= 0) return null;

  let cleanValue: number | undefined;
  if (raw.value !== undefined) {
    if (typeof raw.value !== 'number' || !Number.isFinite(raw.value)) return null;
    cleanValue = raw.value;
  }

  return {
    type: raw.type as RumType,
    name: cleanName,
    ...(cleanValue !== undefined ? { value: cleanValue } : {}),
    page: raw.page as RumPage,
    ts: raw.ts,
  };
}

export function shouldSample(
  type: RumType,
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null,
  randomFn: () => number = Math.random,
): boolean {
  if (type === 'error') return true;
  const targetStorage =
    storage !== undefined
      ? storage
      : typeof window !== 'undefined'
        ? window.sessionStorage
        : null;

  let roll: number | null = null;
  if (targetStorage) {
    try {
      const existing = targetStorage.getItem(RUM_SAMPLE_STORAGE_KEY);
      if (existing !== null) {
        const parsed = Number(existing);
        if (Number.isFinite(parsed) && parsed >= 0 && parsed < 1) {
          roll = parsed;
        }
      }
      if (roll === null) {
        roll = randomFn();
        targetStorage.setItem(RUM_SAMPLE_STORAGE_KEY, String(roll));
      }
    } catch {
      roll = null;
    }
  }

  if (roll === null) {
    if (fallbackSessionRoll === null) {
      fallbackSessionRoll = randomFn();
    }
    roll = fallbackSessionRoll;
  }

  return roll < RUM_VITAL_EVENT_SAMPLE_RATE;
}

export function report(type: RumType, name: string, value?: number): void {
  if (typeof window === 'undefined') return;
  try {
    const safeName = String(name || '')
      .replace(/[\r\n\t]+/g, ' ')
      .trim()
      .slice(0, 60);
    if (!safeName) return;
    if (!shouldSample(type)) return;

    const payload: RumPayload = {
      type,
      name: safeName,
      ...(typeof value === 'number' && Number.isFinite(value)
        ? { value: Math.round(value * 10000) / 10000 }
        : {}),
      page: resolveRumPage(window.location.pathname),
      ts: Date.now(),
    };
    const body = JSON.stringify(payload);
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const sent = navigator.sendBeacon(
        '/api/rum',
        new Blob([body], { type: 'application/json' }),
      );
      if (sent) return;
    }
    if (typeof fetch === 'function') {
      void fetch('/api/rum', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // Telemetry must never interrupt user interaction.
  }
}
