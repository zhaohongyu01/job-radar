import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="page" style={{ minHeight: '72vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', maxWidth: 420, padding: '32px 24px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>页面不存在</h1>
        <p style={{ color: 'var(--ink-3)', fontSize: 14, marginBottom: 24 }}>
          你访问的链接可能已过期或地址有误，请从下方入口返回工作台。
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/" className="btn btn-primary">
            回到招聘机会
          </Link>
          <Link href="/exams" className="btn btn-secondary">
            考公考编
          </Link>
        </div>
      </div>
    </main>
  );
}
