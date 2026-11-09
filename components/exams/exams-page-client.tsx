'use client';

import { Radar } from 'lucide-react';
import { ExamWorkspace } from '@/components/exam-workspace';
import { WorkspaceSwitch } from '@/components/workspace-switch';

export function ExamsPageClient() {
  return (
    <>
      <a className="skip-to-results" href="#exam-results">
        跳到考编检索结果
      </a>
      <header className="app-bar">
        <div className="app-bar-inner">
          <div className="brand-mark">
            <Radar size={26} />
            <div className="brand-text">
              <strong>职讯雷达</strong>
              <small>考公考编工作台</small>
            </div>
          </div>

          <WorkspaceSwitch active="exams" />
        </div>
      </header>
      <main className="page">
        <ExamWorkspace />
      </main>
    </>
  );
}
