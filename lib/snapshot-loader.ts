import type { Job, Snapshot } from './jobs.ts';
import { validateBrowsingJob } from './browse-index.ts';

/** One validated immutable index per page, sharing the same jobs array already
 * held by the view. A new snapshot never accumulates a second retained cache. */
export type SnapshotIndexCache = { signature: string; jobs: Job[] };

export function supportedBrowseIndex(snapshot: Pick<Snapshot, 'browse_index'>): Snapshot['browse_index'] {
  return snapshot.browse_index && [1, 2].includes(snapshot.browse_index.version) ? snapshot.browse_index : undefined;
}

async function fetchShardWithRetry<T>(
  path: string,
  kind: 'index' | 'search',
  signal?: AbortSignal,
  allowRetry = false,
): Promise<T> {
  if (!new RegExp(`^/job-assets/${kind}-[0-9a-f]{20}\\.json$`).test(path)) {
    throw Error('数据分片地址异常。');
  }
  const maxAttempts = allowRetry ? 2 : 1;
  let lastNetworkErr: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    signal?.throwIfAborted();
    let response: Response;
    try {
      response = await fetch(path, { cache: 'force-cache', signal });
    } catch (err) {
      if (signal?.aborted || (err as Error)?.name === 'AbortError') throw err;
      lastNetworkErr = Error('数据分片读取失败，请刷新重试。');
      continue;
    }
    if (!response.ok) {
      lastNetworkErr = Error('数据分片读取失败，请刷新重试。');
      continue;
    }
    return (await response.json()) as T;
  }
  throw lastNetworkErr ?? Error('数据分片读取失败，请刷新重试。');
}

// Preview callbacks must validate before publishing; their errors abort the load.
export async function loadSnapshotParts<T>(
  paths: string[],
  kind: 'index' | 'search',
  signal?: AbortSignal,
  onProgress?: (batch: T[], loadedParts: number, totalParts: number) => void,
): Promise<T[]> {
  const result: T[] = [];
  let offset = 0;
  while (offset < paths.length) {
    // If progress callback is provided, fetch the 1st shard with top priority for immediate render
    const currentBatchSize = offset === 0 && onProgress && paths.length > 1 ? 1 : 4;
    const batchPaths = paths.slice(offset, offset + currentBatchSize);
    const batch = await Promise.all(
      batchPaths.map((path) => fetchShardWithRetry<T>(path, kind, signal, false)),
    );
    result.push(...batch);
    offset += currentBatchSize;
    signal?.throwIfAborted();
    onProgress?.(batch, result.length, paths.length);
  }
  return result;
}

export async function loadIndexSnapshot(
  snapshot: Snapshot,
  signal?: AbortSignal,
  onPreview?: (jobs: Job[], total: number) => void,
  cache?: { current: SnapshotIndexCache | null },
): Promise<Job[]> {
  const browse = supportedBrowseIndex(snapshot);
  const expected = browse?.count ?? snapshot.index_count;
  const paths = browse?.shards ?? snapshot.index_shards;
  if (!Number.isSafeInteger(expected) || expected! < 1 || !paths?.length || (browse && !browse.search_shards?.length))
    throw Error('招聘数据索引声明异常。');
  const signature = JSON.stringify([browse?.version || 0, expected, paths]);
  signal?.throwIfAborted();
  if (cache?.current?.signature === signature) return cache.current.jobs;
  const seen = new Set<string>();
  const accumulated: Job[] = [];
  let hadNetworkFailure = false;
  let offset = 0;
  while (offset < paths.length) {
    const currentBatchSize = offset === 0 && onPreview && paths.length > 1 ? 1 : 4;
    const batchPaths = paths.slice(offset, offset + currentBatchSize);
    const settled = await Promise.all(
      batchPaths.map(async (path) => {
        try {
          const part = await fetchShardWithRetry<{ jobs: Job[] }>(path, 'index', signal, true);
          return { ok: true as const, part };
        } catch (err) {
          if (signal?.aborted || (err as Error)?.name === 'AbortError') throw err;
          if ((err as Error)?.message === '数据分片地址异常。') throw err;
          if ((err as Error)?.message === '数据分片读取失败，请刷新重试。') {
            return { ok: false as const, error: err as Error };
          }
          // JSON SyntaxError from malformed response payload is a validation error, not network tolerance
          throw Error('招聘数据分片格式异常。');
        }
      }),
    );
    offset += currentBatchSize;
    signal?.throwIfAborted();

    const incoming: Job[] = [];
    const batchIds = new Set<string>();
    for (const item of settled) {
      if (!item.ok) {
        hadNetworkFailure = true;
        continue;
      }
      const part = item.part;
      if (!part || !Array.isArray(part.jobs)) throw Error('招聘数据分片格式异常。');
      for (const job of part.jobs) {
        if (!job || typeof job.id !== 'string' || !job.id || seen.has(job.id) || batchIds.has(job.id))
          throw Error('招聘数据分片不完整或包含重复记录。');
        if (browse) validateBrowsingJob(job);
        batchIds.add(job.id);
        incoming.push(job);
      }
    }
    if (accumulated.length + incoming.length > expected!) throw Error('招聘数据分片数量异常。');
    if (incoming.length > 0) {
      for (const id of batchIds) seen.add(id);
      accumulated.push(...incoming);
      onPreview?.([...accumulated], expected!);
    }
  }
  signal?.throwIfAborted();
  if (hadNetworkFailure) {
    if (accumulated.length === 0) throw Error('数据分片读取失败，请刷新重试。');
    snapshot.partial = true;
    snapshot.partial_total = expected!;
    return accumulated;
  }
  if (accumulated.length !== expected) throw Error('招聘数据分片不完整，请刷新重试。');
  snapshot.partial = undefined;
  snapshot.partial_total = undefined;
  if (cache) cache.current = { signature, jobs: accumulated };
  return accumulated;
}
