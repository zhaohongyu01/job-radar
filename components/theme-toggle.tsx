'use client';

import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';
import {
  applyThemePreference,
  readThemePreference,
  writeThemePreference,
} from '@/lib/theme';
import type { ThemePreference } from '@/lib/theme';

const CYCLE: ThemePreference[] = ['system', 'light', 'dark'];

const LABELS: Record<ThemePreference, string> = {
  system: '跟随系统主题（点击切换浅色纸面）',
  light: '浅色原浆纸（点击切换夜间墨纸）',
  dark: '夜间墨纸模式（点击切换跟随系统）',
};

export function ThemeToggle() {
  const [pref, setPref] = useState<ThemePreference>('system');

  useEffect(() => {
    const sync = () => {
      const current = readThemePreference();
      setPref(current);
      applyThemePreference(current);
    };
    sync();

    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onMqChange = () => {
      if (readThemePreference() === 'system') {
        applyThemePreference('system');
      }
    };
    mq?.addEventListener?.('change', onMqChange);
    window.addEventListener('job-radar-theme-change', sync);
    window.addEventListener('storage', sync);
    return () => {
      mq?.removeEventListener?.('change', onMqChange);
      window.removeEventListener('job-radar-theme-change', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const handleCycle = () => {
    const idx = CYCLE.indexOf(pref);
    const next = CYCLE[(idx + 1) % CYCLE.length];
    setPref(next);
    writeThemePreference(next);
  };

  return (
    <button
      type="button"
      className="icon-btn"
      onClick={handleCycle}
      aria-label={LABELS[pref]}
      title={LABELS[pref]}
    >
      {pref === 'dark' ? (
        <Moon size={14} />
      ) : pref === 'light' ? (
        <Sun size={14} />
      ) : (
        <Monitor size={14} />
      )}
    </button>
  );
}
