import type { Plugin, ProxyOptions } from 'vite';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';

export const LIVE_DATA_SITE = 'https://sites-project.job-radar.workers.dev';

export function previewFilePath(root: string, request: string): string {
  const path = decodeURIComponent(request.split('?')[0]);
  if (!/^\/(?:jobs\.json|snapshot-manifest\.json|job-assets\/[a-z0-9-]+\.json)$/.test(path)) throw Error('Invalid preview asset');
  const target = realpathSync(resolve(root, path.slice(1)));
  const inside = relative(realpathSync(root), target);
  if (inside.startsWith('..') || isAbsolute(inside)) throw Error('Preview asset escaped directory');
  return target;
}

/** Explicit local preview reads a complete isolated export, never the live fallback. */
export function previewDataDirectory(): Plugin {
  return {
    name: 'job-radar-local-snapshot',
    configureServer(server) {
      const configured = process.env.JOB_RADAR_PREVIEW_DATA_DIR;
      if (process.env.JOB_RADAR_PREVIEW_DATA !== 'local' || !configured) return;
      const root = realpathSync(resolve(configured));
      if (!statSync(root).isDirectory()) throw Error('Preview snapshot directory is invalid');
      server.middlewares.use((request, response, next) => {
        if (!/^\/(?:jobs\.json|snapshot-manifest\.json|job-assets\/)/.test(request.url || '')) return next();
        try {
          const path = previewFilePath(root, request.url || '');
          response.setHeader('content-type', 'application/json; charset=utf-8');
          response.setHeader('cache-control', 'no-cache');
          response.setHeader('x-job-radar-data-origin', 'local');
          response.end(readFileSync(path));
        } catch {
          response.statusCode = 500;
          response.end('Local snapshot is missing or invalid; no fallback used');
        }
      });
    },
  };
}

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
