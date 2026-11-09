'use client';

import { useEffect, useState } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';

const SHORTCUTS: ReadonlyArray<{ keys: string[]; label: string }> = [
  { keys: ['/'], label: '聚焦顶部搜索框' },
  { keys: ['J', 'K'], label: '详情抽屉内切换下一条 / 上一条' },
  { keys: ['Esc'], label: '关闭当前抽屉或弹层' },
  { keys: ['?'], label: '打开或关闭本快捷键面板' },
];

export function ShortcutsDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '?' || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          Boolean(target.closest('input, textarea, select, [contenteditable="true"]')))
      ) {
        return;
      }
      event.preventDefault();
      setOpen((prev) => !prev);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="shortcuts-sheet">
        <SheetHeader>
          <SheetTitle>键盘快捷键</SheetTitle>
          <SheetDescription>在非输入状态下按键即可快速操作。</SheetDescription>
        </SheetHeader>
        <dl className="shortcuts-list">
          {SHORTCUTS.map((item) => (
            <div key={item.label} className="shortcuts-row">
              <dt className="shortcuts-desc">{item.label}</dt>
              <dd className="shortcuts-keys">
                {item.keys.map((key, idx) => (
                  <span key={key} className="shortcuts-key-group">
                    {idx > 0 && <span className="shortcuts-key-sep">/</span>}
                    <kbd className="kbd">{key}</kbd>
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </SheetContent>
    </Sheet>
  );
}
