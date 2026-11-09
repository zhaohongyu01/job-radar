'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_EXAM_FILTERS,
  DEFAULT_EXAM_PROFILE,
  EXAM_FILTERS_STORAGE,
  EXAM_PERSONAL_STORAGE,
  EXAM_PROFILE_STORAGE,
  parseExamUrl,
  validateExamPersonal,
  validateExamProfile,
} from '@/lib/exams';
import type {
  ExamFilters,
  ExamPersonalRecord,
  ExamPersonalStore,
  ExamUserProfile,
} from '@/lib/exams';
import { readStore, subscribeStore, writeStore } from '@/lib/local-store';

const EXAM_FILTERS_MIGRATED_KEY = 'job-radar-exam-filters-migrated-v2';

function validateExamFilters(input: unknown): ExamFilters {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return DEFAULT_EXAM_FILTERS;
  }
  return { ...DEFAULT_EXAM_FILTERS, ...(input as Partial<ExamFilters>), query: '' };
}

export function safeWriteExamJson(key: string, value: unknown): void {
  writeStore(key, value);
}

function persistExamFilters(filters: ExamFilters): void {
  const { query: _query, ...persisted } = filters;
  void _query;
  writeStore(EXAM_FILTERS_STORAGE, persisted);
}

export interface UseExamPersonalOptions {
  onNotice: (msg: string) => void;
  onPageReset: () => void;
}

export function useExamPersonal({ onNotice, onPageReset }: UseExamPersonalOptions) {
  const [profile, setProfile] = useState<ExamUserProfile>(() =>
    readStore(EXAM_PROFILE_STORAGE, validateExamProfile, DEFAULT_EXAM_PROFILE),
  );
  const [filters, setFilters] = useState<ExamFilters>(() => {
    let loaded: ExamFilters = readStore(
      EXAM_FILTERS_STORAGE,
      validateExamFilters,
      DEFAULT_EXAM_FILTERS,
    );
    if (typeof window !== 'undefined') {
      try {
        if (!window.localStorage.getItem(EXAM_FILTERS_MIGRATED_KEY)) {
          window.localStorage.setItem(EXAM_FILTERS_MIGRATED_KEY, '1');
          if (loaded.stage === '全部') {
            loaded = { ...loaded, stage: DEFAULT_EXAM_FILTERS.stage };
            persistExamFilters(loaded);
          }
        }
      } catch {
        // ignore storage errors
      }
      const urlState = parseExamUrl(window.location.search);
      if (urlState.filters) {
        loaded = { ...loaded, ...urlState.filters };
      }
    }
    return loaded;
  });
  const [personal, setPersonal] = useState<ExamPersonalStore>(() =>
    readStore(EXAM_PERSONAL_STORAGE, validateExamPersonal, {}),
  );

  useEffect(() => {
    const unsubPersonal = subscribeStore(EXAM_PERSONAL_STORAGE, () => {
      try {
        const raw = window.localStorage.getItem(EXAM_PERSONAL_STORAGE);
        setPersonal(raw ? validateExamPersonal(JSON.parse(raw)) : {});
      } catch {
        setPersonal({});
        onNotice('本地考编记录格式异常，已重置为默认状态');
      }
    });
    const unsubProfile = subscribeStore(EXAM_PROFILE_STORAGE, () => {
      setProfile(readStore(EXAM_PROFILE_STORAGE, validateExamProfile, DEFAULT_EXAM_PROFILE));
    });
    return () => {
      unsubPersonal();
      unsubProfile();
    };
  }, [onNotice]);

  const updateProfile = useCallback(
    (patch: Partial<ExamUserProfile>) => {
      setProfile((prev) => {
        const next = { ...prev, ...patch };
        writeStore(EXAM_PROFILE_STORAGE, next);
        return next;
      });
      onPageReset();
    },
    [onPageReset],
  );

  const clearProfile = useCallback(() => {
    setProfile(DEFAULT_EXAM_PROFILE);
    writeStore(EXAM_PROFILE_STORAGE, DEFAULT_EXAM_PROFILE);
  }, []);

  const updateFilters = useCallback(
    (patch: Partial<ExamFilters>) => {
      setFilters((prev) => {
        const next = { ...prev, ...patch };
        persistExamFilters(next);
        return next;
      });
      onPageReset();
    },
    [onPageReset],
  );

  const resetFilters = useCallback(() => {
    setFilters((prev) => {
      const clean: ExamFilters = { ...DEFAULT_EXAM_FILTERS, view: prev.view, sort: prev.sort };
      persistExamFilters(clean);
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
        writeStore(EXAM_PERSONAL_STORAGE, next);
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
      });
      onNotice(exists ? '已移出候选岗位' : `已加入候选：${positionName}`);
    },
    [personal, updatePersonalRecord, onNotice],
  );

  const toggleHideExam = useCallback(
    (examId: string) => {
      const current = Boolean(personal[examId]?.hidden);
      updatePersonalRecord(examId, { hidden: !current });
      onNotice(!current ? '已标记为不感兴趣' : '已恢复显示');
    },
    [personal, updatePersonalRecord, onNotice],
  );

  const cleanupStalePositions = useCallback(
    (validRowIds: Set<string>) => {
      setPersonal((prev) => {
        const next: ExamPersonalStore = {};
        for (const [examId, rec] of Object.entries(prev)) {
          if (rec.savedPositionIds && rec.savedPositionIds.length > 0) {
            const cleaned = rec.savedPositionIds.filter((id) => validRowIds.has(id));
            next[examId] = { ...rec, savedPositionIds: cleaned, updatedAt: new Date().toISOString() };
          } else {
            next[examId] = rec;
          }
        }
        writeStore(EXAM_PERSONAL_STORAGE, next);
        return next;
      });
      onNotice('已清理已下线或已更新的候选岗位');
    },
    [onNotice],
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
  const hiddenCount = useMemo(
    () => Object.values(personal).filter((r) => Boolean(r.hidden)).length,
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
    toggleHideExam,
    cleanupStalePositions,
    toggleCity,
    toggleCandidate,
    savedCount,
    trackedCount,
    hiddenCount,
  };
}
