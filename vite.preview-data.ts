import type { ProxyOptions } from 'vite';

export const LIVE_DATA_SITE = 'https://sites-project.job-radar.workers.dev';

/** Development should show the same real dataset as the published website. */
export function previewDataProxy(mode = process.env.JOB_RADAR_PREVIEW_DATA) {
  if (mode === 'local') return undefined;
  const options: ProxyOptions = {
    target: LIVE_DATA_SITE,
    changeOrigin: true,
    proxyTimeout: 30_000,
    timeout: 35_000,
    configure(proxy) {
      proxy.on('proxyRes', (response, request) => {
        response.headers['x-job-radar-data-origin'] = 'live';
        response.headers['cache-control'] = request.url?.startsWith(
          '/job-assets/',
        )
          ? 'public, max-age=31536000, immutable'
          : 'no-cache';
      });
    },
  };
  return {
    '/jobs.json': options,
    '/job-assets/': options,
    '/snapshot-manifest.json': options,
  };
}
