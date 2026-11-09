import assert from 'node:assert/strict';
import test from 'node:test';
import { POST } from '../app/api/rum/route.ts';
import {
  RUM_SAMPLE_STORAGE_KEY,
  resolveRumPage,
  shouldSample,
  validateRumPayload,
} from '../lib/rum.ts';

void test('validateRumPayload accepts valid events/vitals/errors and strips unknown PII fields', () => {
  const clean = validateRumPayload({
    type: 'event',
    name: 'open_detail',
    page: '/',
    ts: 1762700000000,
    query: '绝不应保留的搜索词',
    jobId: 'secret-id',
  });
  assert.deepEqual(clean, {
    type: 'event',
    name: 'open_detail',
    page: '/',
    ts: 1762700000000,
  });

  const vital = validateRumPayload({
    type: 'vital',
    name: 'LCP',
    value: 1420,
    page: '/exams',
    ts: 1762700000000,
  });
  assert.deepEqual(vital, {
    type: 'vital',
    name: 'LCP',
    value: 1420,
    page: '/exams',
    ts: 1762700000000,
  });

  assert.equal(validateRumPayload({ type: 'invalid', name: 'x', page: '/', ts: 1 }), null);
  assert.equal(validateRumPayload({ type: 'event', name: '', page: '/', ts: 1 }), null);
  assert.equal(validateRumPayload({ type: 'event', name: 'a'.repeat(61), page: '/', ts: 1 }), null);
  assert.equal(validateRumPayload({ type: 'event', name: 'search', page: '/other', ts: 1 }), null);
  assert.equal(validateRumPayload({ type: 'vital', name: 'LCP', value: Number.NaN, page: '/', ts: 1 }), null);
});

void test('shouldSample always reports errors and applies 20% sticky session sampling to vitals/events', () => {
  const store = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
  };

  assert.equal(shouldSample('error', mockStorage, () => 0.99), true);
  assert.equal(shouldSample('event', mockStorage, () => 0.85), false);
  assert.equal(store.get(RUM_SAMPLE_STORAGE_KEY), '0.85');
  // Sticky within the same session even if randomFn would return < 0.2 next time
  assert.equal(shouldSample('vital', mockStorage, () => 0.01), false);
  assert.equal(shouldSample('error', mockStorage, () => 0.99), true);

  store.clear();
  assert.equal(shouldSample('event', mockStorage, () => 0.12), true);
  assert.equal(shouldSample('vital', mockStorage, () => 0.99), true);
  assert.equal(resolveRumPage('/exams?exam=123'), '/exams');
  assert.equal(resolveRumPage('/?job=abc'), '/');
});

void test('POST /api/rum enforces JSON content-type, 4KB limit, schema validation and logs sanitized payload', async () => {
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (msg: unknown) => {
    logs.push(String(msg));
  };

  try {
    const okRes = await POST(
      new Request('http://127.0.0.1:3000/api/rum', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          type: 'error',
          name: 'digest_abc',
          page: '/exams',
          ts: 1762700000123,
          ip: '1.2.3.4',
        }),
      }),
    );
    assert.equal(okRes.status, 204);
    assert.equal(logs.length, 1);
    assert.deepEqual(JSON.parse(logs[0]), {
      rum: {
        type: 'error',
        name: 'digest_abc',
        page: '/exams',
        ts: 1762700000123,
      },
    });

    const wrongType = await POST(
      new Request('http://127.0.0.1:3000/api/rum', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: '{}',
      }),
    );
    assert.equal(wrongType.status, 415);

    const tooLarge = await POST(
      new Request('http://127.0.0.1:3000/api/rum', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'event',
          name: 'open_detail',
          page: '/',
          ts: 1,
          pad: 'x'.repeat(4200),
        }),
      }),
    );
    assert.equal(tooLarge.status, 413);

    const badPayload = await POST(
      new Request('http://127.0.0.1:3000/api/rum', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'event', name: 'x', page: '/unknown', ts: 1 }),
      }),
    );
    assert.equal(badPayload.status, 400);
    assert.equal(logs.length, 1);
  } finally {
    console.log = origLog;
  }
});
