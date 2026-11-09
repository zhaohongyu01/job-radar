import type { NextConfig } from 'next';

const security = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: security }];
  },
  async redirects() {
    return [
      { source: '/', has: [{ type: 'query', key: 'workspace', value: 'exams' }], destination: '/exams', permanent: false },
      { source: '/', has: [{ type: 'query', key: 'mode', value: 'exams' }], destination: '/exams', permanent: false },
    ];
  },
};

export default nextConfig;
