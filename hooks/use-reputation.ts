'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadReputationFile } from '@/lib/reputation-loader';
import { mergeReputationIndexes } from '@/lib/reputation';
import type { ReputationEntity, ReputationIndex } from '@/lib/reputation';

export function useReputation() {
  const [enabled, setEnabled] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [index, setIndex] = useState<ReputationIndex | null>(null), [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0), [loading, setLoading] = useState(false);
  const current = useRef<ReputationIndex | null>(null);
  const cache = useRef(new Map<string, Promise<ReputationEntity>>());
  const enable = useCallback(() => setEnabled(true), []);
  const retry = useCallback(() => { setEnabled(true); setAttempt(value => value + 1); }, []);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const accept = (candidate: ReputationIndex) => {
      if (controller.signal.aborted) return;
      const merged = mergeReputationIndexes(current.current, candidate);
      current.current = merged; setIndex(merged); setError('');
    };
    const timer = setTimeout(() => {
      setLoading(true);
      void Promise.allSettled([
        loadReputationFile('index.json', false, controller.signal).then(value => accept(value as ReputationIndex)),
        loadReputationFile('index.json', true, controller.signal).then(value => accept(value as ReputationIndex)),
      ]).then(results => {
        if (controller.signal.aborted) return;
        setLoading(false);
        if (results.every(result => result.status === 'rejected'))
          setError(current.current ? '暂时无法更新口碑，已保留上次资料。' : '口碑暂时无法读取，岗位仍可正常浏览。');
      });
    }, 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [enabled, attempt]);
  const details = useCallback(async (file: string): Promise<ReputationEntity> => {
    if (!cache.current.has(file)) {
      // Content-addressed files are identical whichever delivery path wins.
      const controller = new AbortController();
      const pending = Promise.any([loadReputationFile(file, false, controller.signal), loadReputationFile(file, true, controller.signal)])
        .then(value => { controller.abort(); return value as ReputationEntity; });
      cache.current.set(file, pending);
      void pending.catch(() => cache.current.delete(file));
    }
    return cache.current.get(file)!;
  }, []);
  return { index, error, loading, enable, retry, details, now };
}
