import { queryRadarJobs } from '../../../../lib/server/radar-db.ts';

/** Portable Edge/Node query endpoint for instant first-screen job cards & facet counts.
 * Zero personal state is accepted or logged; identical filter URLs are safely cached at the CDN edge. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const result = await queryRadarJobs(url.searchParams);

  const cacheHeader = result.ok
    ? 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600'
    : 'public, max-age=15, s-maxage=30';

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheHeader,
    },
  });
}
