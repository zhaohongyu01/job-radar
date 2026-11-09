import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '职讯雷达',
    short_name: '职讯雷达',
    description: '聚合高校就业网、政府与企业官方公告，按城市追踪校招、社招与山东考公考编。',
    start_url: '/',
    display: 'standalone',
    background_color: '#f6f4ee',
    theme_color: '#1f4d3a',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
  };
}
