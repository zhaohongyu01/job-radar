import type { Metadata, Viewport } from 'next';
import './globals.css';
import './design.css';
import './data-health.css';
import './feature-updates.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://sites-project.job-radar.workers.dev'),
  title: { default: '职讯雷达 · 校招社招与考公考编追踪', template: '%s · 职讯雷达' },
  description: '聚合高校就业网、政府与企业官方公告，按城市追踪校招、社招与山东考公考编，收藏岗位、跟进投递与报考进度。',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192' },
    ],
    apple: '/apple-touch-icon.png',
  },
  manifest: '/manifest.webmanifest',
  openGraph: {
    type: 'website',
    siteName: '职讯雷达',
    locale: 'zh_CN',
    images: [{ url: '/og.png', width: 1200, height: 630 }],
  },
  twitter: { card: 'summary_large_image', images: ['/og.png'] },
  alternates: { canonical: '/' },
};

export const viewport: Viewport = {
  themeColor: '#1f4d3a',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
