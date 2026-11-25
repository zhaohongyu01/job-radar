'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  clearExamDetailShardCache,
  deriveExamStage,
  isExamOpenForRegistration,
  loadExamPositionsAsset,
} from '@/lib/exams';
import type { ExamAnnouncement, ExamPositionRow, ExamSnapshot } from '@/lib/exams';
import { chinaToday } from '@/components/exam-ui';

async function fetchExamSnapshot(): Promise<ExamSnapshot> {
  const resp = await fetch('/exams.json', { cache: 'no-cache' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()) as ExamSnapshot;
}

export interface UseExamSnapshotOptions {
  onNotice?: (message: string) => void;
  eagerPositions?: boolean;
}

export interface UseExamSnapshotResult {
  snapshot: ExamSnapshot | null;
  loading: boolean;
  positionsLoading: boolean;
  positionsReady: boolean;
  positionsError: string;
  error: string;
  today: string;
  nowMs: number;
  reload: () => void;
  retryPositions: () => void;
  ensurePositionsLoaded: () => void;
  allExams: ExamAnnouncement[];
  activeExamCount: number;
  endedExamCount: number;
  freshnessMeta: { hours: number; stale: boolean; label: string } | null;
}

export function useExamSnapshot({
  onNotice,
  eagerPositions = false,
}: UseExamSnapshotOptions = {}): UseExamSnapshotResult {
  const [snapshot, setSnapshot] = useState<ExamSnapshot | null>(null);
  const [positionsState, setPositionsState] = useState<{
    url: string;
    byExam: Record<string, ExamPositionRow[]>;
  } | null>(null);
  const [positionsLoading, setPositionsLoading] = useState(false);
  const [positionsError, setPositionsError] = useState('');
  const [forcePositionsLoad, setForcePositionsLoad] = useState(false);
  const [positionsRetryTick, setPositionsRetryTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [today, setToday] = useState('');
  const [nowMs, setNowMs] = useState(0);

  useEffect(() => {
    let active = true;
    fetchExamSnapshot()
      .then((data) => {
        if (!active) return;
        setSnapshot(data);
        setToday(chinaToday());
        setNowMs(Date.now());
      })
      .catch(() => {
        if (active) setError('考公考编数据读取失败，请稍后重试。');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const positionsUrl = snapshot?.positions_url || '';
  const positionsReady = Boolean(
    snapshot && (!positionsUrl || positionsState?.url === positionsUrl),
  );

  useEffect(() => {
    if (!positionsUrl || positionsState?.url === positionsUrl) return;
    let active = true;
    let timerId: ReturnType<typeof setTimeout> | undefined;

    const triggerFetch = () => {
      if (!active) return;
      setPositionsLoading(true);
      setPositionsError('');
      loadExamPositionsAsset(positionsUrl)
        .then((asset) => {
          if (!active) return;
          setPositionsError('');
          setPositionsState({ url: positionsUrl, byExam: asset.positions_by_exam });
        })
        .catch(() => {
          if (active) {
            setPositionsError('职位表未加载，请检查网络后点击重试。');
          }
        })
        .finally(() => {
          if (active) setPositionsLoading(false);
        });
    };

    if (eagerPositions || forcePositionsLoad) {
      triggerFetch();
    } else {
      timerId = setTimeout(triggerFetch, 250);
    }

    return () => {
      active = false;
      if (timerId !== undefined) clearTimeout(timerId);
    };
  }, [positionsUrl, positionsState?.url, eagerPositions, forcePositionsLoad, positionsRetryTick]);

  const ensurePositionsLoaded = useCallback(() => {
    setForcePositionsLoad(true);
  }, []);

  const retryPositions = useCallback(() => {
    if (positionsUrl) {
      clearExamDetailShardCache(positionsUrl);
    }
    setPositionsError('');
    setForcePositionsLoad(true);
    setPositionsRetryTick((n) => n + 1);
  }, [positionsUrl]);

  const reload = useCallback(() => {
    setLoading(true);
    setError('');
    setPositionsError('');
    setPositionsState(null);
    clearExamDetailShardCache();
    fetchExamSnapshot()
      .then((data) => {
        setSnapshot(data);
        setToday(chinaToday());
        setNowMs(Date.now());
        setPositionsRetryTick((n) => n + 1);
        onNotice?.('数据已刷新');
      })
      .catch(() => setError('考公考编数据读取失败，请稍后重试。'))
      .finally(() => setLoading(false));
  }, [onNotice]);

  const allExams = useMemo(() => {
    const posMap =
      positionsUrl && positionsState?.url === positionsUrl ? positionsState.byExam : null;
    return (snapshot?.exams || []).map((e) => {
      const nextStage = today ? deriveExamStage(e, today) : e.stage;
      const resolvedPositions = e.positions ?? (posMap ? posMap[e.id] || [] : undefined);
      if (nextStage === e.stage && resolvedPositions === e.positions) return e;
      return {
        ...e,
        stage: nextStage,
        ...(resolvedPositions !== undefined ? { positions: resolvedPositions } : {}),
      };
    });
  }, [snapshot, today, positionsUrl, positionsState]);

  const activeExamCount = useMemo(
    () => allExams.filter((e) => isExamOpenForRegistration(e)).length,
    [allExams],
  );

  const endedExamCount = useMemo(
    () => allExams.filter((e) => e.stage === 'ended').length,
    [allExams],
  );

  const freshnessMeta = useMemo(() => {
    const freshnessTimestamp = snapshot?.last_success_at || snapshot?.generated_at;
    if (!freshnessTimestamp || !nowMs) return null;
    const ms = Date.parse(freshnessTimestamp);
    if (!Number.isFinite(ms)) return null;
    const hours = Math.max(0, Math.round((nowMs - ms) / 3600_000));
    const stale = hours > 36;
    const label = hours < 1 ? '刚刚更新' : `更新于 ${hours} 小时前`;
    return { hours, stale, label };
  }, [snapshot, nowMs]);

  return {
    snapshot,
    loading,
    positionsLoading,
    positionsReady,
    positionsError,
    error,
    today,
    nowMs,
    reload,
    retryPositions,
    ensurePositionsLoaded,
    allExams,
    activeExamCount,
    endedExamCount,
    freshnessMeta,
  };
}
