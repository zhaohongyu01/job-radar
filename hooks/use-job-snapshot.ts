'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { loadIndexSnapshot, supportedBrowseIndex } from '@/lib/snapshot-loader';
import type { SnapshotIndexCache } from '@/lib/snapshot-loader';
import {
  buildSnapshotCacheSignature,
  readCachedSnapshotJobs,
  writeCachedSnapshotJobs,
} from '@/lib/snapshot-idb';
import type { RadarJobFacets, RadarJobsQueryResponse } from '@/lib/server/radar-db';
import type { Snapshot } from '@/lib/jobs';
import type { CoverageReport } from '@/lib/city-coverage';

export interface UseJobSnapshotOptions {
  onActivateSnapshot?: (snapshot: Snapshot | null) => void;
  onPartial?: (loaded: number, total: number) => void;
}

export interface UseJobSnapshotResult {
  data: Snapshot | null;
  previewData: Snapshot | null;
  loading: boolean;
  error: string;
  progress: { loaded: number; total: number } | null;
  serverFacets: RadarJobFacets | null;
  refresh: () => Promise<void>;
  refreshIfIdle: () => void;
  dataOrigin: string;
  coverage: CoverageReport | null;
  getActiveSnapshot: () => Snapshot | null;
  isCurrentData: (candidate: Snapshot | null) => boolean;
}

async function fetchColdStartPreview(signal: AbortSignal): Promise<RadarJobsQueryResponse | null> {
  try {
    const staticRes = await fetch('/first-screen.json', { cache: 'no-cache', signal });
    if (staticRes.ok) {
      const payload = (await staticRes.json()) as RadarJobsQueryResponse;
      if (payload && payload.ok) return payload;
    }
  } catch {
    if (signal.aborted) return null;
  }
  try {
    const apiRes = await fetch('/api/query/jobs?page=1&pageSize=20', { signal });
    if (apiRes.ok) {
      return (await apiRes.json()) as RadarJobsQueryResponse;
    }
  } catch {
    /* Optional preview — full shard loader handles actual state */
  }
  return null;
}

export function useJobSnapshot({
  onActivateSnapshot,
  onPartial,
}: UseJobSnapshotOptions = {}): UseJobSnapshotResult {
  const [data, setData] = useState<Snapshot | null>(null);
  const [previewData, setPreviewData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [serverFacets, setServerFacets] = useState<RadarJobFacets | null>(null);
  const [dataOrigin, setDataOrigin] = useState('site');
  const [coverageReport, setCoverageReport] = useState<CoverageReport | null>(null);

  const dataRef = useRef<Snapshot | null>(null);
  const indexCache = useRef<SnapshotIndexCache | null>(null);
  const activeSnapshot = useRef<Snapshot | null>(null);
  const refreshController = useRef<AbortController | null>(null);
  const refreshRequest = useRef(0);

  const activateSnapshot = useCallback(
    (snapshot: Snapshot | null) => {
      activeSnapshot.current = snapshot;
      onActivateSnapshot?.(snapshot);
    },
    [onActivateSnapshot],
  );

  const refresh = useCallback(async () => {
    const request = ++refreshRequest.current;
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    const current = () => request === refreshRequest.current && !controller.signal.aborted;
    let previewActivated = false;
    setLoading(true);
    setError('');
    setProgress(null);
    setPreviewData(null);
    if (!dataRef.current) activateSnapshot(null);
    try {
      const edgeQueryPromise: Promise<RadarJobsQueryResponse | null> = !dataRef.current
        ? fetchColdStartPreview(controller.signal)
        : Promise.resolve(null);

      const r = await fetch('/jobs.json', { cache: 'no-store', signal: controller.signal });
      if (!r.ok) throw Error('招聘信息暂时无法读取，请稍后重试。');
      const origin =
        r.headers.get('x-job-radar-data-origin') ||
        (['localhost', '127.0.0.1'].includes(window.location.hostname) ? 'local' : 'site');
      const json = (await r.json()) as Snapshot;
      if (
        !json ||
        ![1, 2, 3].includes(json.schema_version) ||
        !Array.isArray(json.jobs) ||
        !Array.isArray(json.sources)
      ) {
        throw Error('招聘数据格式异常。');
      }
      if (json.index_shards?.length || supportedBrowseIndex(json)) {
        const signature = buildSnapshotCacheSignature(json);
        const cachedJobs = await readCachedSnapshotJobs(signature);
        if (cachedJobs && cachedJobs.length > 0) {
          json.jobs = cachedJobs;
          void edgeQueryPromise.then((edgeRes) => {
            if (current() && edgeRes?.ok && edgeRes.generated_at === json.generated_at && edgeRes.facets) {
              setServerFacets(edgeRes.facets);
            }
          });
        } else {
          void edgeQueryPromise.then((edgeRes) => {
            if (
              !current() ||
              dataRef.current ||
              !edgeRes?.ok ||
              edgeRes.generated_at !== json.generated_at ||
              edgeRes.jobs.length === 0
            ) {
              return;
            }
            if (edgeRes.facets) setServerFacets(edgeRes.facets);
            if (!previewActivated) {
              activateSnapshot(json);
              previewActivated = true;
              setPreviewData({ ...json, jobs: edgeRes.jobs });
            }
          });

          json.jobs = await loadIndexSnapshot(
            json,
            controller.signal,
            (jobs, total) => {
              if (!current()) return;
              setProgress({ loaded: jobs.length, total });
              if (!dataRef.current) {
                if (!previewActivated) {
                  activateSnapshot(json);
                  previewActivated = true;
                }
                setPreviewData({ ...json, jobs });
              }
            },
            indexCache,
          );
          if (!json.partial && json.jobs.length > 0) {
            void writeCachedSnapshotJobs(signature, json.jobs);
          }
        }
      } else {
        void edgeQueryPromise.then((edgeRes) => {
          if (current() && edgeRes?.ok && edgeRes.generated_at === json.generated_at && edgeRes.facets) {
            setServerFacets(edgeRes.facets);
          }
        });
      }
      if (!current()) return;
      if (new Set(json.jobs.map((job) => job.id)).size !== json.jobs.length) {
        throw Error('招聘数据包含重复记录。');
      }
      // A successful legacy inline snapshot replaces the sharded generation too.
      if (!json.index_shards?.length && !supportedBrowseIndex(json)) indexCache.current = null;
      if (!previewActivated) activateSnapshot(json);
      // A cold preview and its completed index share one detail-request generation.
      dataRef.current = json;
      setDataOrigin(origin);
      setData(json);
      setPreviewData(null);
      if (json.partial && json.partial_total) {
        onPartial?.(json.jobs.length, json.partial_total);
      }
    } catch (e) {
      if (!current()) return;
      setPreviewData(null);
      if (previewActivated) activateSnapshot(null);
      setError(e instanceof Error ? e.message : '读取失败');
    } finally {
      if (current()) {
        setProgress(null);
        setLoading(false);
        refreshController.current = null;
      }
    }
  }, [activateSnapshot, onPartial]);

  const refreshIfIdle = useCallback(() => {
    if (!dataRef.current && !refreshController.current) {
      void refresh();
    }
  }, [refresh]);

  const getActiveSnapshot = useCallback(() => activeSnapshot.current, []);
  const isCurrentData = useCallback((candidate: Snapshot | null) => candidate === dataRef.current, []);

  useEffect(() => {
    return () => {
      refreshController.current?.abort();
    };
  }, []);

  useEffect(() => {
    const url = data?.coverage_url;
    if (!url || !/^\/job-assets\/coverage-[0-9a-f]{20}\.json$/.test(url)) return;
    const controller = new AbortController();
    void fetch(url, { cache: 'force-cache', signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw Error('Coverage unavailable');
        const report = (await response.json()) as CoverageReport;
        if (report.schema_version !== 1 || !report.cities || !Array.isArray(report.schools)) {
          throw Error('Coverage format invalid');
        }
        setCoverageReport(report);
      })
      .catch(() => {
        /* Coverage failures do not hide a complete jobs index. */
      });
    return () => controller.abort();
  }, [data?.coverage_url]);

  const coverage = coverageReport?.as_of === data?.generated_at ? coverageReport : null;

  return {
    data,
    previewData,
    loading,
    error,
    progress,
    serverFacets,
    refresh,
    refreshIfIdle,
    dataOrigin,
    coverage,
    getActiveSnapshot,
    isCurrentData,
  };
}
