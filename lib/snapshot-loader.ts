import type { Job, Snapshot } from './jobs.ts';
import { validateBrowsingJob } from './browse-index.ts';

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
    const currentBatchSize = (offset === 0 && onProgress && paths.length > 1) ? 1 : 4;
    const batchPaths = paths.slice(offset, offset + currentBatchSize);
    const batch = await Promise.all(batchPaths.map(async (path) => {
      if (!new RegExp(`^/job-assets/${kind}-[0-9a-f]{20}\\.json$`).test(path)) throw Error('数据分片地址异常。');
      const response = await fetch(path, { cache: 'force-cache', signal });
      if (!response.ok) throw Error('数据分片读取失败，请刷新重试。');
      return await response.json() as T;
    }));
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
): Promise<Job[]> {
  const browse = snapshot.browse_index?.version === 1 ? snapshot.browse_index : undefined;
  const expected = browse?.count ?? snapshot.index_count;
  const paths = browse?.shards ?? snapshot.index_shards;
  if (!Number.isSafeInteger(expected) || expected! < 1 || !paths?.length || (browse && !browse.search_shards?.length))
    throw Error('招聘数据索引声明异常。');
  const seen = new Set<string>();
  const accumulated: Job[] = [];
  await loadSnapshotParts<{ jobs: Job[] }>(paths, 'index', signal, (batch) => {
    const incoming: Job[] = [];
    const batchIds = new Set<string>();
    for (const part of batch) {
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
    for (const id of batchIds) seen.add(id);
    accumulated.push(...incoming);
    onPreview?.([...accumulated], expected!);
  });
  if (accumulated.length !== expected) throw Error('招聘数据分片不完整，请刷新重试。');
  return accumulated;
}
