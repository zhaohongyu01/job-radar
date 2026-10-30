import delivery from '../../../config/reputation-delivery.json' with { type: 'json' };
import { validReputationFile } from '../../../lib/reputation-loader.ts';

/** Read-only edge proxy. Publishing is isolated on a data branch; no user
 * notes, tokens, source crawling or arbitrary URL forwarding are involved. */
export async function GET(request: Request): Promise<Response> {
  const file = new URL(request.url).searchParams.get('file') || 'index.json';
  if (!validReputationFile(file)) return Response.json({ error: 'Invalid reputation asset' }, { status: 400 });
  const cache = (globalThis as typeof globalThis & { caches?: CacheStorage & { default?: Cache } }).caches?.default;
  const key = new Request(`${new URL(request.url).origin}/api/reputation?file=${encodeURIComponent(file)}`);
  try {
    const cached = await cache?.match(key);
    if (cached) return cached;
    const upstream = await fetch(`https://raw.githubusercontent.com/${delivery.repository}/${delivery.branch}/${delivery.directory}/${file}`,
      { signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!upstream.ok) return Response.json({ error: 'Reputation update unavailable' }, { status: 503 });
    const body = await upstream.text();
    if (body.length > 2000000) throw Error('Oversized reputation asset');
    JSON.parse(body);
    const response = new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': file === 'index.json' ? 'public, max-age=300, s-maxage=300' : 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff' } });
    try { await cache?.put(key, response.clone()); } catch { /* Cache availability does not invalidate data. */ }
    return response;
  } catch {
    return Response.json({ error: 'Reputation update unavailable' }, { status: 503 });
  }
}
