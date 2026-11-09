'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_EXAM_FILTERS,
  DEFAULT_EXAM_PROFILE,
  EXAM_FILTERS_STORAGE,
  EXAM_PERSONAL_STORAGE,
  EXAM_PROFILE_STORAGE,
  validateExamPersonal,
  validateExamProfile,
} from '@/lib/exams';
import type {
  ExamFilters,
  ExamPersonalRecord,
  ExamPersonalStore,
  ExamUserProfile,
} from '@/lib/exams';

const EXAM_FILTERS_MIGRATED_KEY = 'job-radar-exam-filters-migrated-v2';

function safeReadJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

export function safeWriteExamJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
}

export interface UseExamPersonalOptions {
  onNotice: (msg: string) => void;
  onPageReset: () => void;
}

export function useExamPersonal({ onNotice, onPageReset }: UseExamPersonalOptions) {
  const [profile, setProfile] = useState<ExamUserProfile>(() => {
    if (typeof window === 'undefined') return DEFAULT_EXAM_PROFILE;
    try {
      const raw = window.localStorage.getItem(EXAM_PROFILE_STORAGE);
      return raw ? validateExamProfile(JSON.parse(raw)) : DEFAULT_EXAM_PROFILE;
    } catch {
      return DEFAULT_EXAM_PROFILE;
    }
  });
  const [filters, setFilters] = useState<ExamFilters>(() => {
    const loaded = safeReadJson(EXAM_FILTERS_STORAGE, DEFAULT_EXAM_FILTERS);
    if (typeof window !== 'undefined') {
      try {
        if (!window.localStorage.getItem(EXAM_FILTERS_MIGRATED_KEY)) {
          window.localStorage.setItem(EXAM_FILTERS_MIGRATED_KEY, '1');
          if (loaded.stage === '全部') {
            const migrated = { ...loaded, stage: DEFAULT_EXAM_FILTERS.stage };
            safeWriteExamJson(EXAM_FILTERS_STORAGE, migrated);
            return migrated;
          }
        }
      } catch {
        // ignore storage errors
      }
    }
    return loaded;
  });
  const [personal, setPersonal] = useState<ExamPersonalStore>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = window.localStorage.getItem(EXAM_PERSONAL_STORAGE);
      return raw ? validateExamPersonal(JSON.parse(raw)) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === EXAM_PERSONAL_STORAGE) {
        try {
          const raw = window.localStorage.getItem(EXAM_PERSONAL_STORAGE);
          setPersonal(raw ? validateExamPersonal(JSON.parse(raw)) : {});
        } catch {
          setPersonal({});
          onNotice('本地考编记录格式异常，已重置为默认状态');
        }
      } else if (event.key === EXAM_PROFILE_STORAGE) {
        try {
          const raw = window.localStorage.getItem(EXAM_PROFILE_STORAGE);
          setProfile(raw ? validateExamProfile(JSON.parse(raw)) : DEFAULT_EXAM_PROFILE);
        } catch {
          setProfile(DEFAULT_EXAM_PROFILE);
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [onNotice]);

  const updateProfile = useCallback(
    (patch: Partial<ExamUserProfile>) => {
      setProfile((prev) => {
        const next = { ...prev, ...patch };
        safeWriteExamJson(EXAM_PROFILE_STORAGE, next);
        return next;
      });
      onPageReset();
    },
    [onPageReset],
  );

  const clearProfile = useCallback(() => {
    setProfile(DEFAULT_EXAM_PROFILE);
    safeWriteExamJson(EXAM_PROFILE_STORAGE, DEFAULT_EXAM_PROFILE);
  }, []);

  const updateFilters = useCallback(
    (patch: Partial<ExamFilters>) => {
      setFilters((prev) => {
        const next = { ...prev, ...patch };
        safeWriteExamJson(EXAM_FILTERS_STORAGE, next);
        return next;
      });
      onPageReset();
    },
    [onPageReset],
  );

  const resetFilters = useCallback(() => {
    setFilters((prev) => {
      const clean: ExamFilters = { ...DEFAULT_EXAM_FILTERS, view: prev.view, sort: prev.sort };
      safeWriteExamJson(EXAM_FILTERS_STORAGE, clean);
      return clean;
    });
    onPageReset();
  }, [onPageReset]);

  const updatePersonalRecord = useCallback(
    (examId: string, patch: Partial<ExamPersonalRecord>) => {
      setPersonal((prev) => {
        const next: ExamPersonalStore = {
          ...prev,
          [examId]: { ...prev[examId], ...patch, updatedAt: new Date().toISOString() },
        };
        safeWriteExamJson(EXAM_PERSONAL_STORAGE, next);
        return next;
      });
    },
    [],
  );

  const toggleSaveExam = useCallback(
    (examId: string) => {
      const current = personal[examId]?.saved;
      updatePersonalRecord(examId, { saved: !current });
      onNotice(!current ? '已收藏' : '已取消收藏');
    },
    [personal, updatePersonalRecord, onNotice],
  );

  const toggleCity = useCallback(
    (city: string) => {
      if (city === '全部') {
        updateFilters({ cities: ['全部'] });
        return;
      }
      const cur = filters.cities.filter((c) => c !== '全部');
      const next = cur.includes(city) ? cur.filter((c) => c !== city) : [...cur, city];
      updateFilters({ cities: next.length > 0 ? next : ['全部'] });
    },
    [filters.cities, updateFilters],
  );

  const toggleCandidate = useCallback(
    (examId: string, rowId: string, positionName: string) => {
      const rec = personal[examId];
      const prevIds = rec?.savedPositionIds || [];
      const exists = prevIds.includes(rowId);
      updatePersonalRecord(examId, {
        saved: true,
        savedPositionIds: exists ? prevIds.filter((id) => id !== rowId) : [...prevIds, rowId],
        status: !rec?.status || rec.status === 'none' ? 'comparing' : rec.status,
      });
      onNotice(exists ? '已移出候选岗位' : `已加入候选：${positionName}`);
    },
    [personal, updatePersonalRecord, onNotice],
  );

  const savedCount = useMemo(
    () =>
      Object.values(personal).filter((r) => r.saved || (r.savedPositionIds?.length ?? 0) > 0)
        .length,
    [personal],
  );
  const trackedCount = useMemo(
    () => Object.values(personal).filter((r) => r.status && r.status !== 'none').length,
    [personal],
  );

  return {
    profile,
    setProfile,
    filters,
    setFilters,
    personal,
    setPersonal,
    updateProfile,
    clearProfile,
    updateFilters,
    resetFilters,
    updatePersonalRecord,
    toggleSaveExam,
    toggleCity,
    toggleCandidate,
    savedCount,
    trackedCount,
  };
}
