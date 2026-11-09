'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { isUnread, personalFor } from '@/lib/jobs';
import type { Filters, Job, Personal, PersonalRecord } from '@/lib/jobs';
import { APPLICATION_STAGES } from '@/lib/personal-records';
import {
  commitPersonalRecords,
  patchPersonalRecord,
  readPersonalRecords,
  withPersonalLock,
} from '@/lib/personal-store';

export const PERSONAL_STORAGE_KEY = 'quancheng-personal-v1';

export interface UsePersonalRecordsOptions {
  ready: boolean;
  onNotice: (message: string) => void;
}

export interface UsePersonalRecordsResult {
  personal: Personal;
  setPersonal: Dispatch<SetStateAction<Personal>>;
  syncPersonal: () => void;
  save: (update: (latest: Personal) => Personal) => Promise<boolean>;
  setRead: (job: Job, read: boolean) => void;
  markRead: (job: Job) => void;
  toggle: (job: Job, key: 'saved' | 'applied' | 'hidden') => void;
  changeStage: (job: Job, nextStage: NonNullable<Filters['applicationStage']>) => void;
}

export function usePersonalRecords({
  ready,
  onNotice,
}: UsePersonalRecordsOptions): UsePersonalRecordsResult {
  const [personal, setPersonal] = useState<Personal>({});

  const syncPersonal = useCallback(() => {
    try {
      const next = readPersonalRecords(localStorage);
      setPersonal(next);
    } catch {
      onNotice('个人记录暂时无法读取，已保留当前显示；请先保留备份。');
    }
  }, [onNotice]);

  const save = useCallback(
    async (update: (latest: Personal) => Personal): Promise<boolean> => {
      try {
        await withPersonalLock(() => commitPersonalRecords(localStorage, update));
        syncPersonal();
        return true;
      } catch (error) {
        syncPersonal();
        onNotice(
          error instanceof Error
            ? error.message
            : '保存失败，浏览器存储不可用或已满。请先导出记录。',
        );
        return false;
      }
    },
    [syncPersonal, onNotice],
  );

  useEffect(() => {
    if (!ready) return;
    const changed = (event: StorageEvent) => {
      if (event.key === PERSONAL_STORAGE_KEY || event.key === null) syncPersonal();
    };
    window.addEventListener('storage', changed);
    window.addEventListener('focus', syncPersonal);
    return () => {
      window.removeEventListener('storage', changed);
      window.removeEventListener('focus', syncPersonal);
    };
  }, [ready, syncPersonal]);

  const setRead = useCallback(
    (job: Job, read: boolean) => {
      void save((latest) => {
        const stamp = new Date().toISOString();
        return patchPersonalRecord(latest, job, { readAt: read ? stamp : null }, stamp);
      });
    },
    [save],
  );

  const markRead = useCallback(
    (job: Job) => {
      void save((latest) =>
        isUnread(job, latest)
          ? patchPersonalRecord(
              latest,
              job,
              { readAt: new Date().toISOString() },
              new Date().toISOString(),
            )
          : latest,
      );
    },
    [save],
  );

  const toggle = useCallback(
    (job: Job, key: 'saved' | 'applied' | 'hidden') => {
      if (key === 'applied') {
        const current = personalFor(job, personal);
        const stage = current.application_stage;
        if (
          current.applied &&
          stage &&
          stage !== 'planned' &&
          stage !== 'applied' &&
          !window.confirm(
            `当前投递进度为「${APPLICATION_STAGES[stage]}」。取消“已投递”会把进度改回“待投递”，确定继续？`,
          )
        ) {
          return;
        }
      }
      void save((latest) => {
        const old = personalFor(job, latest);
        const stamp = new Date().toISOString();
        const patch: PersonalRecord = { [key]: !old[key] };
        if (key === 'applied') {
          const stage = old.application_stage;
          // Marking as applied never rolls a later stage (test/interview/offer…) back.
          if (patch.applied) {
            patch.application_stage = stage && stage !== 'planned' ? stage : 'applied';
          } else {
            patch.application_stage = 'planned';
          }
          patch.applied_at = patch.applied ? old.applied_at || stamp : null;
        }
        return patchPersonalRecord(latest, job, patch, stamp);
      });
    },
    [personal, save],
  );

  const changeStage = useCallback(
    (job: Job, nextStage: NonNullable<Filters['applicationStage']>) => {
      if (nextStage === 'all') return;
      void save((latest) => {
        const old = personalFor(job, latest);
        const stamp = new Date().toISOString();
        const isApplied = nextStage !== 'planned';
        const patch: PersonalRecord = {
          application_stage: nextStage,
          applied: isApplied,
          saved: old.saved ?? true,
          applied_at: isApplied ? old.applied_at || stamp : null,
        };
        return patchPersonalRecord(latest, job, patch, stamp);
      });
      onNotice(`已更新跟进进度为「${APPLICATION_STAGES[nextStage]}」`);
    },
    [save, onNotice],
  );

  return {
    personal,
    setPersonal,
    syncPersonal,
    save,
    setRead,
    markRead,
    toggle,
    changeStage,
  };
}
