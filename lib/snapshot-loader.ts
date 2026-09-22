// Immutable parts are fetched in bounded batches; never display a partial index.
export async function loadSnapshotParts<T>(paths: string[], kind: 'index' | 'search', signal?: AbortSignal): Promise<T[]> {
  const result: T[] = [];
  for (let offset = 0; offset < paths.length; offset += 4) {
    result.push(...await Promise.all(paths.slice(offset, offset + 4).map(async (path) => {
      if (!new RegExp(`^/job-assets/${kind}-[0-9a-f]{20}\\.json$`).test(path)) throw Error('数据分片地址异常。');
      const response = await fetch(path, { cache: 'force-cache', signal });
      if (!response.ok) throw Error('数据分片读取失败，请刷新重试。');
      return await response.json() as T;
    })));
  }
  return result;
}
