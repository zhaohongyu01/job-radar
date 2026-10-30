// Isolated browser benchmark against a frozen, already-downloaded snapshot.
// Local routing latency is explicit; results are not public-network timings.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { performance } from 'node:perf_hooks';
import { defaultFilters, mergeDuplicateOpportunities, filterJobs } from '../lib/jobs.ts';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: benchmark_browser_index.mjs frozen/public/jobs.json report.json');
const base = process.env.JOB_RADAR_BROWSER_URL || 'http://127.0.0.1:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const { chromium } = createRequire(import.meta.url)(process.env.JOB_RADAR_PLAYWRIGHT || 'playwright');
const root = dirname(resolve(input)), raw = readFileSync(input), snapshot = JSON.parse(raw);
const paths = snapshot.browse_index?.version === 1 ? snapshot.browse_index.shards : snapshot.index_shards;
assert.ok(paths?.length, 'A sharded snapshot is required');
const assets = new Map(paths.map(path => {
  assert.match(path, /^\/job-assets\/index-[a-f0-9]{20}\.json$/);
  const target = resolve(root, path.slice(1)), rel = relative(root, target);
  assert.ok(!rel.startsWith('..') && !isAbsolute(rel));
  return [path, readFileSync(target)];
}));
const jobs = [...assets.values()].flatMap(body => JSON.parse(body).jobs);
const filters = { ...defaultFilters, city: '全部城市', workCities: [] };
const at = Date.parse(snapshot.generated_at);
const expected = filterJobs(mergeDuplicateOpportunities(jobs), filters, {}, null, at).length;
const latency = 150, results = [];
const browser = await chromium.launch({ channel: process.env.JOB_RADAR_BROWSER_CHANNEL || 'msedge', headless: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    try {
      let indexCalls = 0, metadataCalls = 0, first = null;
      const errors = [], auxiliary = [], unexpected = [];
      await context.addInitScript(({ filters, at }) => {
        Date.now = () => at;
        localStorage.setItem('job-radar-browsing-v1', JSON.stringify({ filters, viewMode: 'cards', groupCompanies: true }));
        window.__benchmarkTasks = [];
        new PerformanceObserver(list => window.__benchmarkTasks.push(...list.getEntries().map(entry => entry.duration))).observe({ type: 'longtask', buffered: true });
      }, { filters, at });
      await context.route(/\/(?:api\/reputation(?:\?|$)|reputation\/)/, route => route.fulfill({ status: 503, json: { error: 'isolated performance benchmark' } }));
      await context.route('**/jobs.json', route => { metadataCalls++; return route.fulfill({ contentType: 'application/json', body: raw }); });
      await context.route('**/job-assets/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (!assets.has(path)) {
          if (/^\/job-assets\/coverage-[a-f0-9]{20}\.json$/.test(path)) {
            auxiliary.push(path);
            return route.fulfill({ contentType: 'application/json', body: readFileSync(resolve(root, path.slice(1))) });
          }
          unexpected.push(path);
          return route.fulfill({ status: 404, body: 'Unexpected benchmark asset' });
        }
        indexCalls++;
        await new Promise(done => setTimeout(done, latency));
        return route.fulfill({ contentType: 'application/json', body: assets.get(path) });
      });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      const cdp = await context.newCDPSession(page); await cdp.send('Performance.enable');
      const start = performance.now();
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.locator('.opp-card').first().waitFor({ timeout: 120000 }); first = performance.now() - start;
      await page.locator('.result-count-num').waitFor({ timeout: 120000 });
      const cold = performance.now() - start, count = await page.locator('.result-count-num').innerText();
      assert.equal(Number(count.replaceAll(',', '')), expected);
      const firstReads = indexCalls;
      const before = await cdp.send('Performance.getMetrics');
      const warmStart = performance.now();
      await page.getByRole('button', { name: '重新读取招聘数据' }).click();
      await page.waitForFunction(() => !document.querySelector('[aria-label="重新读取招聘数据"]')?.disabled);
      const warm = performance.now() - warmStart;
      assert.equal(metadataCalls, 2); assert.equal(indexCalls, firstReads);
      assert.equal(await page.locator('.result-count-num').innerText(), count);
      const after = await cdp.send('Performance.getMetrics');
      const heap = metrics => metrics.metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value;
      results.push({ width, jobs: jobs.length, visible_results: expected, first_card_ms: first, complete_ms: cold, warm_refresh_ms: warm,
        initial_index_requests: firstReads, warm_index_requests: indexCalls - firstReads,
        heap_used_bytes_before_refresh: heap(before), heap_used_bytes_after_refresh: heap(after),
        long_tasks_ms: await page.evaluate(() => window.__benchmarkTasks), auxiliary_assets: auxiliary, unexpected_assets: unexpected, errors });
      assert.deepEqual(errors, []);
      assert.deepEqual(unexpected, [], 'No search or detail prefetch is expected');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
const report = { snapshot_generated_at: snapshot.generated_at, simulated_asset_latency_ms: latency, source_requests: 0,
  runtime: process.env.JOB_RADAR_BENCHMARK_RUNTIME || 'local-development',
  note: 'Local server, frozen real assets and isolated Edge contexts; viewport sizes do not simulate phone CPU or mobile/public network. Heap is a point-in-time measurement without forced GC.', results };
mkdirSync(dirname(resolve(output)), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
