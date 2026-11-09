'use client';

import { useEffect } from 'react';
import { report } from '@/lib/rum';

interface LayoutShiftEntry extends PerformanceEntry {
  value?: number;
  hadRecentInput?: boolean;
}

export function RumObserver() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const msg = event.message || (event.error instanceof Error ? event.error.message : '') || 'window_error';
      report('error', msg.slice(0, 60));
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const msg =
        reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
            ? reason
            : 'unhandled_rejection';
      report('error', (msg || 'unhandled_rejection').slice(0, 60));
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    let lcpValue: number | null = null;
    let clsValue = 0;
    let clsObserved = false;
    let vitalsReported = false;
    let lcpObserver: PerformanceObserver | null = null;
    let clsObserver: PerformanceObserver | null = null;

    if (typeof PerformanceObserver !== 'undefined') {
      try {
        lcpObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const last = entries[entries.length - 1];
          if (last) lcpValue = last.startTime;
        });
        lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
      } catch {
        lcpObserver = null;
      }

      try {
        clsObserver = new PerformanceObserver((list) => {
          clsObserved = true;
          for (const entry of list.getEntries() as LayoutShiftEntry[]) {
            if (!entry.hadRecentInput && typeof entry.value === 'number') {
              clsValue += entry.value;
            }
          }
        });
        clsObserver.observe({ type: 'layout-shift', buffered: true });
      } catch {
        clsObserver = null;
      }
    }

    const flushVitals = () => {
      if (vitalsReported || document.visibilityState !== 'hidden') return;
      vitalsReported = true;
      lcpObserver?.disconnect();
      clsObserver?.disconnect();
      if (lcpValue !== null) {
        report('vital', 'LCP', Math.round(lcpValue));
      }
      if (clsObserved) {
        report('vital', 'CLS', Number(clsValue.toFixed(4)));
      }
    };

    document.addEventListener('visibilitychange', flushVitals);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      document.removeEventListener('visibilitychange', flushVitals);
      lcpObserver?.disconnect();
      clsObserver?.disconnect();
    };
  }, []);

  return null;
}
