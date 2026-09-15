'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, AlertTriangle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    console.error('App Router Caught Error:', error);
  }, [error]);

  const handleClearPreferences = () => {
    try {
      localStorage.removeItem('job-radar-browsing-v1');
      localStorage.removeItem('job-radar-page-size-v1');
      localStorage.removeItem('job-radar-presets-v1');
      localStorage.removeItem('job-radar-active-preset-v1');
    } catch {}
    window.location.reload();
  };

  return (
    <div className="error-boundary-container" style={{
      minHeight: '80vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      textAlign: 'center',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{
        maxWidth: '440px',
        width: '100%',
        background: 'var(--card, #ffffff)',
        border: '1px solid var(--border, #e5e7eb)',
        borderRadius: '12px',
        padding: '32px 24px',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.06)'
      }}>
        <div style={{
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          background: 'rgba(239, 68, 68, 0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 16px',
          color: '#ef4444'
        }}>
          <AlertTriangle size={24} />
        </div>
        <h2 style={{ fontSize: '20px', fontWeight: 600, margin: '0 0 8px', color: 'var(--foreground, #111827)' }}>
          页面加载遇到异常
        </h2>
        <p style={{ fontSize: '14px', color: 'var(--muted-foreground, #6b7280)', margin: '0 0 24px', lineHeight: 1.5 }}>
          招聘雷达遇到客户端渲染错误。你可以尝试重新加载页面，或重置筛选设置。
        </p>

        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button onClick={() => reset()} variant="default" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <RefreshCw size={15} />
            重试加载
          </Button>
          <Button onClick={handleClearPreferences} variant="outline" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Trash2 size={15} />
            恢复默认设置
          </Button>
        </div>

        <div style={{ marginTop: '20px' }}>
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--muted-foreground, #9ca3af)',
              fontSize: '12px',
              cursor: 'pointer',
              textDecoration: 'underline'
            }}
          >
            {showDetail ? '收起错误诊断信息' : '查看错误诊断信息'}
          </button>
          {showDetail && (
            <pre style={{
              marginTop: '12px',
              padding: '12px',
              background: 'var(--muted, #f3f4f6)',
              borderRadius: '6px',
              fontSize: '11px',
              textAlign: 'left',
              overflowX: 'auto',
              maxHeight: '160px',
              color: 'var(--foreground, #374151)',
              whiteSpace: 'pre-wrap'
            }}>
              {error.message || '未知错误'}
              {error.stack ? `\n\n${error.stack}` : ''}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
