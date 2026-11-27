'use client';

import { useCallback, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { resolveJobId } from '@/lib/jobs';
import type { Job, Snapshot } from '@/lib/jobs';
import { findMissingSiblingIds, mergeDetailRecords } from '@/lib/job-sources';
import { report } from '@/lib/rum';

export interface OpenDetailOptions {
  focusChannels?: boolean;
  channelKey?: string | null;
}

export interface UseJobDetailOptions {
  markRead: (job: Job) => void;
  onNotice: (message: string) => void;
}

export interface UseJobDetailState {
  selected: Job | null;
  linkedJobId: string | null;
  setLinkedJobId: Dispatch<SetStateAction<string | null>>;
  detailLoading: boolean;
  detailError: string;
  detailNavIds: string[] | null;
  setDetailNavIds: Dispatch<SetStateAction<string[] | null>>;
  initialChannelKey: string | null;
  focusChannelsNonce: number;
  loadJobDetail: (job: Job) => Promise<Job | null>;
  openDetail: (
    job: Job,
    linkId?: string,
    pushHistory?: boolean,
    options?: OpenDetailOptions,
  ) => Promise<void>;
  closeDetail: () => void;
  dismissDetailSilently: () => void;
  resetDetailOnPopState: (nextLinkedJobId: string | null) => void;
  activateDetailSnapshot: (snapshot: Snapshot | null) => void;
  resolveDeepLink: (
    data: Snapshot | null,
    previewData: Snapshot | null,
    loading: boolean,
  ) => (() => void) | undefined;
}

const MAX_SIBLING_SHARD_FETCHES = 6;

export function useJobDetail({
  markRead,
  onNotice,
}: UseJobDetailOptions): UseJobDetailState {
  const [selected, setSelected] = useState<Job | null>(null);
  const [linkedJobId, setLinkedJobId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailNavIds, setDetailNavIds] = useState<string[] | null>(null);
  const [initialChannelKey, setInitialChannelKey] = useState<string | null>(null);
  const [focusChannelsNonce, setFocusChannelsNonce] = useState(0);

  const activeSnapshot = useRef<Snapshot | null>(null);
  const detailCache = useRef<Record<string, Job>>({});
  const hydratedCache = useRef<Record<string, Job>>({});
  const detailRequest = useRef(0);
  const detailsPromise = useRef<Record<string, Promise<Record<string, Job>>>>({});
  const missingLink = useRef<string | null>(null);

  const activateDetailSnapshot = useCallback((snapshot: Snapshot | null) => {
    activeSnapshot.current = snapshot;
    detailCache.current = {};
    hydratedCache.current = {};
    detailsPromise.current = {};
    ++detailRequest.current;
    setSelected(null);
    setInitialChannelKey(null);
    setDetailLoading(false);
    setDetailError('');
  }, []);

  const fetchDetailShard = useCallback(async (jobId: string): Promise<Record<string, Job> | null> => {
    const snapshot = activeSnapshot.current;
    const url = snapshot?.detail_shards?.[jobId.slice(0, 2)] ?? snapshot?.details_url;
    if (!url) return null;
    const pending = detailsPromise.current;
    if (!pending[url]) {
      pending[url] = fetch(url, {
        cache: snapshot?.detail_shards ? 'force-cache' : 'no-store',
      })
        .then(async (response) => {
          if (!response.ok) throw Error('完整公告暂时无法读取。');
          const payload = (await response.json()) as {
            schema_version?: number;
            jobs?: Record<string, Job>;
          };
          if (
            payload.schema_version !== 1 ||
            !payload.jobs ||
            typeof payload.jobs !== 'object'
          ) {
            throw Error('完整公告数据格式异常。');
          }
          detailCache.current = { ...detailCache.current, ...payload.jobs };
          return payload.jobs;
        })
        .catch((err) => {
          delete pending[url];
          throw err;
        });
    }
    return pending[url];
  }, []);

  const hydrateJobDetail = useCallback(
    async (job: Job): Promise<Job> => {
      const cachedHydrated = hydratedCache.current[job.id];
      if (cachedHydrated) {
        return { ...cachedHydrated, talk_events: job.talk_events ?? cachedHydrated.talk_events };
      }
      let primary = detailCache.current[job.id];
      if (!primary) {
        const records = await fetchDetailShard(job.id);
        if (!records) {
          throw Error('这条公告的详情暂未生成，请打开原公告核对。');
        }
        primary = records[job.id];
        if (!primary) {
          throw Error('这条公告的详情暂未生成，请打开原公告核对。');
        }
      }

      // If browse-index deduplication merged cross-shard sibling canonical records
      // into this job, lazily hydrate those sibling detail shards so every channel
      // URL, title and body is available without re-crawling.
      let remaining = findMissingSiblingIds(job, primary);
      const siblings: Job[] = [];
      let fetches = 0;
      while (remaining.length > 0 && fetches < MAX_SIBLING_SHARD_FETCHES) {
        const nextId = remaining.shift()!;
        let sibling: Job | undefined = detailCache.current[nextId];
        if (!sibling) {
          fetches += 1;
          try {
            const records = await fetchDetailShard(nextId);
            sibling = records?.[nextId];
          } catch {
            // Non-fatal: keep primary detail and any already-hydrated siblings.
            sibling = undefined;
          }
        }
        if (sibling) {
          siblings.push(sibling);
          const newlyCovered = new Set([sibling.id, ...(sibling.duplicate_ids ?? [])]);
          remaining = remaining.filter((id) => !newlyCovered.has(id));
        }
      }

      const merged = mergeDetailRecords(job, primary, siblings);
      hydratedCache.current[job.id] = merged;
      return merged;
    },
    [fetchDetailShard],
  );

  const loadJobDetail = useCallback(
    async (job: Job): Promise<Job | null> => {
      if (job.body && !findMissingSiblingIds(job, job).length) return job;
      try {
        return await hydrateJobDetail(job);
      } catch {
        return null;
      }
    },
    [hydrateJobDetail],
  );

  const resetDetailOnPopState = useCallback((nextLinkedJobId: string | null) => {
    ++detailRequest.current;
    setSelected(null);
    setInitialChannelKey(null);
    setDetailNavIds(null);
    setDetailLoading(false);
    setLinkedJobId(nextLinkedJobId);
  }, []);

  const dismissDetailSilently = useCallback(() => {
    ++detailRequest.current;
    setLinkedJobId(null);
    setSelected(null);
    setInitialChannelKey(null);
    setDetailNavIds(null);
    setDetailLoading(false);
  }, []);

  const closeDetail = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.state?.overlay === 'job') {
      window.history.back();
      return;
    }
    dismissDetailSilently();
  }, [dismissDetailSilently]);

  const openDetail = useCallback(
    async (job: Job, linkId = job.id, pushHistory = true, options?: OpenDetailOptions) => {
      report('event', 'open_detail');
      setLinkedJobId(linkId);
      setInitialChannelKey(options?.channelKey ?? null);
      if (options?.focusChannels) {
        setFocusChannelsNonce((n) => n + 1);
      }
      if (pushHistory && typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.delete('employer');
        url.searchParams.set('job', linkId);
        const nextUrl = `${url.pathname}${url.search}${url.hash}`;
        if (
          window.history.state?.overlay === 'job' ||
          window.history.state?.overlay === 'employer'
        ) {
          window.history.replaceState(
            { ...window.history.state, overlay: 'job', jobId: linkId, employerId: null },
            '',
            nextUrl,
          );
        } else {
          window.history.pushState(
            { ...window.history.state, overlay: 'job', jobId: linkId, employerId: null },
            '',
            nextUrl,
          );
        }
      }
      missingLink.current = null;
      const request = ++detailRequest.current;
      setDetailError('');
      setDetailLoading(false);
      const cached = hydratedCache.current[job.id];
      setSelected(
        cached
          ? { ...cached, talk_events: job.talk_events ?? cached.talk_events }
          : {
              ...job,
              body: job.body || '正在读取完整公告…',
              emails: job.emails ?? [],
              attachments: job.attachments ?? [],
              links: job.links ?? [],
            },
      );
      if (cached) {
        markRead(cached);
        return;
      }
      if (job.body && !findMissingSiblingIds(job, job).length) {
        markRead(job);
        return;
      }
      const snapshot = activeSnapshot.current;
      if (!snapshot?.detail_shards?.[job.id.slice(0, 2)] && !snapshot?.details_url) {
        setDetailError('这条公告的详情暂未生成，请打开原公告核对。');
        return;
      }
      setDetailLoading(true);
      try {
        const full = await hydrateJobDetail(job);
        if (request === detailRequest.current) {
          setSelected(full);
          markRead(full);
        }
      } catch (e) {
        if (request === detailRequest.current) {
          setSelected(job);
          setDetailError(e instanceof Error ? e.message : '完整公告读取失败。');
        }
      } finally {
        if (request === detailRequest.current) setDetailLoading(false);
      }
    },
    [hydrateJobDetail, markRead],
  );

  const resolveDeepLink = useCallback(
    (data: Snapshot | null, previewData: Snapshot | null, loading: boolean) => {
      if (!linkedJobId) return undefined;
      const snapshot = data || previewData;
      const found = snapshot && resolveJobId(snapshot.jobs, linkedJobId);
      if (found && selected?.id !== found.id) {
        const timer = setTimeout(() => void openDetail(found, linkedJobId, false), 0);
        return () => clearTimeout(timer);
      }
      if (!found && data && !loading && missingLink.current !== linkedJobId) {
        const timer = setTimeout(() => {
          missingLink.current = linkedJobId;
          onNotice('这条链接对应的机会暂不在当前索引中，请查看原公告或稍后刷新；链接已保留。');
        }, 0);
        return () => clearTimeout(timer);
      }
      return undefined;
    },
    [linkedJobId, selected?.id, openDetail, onNotice],
  );

  return {
    selected,
    linkedJobId,
    setLinkedJobId,
    detailLoading,
    detailError,
    detailNavIds,
    setDetailNavIds,
    initialChannelKey,
    focusChannelsNonce,
    loadJobDetail,
    openDetail,
    closeDetail,
    dismissDetailSilently,
    resetDetailOnPopState,
    activateDetailSnapshot,
    resolveDeepLink,
  };
}
