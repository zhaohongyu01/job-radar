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
    let cached: Response | undefined;
    try { cached = await cache?.match(key); } catch { /* Optional edge-cache failure must not block the source. */ }
    // Cache API responses have immutable headers. Vinext appends route headers
    // after GET returns, so returning the cached object itself crashes on hits.
    if (cached) return new Response(cached.body, cached);
    // Both fixed GitHub delivery paths share one deadline. Some edge locations
    // cannot read raw.githubusercontent.com even while the public branch exists.
    const signal = AbortSignal.timeout(5000);
    const locations = [
      `https://raw.githubusercontent.com/${delivery.repository}/${delivery.branch}/${delivery.directory}/${file}`,
      `https://api.github.com/repos/${delivery.repository}/contents/${delivery.directory}/${file}?ref=${delivery.branch}`,
    ];
    let body: string | undefined;
    for (const location of locations) {
      try {
        // Workers supports manual/follow only. A manual non-2xx response is
        // rejected below, so redirects can never turn this into an open proxy.
        const upstream = await fetch(location, { signal, redirect: 'manual', headers: {
          'User-Agent': 'JobRadar-Public-Reputation', 'Accept': 'application/vnd.github.raw+json',
        } });
        if (!upstream.ok) {
          console.warn('reputation_upstream_http', new URL(location).hostname, upstream.status);
          continue;
        }
        const candidate = await upstream.text();
        if (candidate.length > 2000000) throw Error('Oversized reputation asset');
        JSON.parse(candidate);
        body = candidate;
        break;
      } catch (error) {
        console.warn('reputation_upstream_unavailable', new URL(location).hostname, error instanceof Error ? error.message : 'unknown');
      }
    }
    if (body === undefined) return Response.json({ error: 'Reputation update unavailable' }, { status: 503 });
    const response = new Response(body, { headers: { 'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': file === 'index.json' ? 'public, max-age=300, s-maxage=300' : 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff' } });
    try { await cache?.put(key, response.clone()); } catch { /* Cache availability does not invalidate data. */ }
    return response;
  } catch (error) {
    console.warn('reputation_delivery_unavailable', error instanceof Error ? error.message : 'unknown');
    return Response.json({ error: 'Reputation update unavailable' }, { status: 503 });
  }
}
