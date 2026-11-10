'use client';

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import type { Job, Personal, PersonalRecord } from '@/lib/jobs';
import type { PersonalBackup } from '@/lib/personal-backup';
import { APPLICATION_STAGES, personalConflicts } from '@/lib/personal-records';
import { employerFromId, employerLabel } from '@/lib/employers';
import type { EmployerRecords } from '@/lib/employer-personal';
import { employerRecordConflicts } from '@/lib/employer-personal';
import { examPersonalConflicts, isExamProfileActive } from '@/lib/exams';
import type { ExamPersonalStore } from '@/lib/exams';
import { formatDate as date } from '@/components/job-card';

function personalStatusText(record: PersonalRecord) {
  const flags = ([['saved', '收藏'], ['applied', '已投递'], ['hidden', '隐藏']] as const)
    .map(([key, label]) => `${label}：${typeof record[key] === 'boolean' ? record[key] ? '是' : '否' : '未记录'}`);
  const read = Object.hasOwn(record, 'readAt') ? record.readAt ? `已读 ${date(record.readAt, true)}` : '未读' : '未记录';
  return [...flags, `阅读：${read}`].join(' · ');
}

export function BackupImportSheet({
  importPreview,
  importing,
  personal,
  employerRecords,
  examPersonal,
  allJobs,
  onClose,
  onExport,
  onConfirm,
}: {
  importPreview: PersonalBackup | null;
  importing: boolean;
  personal: Personal;
  employerRecords: EmployerRecords;
  examPersonal?: ExamPersonalStore;
  allJobs: Job[];
  onClose: () => void;
  onExport: () => void;
  onConfirm: (preferImported: boolean) => void;
}) {
  const examConflictCount =
    importPreview?.exam_records && examPersonal
      ? examPersonalConflicts(examPersonal, importPreview.exam_records).length
      : 0;

  return (
    <Sheet open={!!importPreview} onOpenChange={(open) => { if (!open && !importing) onClose(); }}>
      <SheetContent className="backup-import-sheet">
        <SheetHeader>
          <SheetTitle>确认合并个人备份</SheetTitle>
          <SheetDescription>验证完成后统一保存；可在合并前先导出当前浏览器备份。</SheetDescription>
        </SheetHeader>
        {importPreview && (
          <div className="application-tracker">
            <p>岗位记录 {Object.keys(importPreview.records).length} 条，活动记录 {Object.keys(importPreview.event_records || {}).length} 条。</p>
            {!!importPreview.employer_records && <p>企业个人记录 {Object.keys(importPreview.employer_records).length} 条，包含意向评分与备注。</p>}
            {!!importPreview.exam_records && (
              <p>
                考编记录 {Object.keys(importPreview.exam_records).length} 条
                {examConflictCount > 0 ? `（含 ${examConflictCount} 条时间相同冲突）` : ''}
                {importPreview.exam_profile && isExamProfileActive(importPreview.exam_profile) ? '，包含考编个人条件画像' : ''}。
              </p>
            )}
            <p>有 {personalConflicts(personal, importPreview.records).length} 条个人状态或备注缺少可区分新旧的更新时间；请选择冲突处理方式。可比较时间的记录采用较新状态。</p>
            {personalConflicts(personal, importPreview.records).slice(0, 20).map((id) => (
              <details key={id}>
                <summary>{allJobs.find((job) => job.id === id || job.duplicate_ids?.includes(id))?.title || id}</summary>
                <p>本机：{personalStatusText(personal[id])}<br />{personal[id].application_stage ? APPLICATION_STAGES[personal[id].application_stage] : '阶段未填写'} · {personal[id].notes || personal[id].next_action_note || '无备注'}</p>
                <p>备份：{personalStatusText(importPreview.records[id])}<br />{importPreview.records[id].application_stage ? APPLICATION_STAGES[importPreview.records[id].application_stage] : '阶段未填写'} · {importPreview.records[id].notes || importPreview.records[id].next_action_note || '无备注'}</p>
              </details>
            ))}
            {!!importPreview.employer_records && (
              <>
                <p>企业评分有 {employerRecordConflicts(employerRecords, importPreview.employer_records).length} 条时间相同的冲突；其余采用较新记录，清空评分也会保留。</p>
                {employerRecordConflicts(employerRecords, importPreview.employer_records).slice(0, 20).map((id) => (
                  <details key={id}>
                    <summary>{employerLabel(employerFromId(id))}</summary>
                    <p>本机：我的 {employerRecords[id].rating ?? '未评分'} · {employerRecords[id].notes || '无备注'}</p>
                    <p>备份：我的 {importPreview.employer_records![id].rating ?? '未评分'} · {importPreview.employer_records![id].notes || '无备注'}</p>
                  </details>
                ))}
              </>
            )}
            <button className="btn btn-outline" disabled={importing} onClick={onExport}>先导出本机备份</button>
            <button className="btn btn-primary" disabled={importing} onClick={() => onConfirm(false)}>合并，保留本机冲突状态</button>
            <button className="btn btn-outline" disabled={importing} onClick={() => onConfirm(true)}>合并，冲突以备份为准</button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
