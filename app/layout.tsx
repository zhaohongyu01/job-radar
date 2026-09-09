import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: '泉城职讯 · 招聘机会',
  description: '按城市、校招和社招查看招聘机会，收藏岗位并直达原始报名入口。',
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
