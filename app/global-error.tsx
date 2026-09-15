'use client';

import { useEffect, useState } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    console.error('Global Error Caught:', error);
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
    <html lang="zh-CN">
      <body style={{
        margin: 0,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        background: '#f9fafb',
        color: '#111827',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        padding: '24px'
      }}>
        <div style={{
          maxWidth: '440px',
          width: '100%',
          background: '#ffffff',
          border: '1px solid #e5e7eb',
          borderRadius: '12px',
          padding: '32px 24px',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.06)',
          textAlign: 'center'
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
            color: '#ef4444',
            fontSize: '24px',
            fontWeight: 'bold'
          }}>
            !
          </div>
          <h2 style={{ fontSize: '20px', fontWeight: 600, margin: '0 0 8px' }}>
            职讯雷达加载失败
          </h2>
          <p style={{ fontSize: '14px', color: '#6b7280', margin: '0 0 24px', lineHeight: 1.5 }}>
            客户端环境渲染发生异常。你可以尝试重新加载页面，或清除本地设置缓存。
          </p>

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => reset()}
              style={{
                background: '#2563eb',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                padding: '8px 16px',
                fontSize: '14px',
                fontWeight: 500,
                cursor: 'pointer'
              }}
            >
              重新加载
            </button>
            <button
              onClick={handleClearPreferences}
              style={{
                background: '#ffffff',
                color: '#374151',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                padding: '8px 16px',
                fontSize: '14px',
                fontWeight: 500,
                cursor: 'pointer'
              }}
            >
              重置缓存
            </button>
          </div>

          <div style={{ marginTop: '20px' }}>
            <button
              type="button"
              onClick={() => setShowDetail((v) => !v)}
              style={{
                background: 'none',
                border: 'none',
                color: '#9ca3af',
                fontSize: '12px',
                cursor: 'pointer',
                textDecoration: 'underline'
              }}
            >
              {showDetail ? '收起诊断信息' : '查看诊断信息'}
            </button>
            {showDetail && (
              <pre style={{
                marginTop: '12px',
                padding: '12px',
                background: '#f3f4f6',
                borderRadius: '6px',
                fontSize: '11px',
                textAlign: 'left',
                overflowX: 'auto',
                maxHeight: '160px',
                color: '#374151',
                whiteSpace: 'pre-wrap'
              }}>
                {error.message || '未知错误'}
                {error.stack ? `\n\n${error.stack}` : ''}
              </pre>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}
