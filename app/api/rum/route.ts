import { validateRumPayload } from '../../../lib/rum.ts';

const MAX_RUM_BYTES = 4096;

/** Privacy-safe RUM ingestion endpoint.
 * Logs validated aggregate events/vitals/errors to Workers Logs and returns 204.
 * Never logs IP addresses, user-agent headers, search queries, or record IDs. */
export async function POST(request: Request): Promise<Response> {
  const contentType = (request.headers.get('content-type') || '').toLowerCase();
  if (!contentType.startsWith('application/json')) {
    return new Response(null, { status: 415, headers: { 'Cache-Control': 'no-store' } });
  }

  const declaredLength = Number(request.headers.get('content-length') || '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RUM_BYTES) {
    return new Response(null, { status: 413, headers: { 'Cache-Control': 'no-store' } });
  }

  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return new Response(null, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  if (new TextEncoder().encode(rawText).length > MAX_RUM_BYTES) {
    return new Response(null, { status: 413, headers: { 'Cache-Control': 'no-store' } });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return new Response(null, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const validated = validateRumPayload(parsed);
  if (!validated) {
    return new Response(null, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  console.log(JSON.stringify({ rum: validated }));
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
}
