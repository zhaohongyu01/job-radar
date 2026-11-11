'use client';

import { ExamWorkspace } from '@/components/exam-workspace';
import { ToastProvider } from '@/components/toast-provider';

export function ExamsPageClient() {
  return (
    <ToastProvider>
      <a className="skip-to-results" href="#exam-results">
        跳到考编检索结果
      </a>
      <ExamWorkspace />
    </ToastProvider>
  );
}
