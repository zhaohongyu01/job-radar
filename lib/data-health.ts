import type { Job, Snapshot, Source } from './jobs.ts';
import { shanghaiDay } from './jobs.ts';

export function latestPublication(jobs: Job[], now: number) {
  const today = shanghaiDay(now);
  return jobs.reduce((latest, job) => {
    const value = job.published_at || '';
    return /^20\d{2}-\d{2}-\d{2}$/.test(value) &&
      value <= today &&
      value > latest
      ? value
      : latest;
  }, '');
}

export function lastListCheck(source: Source) {
  return (
    source.last_list_read_at ||
    source.head_scan_at ||
    ((source.pages ?? 0) > 0 ? source.last_attempt_at : null) ||
    source.last_success_at
  );
}

export function collectionHealth(data: Snapshot, now: number) {
  const checked = data.sources.filter((source) => {
    const stamp = Date.parse(lastListCheck(source) || '');
    return (
      Number.isFinite(stamp) && stamp <= now && now - stamp <= 24 * 3600000
    );
  });
  return {
    total: data.sources.length,
    checked: checked.length,
    incomplete: data.sources.filter((s) =>
      ['failed', 'partial', 'blocked'].includes(s.status || ''),
    ).length,
    pending: data.sources.reduce(
      (sum, source) => sum + (source.pending_details || 0),
      0,
    ),
    latest: latestPublication(data.jobs, now),
  };
}
