'use client';

import { useCallback, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { resolveJobId } from '@/lib/jobs';
import type { Job, Snapshot } from '@/lib/jobs';

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
  openDetail: (job: Job, linkId?: string, pushHistory?: boolean) => Promise<void>;
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

export function useJobDetail({
  markRead,
  onNotice,
}: UseJobDetailOptions): UseJobDetailState {
  const [selected, setSelected] = useState<Job | null>(null);
  const [linkedJobId, setLinkedJobId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailNavIds, setDetailNavIds] = useState<string[] | null>(null);

  const activeSnapshot = useRef<Snapshot | null>(null);
  const detailCache = useRef<Record<string, Job>>({});
  const detailRequest = useRef(0);
  const detailsPromise = useRef<Record<string, Promise<Record<string, Job>>>>({});
  const missingLink = useRef<string | null>(null);

  const activateDetailSnapshot = useCallback((snapshot: Snapshot | null) => {
    activeSnapshot.current = snapshot;
    detailCache.current = {};
    detailsPromise.current = {};
    ++detailRequest.current;
    setSelected(null);
    setDetailLoading(false);
    setDetailError('');
  }, []);

  const resetDetailOnPopState = useCallback((nextLinkedJobId: string | null) => {
    ++detailRequest.current;
    setSelected(null);
    setDetailNavIds(null);
    setDetailLoading(false);
    setLinkedJobId(nextLinkedJobId);
  }, []);

  const dismissDetailSilently = useCallback(() => {
    ++detailRequest.current;
    setLinkedJobId(null);
    setSelected(null);
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
    async (job: Job, linkId = job.id, pushHistory = true) => {
      setLinkedJobId(linkId);
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
      const cached = detailCache.current[job.id];
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
      if (job.body) {
        markRead(job);
        return;
      }
      const snapshot = activeSnapshot.current;
      const url = snapshot?.detail_shards?.[job.id.slice(0, 2)] ?? snapshot?.details_url;
      if (!url) {
        setDetailError('这条公告的详情暂未生成，请打开原公告核对。');
        return;
      }
      const pending = detailsPromise.current;
      setDetailLoading(true);
      try {
        if (!pending[url]) {
          pending[url] = fetch(url, {
            cache: snapshot?.detail_shards ? 'force-cache' : 'no-store',
          }).then(async (response) => {
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
            return payload.jobs;
          });
        }
        const records = await pending[url];
        const full = records[job.id];
        if (!full) throw Error('这条公告的详情暂未生成，请打开原公告核对。');
        if (request === detailRequest.current) {
          detailCache.current = { ...detailCache.current, ...records };
          setSelected({ ...full, talk_events: job.talk_events ?? full.talk_events });
          markRead(full);
        }
      } catch (e) {
        delete pending[url];
        if (request === detailRequest.current) {
          setSelected(job);
          setDetailError(e instanceof Error ? e.message : '完整公告读取失败。');
        }
      } finally {
        if (request === detailRequest.current) setDetailLoading(false);
      }
    },
    [markRead],
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
    openDetail,
    closeDetail,
    dismissDetailSilently,
    resetDetailOnPopState,
    activateDetailSnapshot,
    resolveDeepLink,
  };
}
