'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { clearExamDetailShardCache, deriveExamStage } from '@/lib/exams';
import type { ExamAnnouncement, ExamSnapshot } from '@/lib/exams';
import { chinaToday } from '@/components/exam-ui';

async function fetchExamSnapshot(): Promise<ExamSnapshot> {
  const resp = await fetch('/exams.json', { cache: 'no-cache' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()) as ExamSnapshot;
}

export interface UseExamSnapshotOptions {
  onNotice?: (message: string) => void;
}

export interface UseExamSnapshotResult {
  snapshot: ExamSnapshot | null;
  loading: boolean;
  error: string;
  today: string;
  nowMs: number;
  reload: () => void;
  allExams: ExamAnnouncement[];
  activeExamCount: number;
  endedExamCount: number;
  freshnessMeta: { hours: number; stale: boolean; label: string } | null;
}

export function useExamSnapshot({
  onNotice,
}: UseExamSnapshotOptions = {}): UseExamSnapshotResult {
  const [snapshot, setSnapshot] = useState<ExamSnapshot | null>(null);
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

  const reload = useCallback(() => {
    setLoading(true);
    setError('');
    clearExamDetailShardCache();
    fetchExamSnapshot()
      .then((data) => {
        setSnapshot(data);
        setToday(chinaToday());
        setNowMs(Date.now());
        onNotice?.('数据已刷新');
      })
      .catch(() => setError('考公考编数据读取失败，请稍后重试。'))
      .finally(() => setLoading(false));
  }, [onNotice]);

  const allExams = useMemo(
    () =>
      (snapshot?.exams || []).map((e) => (today ? { ...e, stage: deriveExamStage(e, today) } : e)),
    [snapshot, today],
  );

  const activeExamCount = useMemo(
    () =>
      allExams.filter((e) =>
        ['upcoming', 'registering', 'closing_soon', 'rolling'].includes(e.stage),
      ).length,
    [allExams],
  );

  const endedExamCount = useMemo(
    () => allExams.filter((e) => e.stage === 'ended').length,
    [allExams],
  );

  const freshnessMeta = useMemo(() => {
    if (!snapshot?.generated_at || !nowMs) return null;
    const ms = Date.parse(snapshot.generated_at);
    if (!Number.isFinite(ms)) return null;
    const hours = Math.max(0, Math.round((nowMs - ms) / 3600_000));
    const stale = hours > 36;
    const label = hours < 1 ? '刚刚更新' : `更新于 ${hours} 小时前`;
    return { hours, stale, label };
  }, [snapshot, nowMs]);

  return {
    snapshot,
    loading,
    error,
    today,
    nowMs,
    reload,
    allExams,
    activeExamCount,
    endedExamCount,
    freshnessMeta,
  };
}
