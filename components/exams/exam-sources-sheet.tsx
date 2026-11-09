'use client';

import { ExternalLink, X } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import type { ExamSnapshot } from '@/lib/exams';
import { formatShortDate } from '@/components/exam-ui';

export interface ExamSourcesSheetProps {
  open: boolean;
  onClose: () => void;
  sources: ExamSnapshot['sources'];
}

export function ExamSourcesSheet({ open, onClose, sources }: ExamSourcesSheetProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <SheetContent side="right" showCloseButton={false} className="exw-sheet-content is-sources">
        <header className="exw-dh">
          <div className="exw-dh-top">
            <div>
              <SheetTitle className="exw-dh-title">信息来源</SheetTitle>
              <SheetDescription className="exw-dh-sub">
                国家统考、山东省直、16 地市人社局及高校招考专栏
              </SheetDescription>
            </div>
            <button type="button" className="exw-icon-btn" aria-label="关闭" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </header>
        <div className="exw-db">
          <ul className="exw-source-list">
            {sources.map((src) => {
              const count = src.count ?? 0;
              const isZero = count === 0;
              return (
                <li key={src.id}>
                  <div>
                    <strong>
                      <span
                        className={`exw-src-dot ${isZero ? 'is-zero' : 'is-ok'}`}
                        aria-hidden="true"
                      />
                      {src.name}
                    </strong>
                    <span className="exw-muted">
                      {src.city || src.level || '官方'} · {isZero ? '本次 0 条' : `${count} 条`}
                      {src.last_success_at ? ` · 更新于 ${formatShortDate(src.last_success_at)}` : ''}
                    </span>
                  </div>
                  <a
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="exw-card-link"
                  >
                    官网
                    <ExternalLink size={12} />
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
}
