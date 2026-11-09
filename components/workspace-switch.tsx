'use client';

import Link from 'next/link';
import { Briefcase, ShieldCheck } from 'lucide-react';
import type { WorkspaceMode } from '@/lib/exams';

export interface WorkspaceSwitchProps {
  active: WorkspaceMode;
}

export function WorkspaceSwitch({ active }: WorkspaceSwitchProps) {
  return (
    <nav className="workspace-mode-switcher" aria-label="工作台">
      <Link
        href="/"
        aria-current={active === 'jobs' ? 'page' : undefined}
        className={`workspace-mode-btn ${active === 'jobs' ? 'is-active' : ''}`}
      >
        <Briefcase size={15} />
        <span>企业求职</span>
      </Link>
      <Link
        href="/exams"
        aria-current={active === 'exams' ? 'page' : undefined}
        className={`workspace-mode-btn is-exam ${active === 'exams' ? 'is-active' : ''}`}
      >
        <ShieldCheck size={15} />
        <span>考公考编</span>
      </Link>
    </nav>
  );
}
