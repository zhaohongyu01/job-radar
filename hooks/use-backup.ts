'use client';

import { useCallback, useRef, useState } from 'react';
import { externalUrl, formatCompanyDisplay, locationSummary } from '@/lib/jobs';
import type { Filters, Job } from '@/lib/jobs';
import type { ViewMode } from '@/lib/browsing';
import { formatDate as date, extractSalary } from '@/components/job-card';
import { createBackup, validateBackup, writeBackup } from '@/lib/personal-backup';
import type { PersonalBackup } from '@/lib/personal-backup';
import { mergePersonalRecords } from '@/lib/personal-records';
import { readPersonalRecords, withPersonalLock } from '@/lib/personal-store';
import { EVENT_PERSONAL_STORAGE, validateEventPersonal } from '@/lib/agenda';
import { mergeEmployerRecords, readEmployerRecords } from '@/lib/employer-personal';
import {
  DEFAULT_EXAM_PROFILE,
  EXAM_PERSONAL_STORAGE,
  EXAM_PROFILE_STORAGE,
  mergeExamPersonal,
  mergeExamProfile,
  validateExamPersonal,
  validateExamProfile,
} from '@/lib/exams';
import { readStore } from '@/lib/local-store';
import { report } from '@/lib/rum';

export interface UseBackupOptions {
  syncPersonal?: () => void;
  onApplyBrowsing?: (browsing: {
    filters: Filters;
    viewMode: ViewMode;
    groupCompanies: boolean;
  }) => void;
  onNotice: (message: string) => void;
}

export function useBackup({
  syncPersonal,
  onApplyBrowsing,
  onNotice,
}: UseBackupOptions) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<PersonalBackup | null>(null);
  const [importing, setImporting] = useState(false);
  const [presetRevision, setPresetRevision] = useState(0);

  const triggerFilePicker = useCallback(() => {
    fileRef.current?.click();
  }, []);

  const exportPersonal = useCallback(() => {
    try {
      const content = JSON.stringify(
        createBackup(readPersonalRecords(localStorage), localStorage),
        null,
        2,
      );
      if (new TextEncoder().encode(content).length > 5000000) {
        throw Error(
          '备份超过当前 5 MB 导入上限，请先减少不需要的备注或记录后导出；未截断任何数据。',
        );
      }
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '职讯雷达-个人记录.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      report('event', 'export_backup');
      onNotice('个人记录已导出。');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : '导出失败');
    }
  }, [onNotice]);

  const importPersonal = useCallback(
    async (file?: File) => {
      if (!file) return;
      try {
        if (file.size > 5000000) throw Error('备份文件不能超过 5 MB');
        const backup = JSON.parse(await file.text());
        setImportPreview(validateBackup(backup));
      } catch (e) {
        onNotice(e instanceof Error ? e.message : '无法读取备份文件');
      }
      if (fileRef.current) fileRef.current.value = '';
    },
    [onNotice],
  );

  const confirmImport = useCallback(
    async (preferImported: boolean) => {
      if (!importPreview || importing) return;
      setImporting(true);
      try {
        const validated = await withPersonalLock(() => {
          const records = mergePersonalRecords(
            readPersonalRecords(localStorage),
            importPreview.records,
            preferImported,
          );
          const currentEvents = validateEventPersonal(
            JSON.parse(localStorage.getItem(EVENT_PERSONAL_STORAGE) || '{}'),
          );
          const events = { ...currentEvents };
          for (const [id, record] of Object.entries(importPreview.event_records || {})) {
            const old = events[id];
            if (
              !old ||
              (old.updated_at && record.updated_at
                ? old.updated_at <= record.updated_at
                : preferImported)
            ) {
              events[id] = record;
            }
          }
          const employers =
            importPreview.employer_records === undefined
              ? undefined
              : mergeEmployerRecords(
                  readEmployerRecords(localStorage),
                  importPreview.employer_records,
                  preferImported,
                );
          const localExamRecords = readStore(EXAM_PERSONAL_STORAGE, validateExamPersonal, {});
          const examRecords =
            importPreview.exam_records === undefined
              ? Object.keys(localExamRecords).length > 0
                ? localExamRecords
                : undefined
              : mergeExamPersonal(localExamRecords, importPreview.exam_records, preferImported);
          const localExamProfile = readStore(
            EXAM_PROFILE_STORAGE,
            validateExamProfile,
            DEFAULT_EXAM_PROFILE,
          );
          const examProfile = mergeExamProfile(
            localExamProfile,
            importPreview.exam_profile,
            preferImported,
          );
          const nextValidated = validateBackup({
            ...importPreview,
            records,
            event_records: events,
            employer_records: employers,
            exam_records: examRecords,
            exam_profile: examProfile,
          });
          writeBackup(nextValidated, localStorage);
          return nextValidated;
        });
        syncPersonal?.();
        if (validated.browsing && onApplyBrowsing) {
          onApplyBrowsing(validated.browsing);
        }
        window.dispatchEvent(new Event('job-radar-local-workspace-change'));
        setPresetRevision((value) => value + 1);
        setImportPreview(null);
        onNotice('备份已合并；个人记录、活动及设置已保存。');
      } catch (error) {
        onNotice(error instanceof Error ? error.message : '导入未完成');
      } finally {
        setImporting(false);
      }
    },
    [importPreview, importing, syncPersonal, onApplyBrowsing, onNotice],
  );

  const copyJob = useCallback(
    (job: Job) => {
      const { cleanTitle, salary } = extractSalary(job);
      const salaryText = salary ? ` (${salary})` : '';
      const comp = formatCompanyDisplay(job.company, job.title, job.source_id).displayCompany;
      const companyText = comp && comp !== '企业名称待核实' ? `\n【企业】${comp}` : '';
      const loc = locationSummary(job);
      const locText = loc ? `\n【地点】${loc}` : '';
      const deadlineText = job.deadline ? `\n【截止】${date(job.deadline, true)}` : '';
      const url = externalUrl(job.application_url || job.source_url) || '';
      const urlText = url ? `\n【来源】${url}` : '';
      const shareUrl =
        typeof window !== 'undefined'
          ? `${window.location.origin}${window.location.pathname}?job=${job.id}`
          : '';
      const shareText = shareUrl ? `\n【直达链接】${shareUrl}` : '';
      const content = `【岗位】${cleanTitle}${salaryText}${companyText}${locText}${deadlineText}${urlText}${shareText}\n—— 来自职讯雷达`;
      navigator.clipboard
        .writeText(content)
        .then(() => {
          onNotice(`已复制「${cleanTitle}」的招聘信息与直达链接，可直接粘贴分享！`);
        })
        .catch(() => {
          onNotice('复制失败，请手动选择复制。');
        });
    },
    [onNotice],
  );

  return {
    fileRef,
    triggerFilePicker,
    importPreview,
    setImportPreview,
    importing,
    presetRevision,
    exportPersonal,
    importPersonal,
    confirmImport,
    copyJob,
  };
}
