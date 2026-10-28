// Run against a dedicated local dev server. All recruitment data is intercepted.
// JOB_RADAR_PLAYWRIGHT may point to an existing Playwright installation.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixtureJob } from './fixtures/job.ts';
import { defaultFilters, selectedWorkCities } from '../lib/jobs.ts';
import { projectBrowsingJobs } from '../lib/browse-index.ts';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.JOB_RADAR_PLAYWRIGHT || 'playwright');
const base = process.env.JOB_RADAR_BROWSER_URL || 'http://127.0.0.1:3002';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Use an isolated local dev server');
const output = process.env.JOB_RADAR_BROWSER_OUTPUT;
if (output) mkdirSync(output, { recursive: true });
const A = 'aaaaaaaaaaaaaaaaaaa1', B = 'bbbbbbbbbbbbbbbbbbb2', OLD = 'ccccccccccccccccccc3';
const p1 = '/job-assets/index-00000000000000000001.json';
const p2 = '/job-assets/index-00000000000000000002.json';
const detail = '/job-assets/detail-aa-00000000000000000003.json';
const nextDetail = '/job-assets/detail-aa-00000000000000000004.json';
const lean1 = '/job-assets/index-00000000000000000005.json', lean2 = '/job-assets/index-00000000000000000006.json';
const searchPath = '/job-assets/search-00000000000000000007.json';
const jobA = fixtureJob({ id: A, title: '回归样本甲职位', sectors: ['企业 / 其他'], published_at: '2026-10-28', details_available: true });
const jobB = fixtureJob({ id: B, title: '回归样本乙职位', company: '乙公司', cities: ['上海'], location_evidence: ['工作地点：上海'], sectors: ['企业 / 其他'], published_at: '2026-10-28' });
const stored = { filters: { ...defaultFilters, city: '全部城市', workCities: [] }, viewMode: 'cards', groupCompanies: false };
const deferred = () => { let release; const promise = new Promise((r) => { release = r; }); return { promise, release }; };
const browser = await chromium.launch({ channel: process.env.JOB_RADAR_BROWSER_CHANNEL || 'msedge', headless: true });
const results = [];

async function setup(options = {}) {
  const context = await browser.newContext({ viewport: options.viewport || { width: 1440, height: 1000 } });
  await context.addInitScript((preferences) => {
    localStorage.setItem('job-radar-browsing-v1', JSON.stringify(preferences));
    localStorage.setItem('job-radar-agenda-v1', JSON.stringify({ city: '全部城市', school: '', range: 'all', mode: 'all', eventType: 'all', includeOnline: true }));
  }, options.stored || stored);
  if (options.storageBlocked) await context.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new DOMException('Blocked storage', 'SecurityError'); };
    Storage.prototype.setItem = () => { throw new DOMException('Blocked storage', 'SecurityError'); };
  });
  const page = await context.newPage(), errors = [], requests = [];
  const originals = options.rows || [jobA, jobB];
  const projection = options.lightweight ? projectBrowsingJobs(originals) : null;
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/jobs.json', (route) => route.fulfill({ json: {
    schema_version: 3, generated_at: options.generated || '2026-10-28T10:00:00+08:00', last_success_at: '2026-10-28T10:00:00+08:00',
    index_count: 2, index_shards: [p1, p2], jobs: [], cities: ['济南', '青岛', '北京', '上海'], schedule_enabled: true,
    ...(projection ? { search_url: searchPath, browse_index: { version: options.browseVersion || 1, count: projection.jobs.length, shards: [lean1, lean2], search_shards: [searchPath] } } : {}),
    detail_shards: { aa: options.detailPath || detail }, sources: [{ id: 'fixture', name: '回归来源', status: 'ok', pages: 1, parsed: 2, cached: 0 }],
  } }));
  await page.route('**/job-assets/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    const rows = options.rows || [jobA, jobB];
    if (projection && path === lean1) return route.fulfill({ json: { jobs: [projection.jobs[0]] } });
    if (projection && path === lean2) {
      if (options.second) await options.second.promise;
      return route.fulfill(options.failSecond ? { status: 503, body: 'unavailable' } : { json: { jobs: [projection.jobs[1]] } });
    }
    if (path === searchPath) {
      if (options.searchGate) await options.searchGate.promise;
      return route.fulfill({ json: { jobs: Object.fromEntries(rows.map(row => [row.id, row.excerpt || ''])) } });
    }
    if (path === p1) return route.fulfill({ json: { jobs: [rows[0]] } });
    if (path === p2) {
      if (options.second) await options.second.promise;
      return route.fulfill(options.failSecond ? { status: 503, body: 'unavailable' }
        : { json: { jobs: [options.duplicate ? rows[0] : rows[1]] } });
    }
    if ([detail, nextDetail].includes(path)) {
      const gate = options.detailGate;
      const body = path === nextDetail ? 'NEW_SNAPSHOT_BODY' : 'FULL_BODY_SUCCESS';
      options.detailStarted?.release();
      if (gate) await gate.promise;
      return route.fulfill({ json: { schema_version: 1, jobs: { [A]: { ...rows[0], body, emails: [], links: [], attachments: [] } } } });
    }
    return route.fulfill({ status: 404, body: 'not found' });
  });
  await page.goto(base + (options.query || ''), { waitUntil: 'domcontentloaded' });
  return { context, page, errors, requests, options };
}

const complete = (page) => page.locator('.result-count-num').waitFor({ timeout: 60000 });
const preview = (page) => page.getByLabel('首批预览').locator('.opp-card').first().waitFor({ timeout: 60000 });
const drawer = (page) => page.locator('[data-slot="sheet-content"]');
const preferences = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('job-radar-browsing-v1')));
async function run(name, options, check) {
  let s;
  try {
    s = await setup(options);
    await check(s);
    assert.deepEqual(s.errors, [], 'No browser runtime errors');
    results.push({ name, passed: true });
    console.log('PASS', name);
  } catch (error) {
    results.push({ name, passed: false, error: String(error.stack || error) });
    console.error('FAIL', name, error.message);
  } finally { await s?.context.close(); }
}

try {
  const searchGate = deferred();
  await run('lightweight list defers full text and details while preserving tail salary and search', {
    lightweight: true, searchGate,
    rows: [{ ...jobA, excerpt: '招聘介绍'.repeat(100) + ' 薪资：20k-30k 罕见尾部关键词', duplicate_sources: [{ title: '学校来源乙', url: 'https://example.org/repost' }] }, jobB],
  }, async ({ page, requests }) => {
    await complete(page);
    assert.ok(requests.includes(lean1) && requests.includes(lean2));
    assert.ok(!requests.includes(p1) && !requests.includes(p2));
    assert.ok(!requests.includes(searchPath) && !requests.includes(detail));
    const card = page.locator('.opp-card').filter({ hasText: jobA.title });
    assert.match(await card.innerText(), /20k-30k/);
    assert.match(await card.innerText(), /2 渠道同步/);
    assert.doesNotMatch(await card.locator('.opp-excerpt').innerText(), /罕见尾部关键词/);
    await page.getByLabel('搜索岗位、企业或专业').fill('罕见尾部关键词');
    searchGate.release();
    await page.waitForFunction(() => document.querySelectorAll('.opp-card').length === 1);
    assert.ok(requests.includes(searchPath));
    await card.getByRole('button', { name: '详情', exact: true }).click();
    await drawer(page).getByText('FULL_BODY_SUCCESS', { exact: true }).waitFor();
    assert.match(await drawer(page).innerText(), /学校来源乙/);
  });
  const leanGate = deferred();
  await run('failed lightweight shard withdraws preview without treating it as full data', { lightweight: true, second: leanGate, failSecond: true }, async ({ page }) => {
    await preview(page);
    leanGate.release();
    await page.getByRole('alert').filter({ hasText: '数据分片读取失败' }).waitFor();
    assert.equal(await page.locator('.opp-card').count(), 0);
  });
  await run('future browsing versions use the canonical compatible index', { lightweight: true, browseVersion: 99 }, async ({ page, requests }) => {
    await complete(page);
    assert.ok(requests.includes(p1) && requests.includes(p2));
    assert.ok(!requests.includes(lean1));
  });
  const second = deferred();
  await run('cold failure withdraws preview without publishing global counts', { second, failSecond: true }, async ({ page }) => {
    await preview(page);
    assert.equal(await page.locator('.result-count-num').count(), 0);
    assert.match(await page.locator('aside[aria-label="宣讲日程安排"]:visible').innerText(), /读取|加载/);
    second.release();
    await page.getByRole('alert').filter({ hasText: '数据分片读取失败' }).waitFor();
    assert.equal(await page.locator('.opp-card').count(), 0);
    assert.equal(await page.locator('.progressive-pill').count(), 0);
    assert.match(await page.getByRole('alert').first().innerText(), /预览已撤下/);
    assert.equal(await page.getByText('没有符合条件的机会', { exact: true }).count(), 0);
  });
  await run('duplicate shard never becomes a complete result', { duplicate: true }, async ({ page }) => {
    await page.getByRole('alert').filter({ hasText: '重复记录' }).waitFor({ timeout: 60000 });
    assert.equal(await page.locator('.opp-card').count(), 0);
    assert.equal(await page.locator('.result-count-num').count(), 0);
  });
  const detailSecond = deferred(), detailGate = deferred(), detailStarted = deferred();
  await run('slow detail survives cold preview completion', { second: detailSecond, detailGate, detailStarted, query: `?f=1&cities=&job=${A}` }, async ({ page, requests }) => {
    await detailStarted.promise;
    await page.locator('[data-slot="sheet-title"]').filter({ hasText: jobA.title }).waitFor();
    detailSecond.release();
    await complete(page);
    detailGate.release();
    await drawer(page).getByText('FULL_BODY_SUCCESS', { exact: true }).waitFor();
    assert.doesNotMatch(await drawer(page).innerText(), /正在读取完整公告/);
    assert.equal(requests.filter((path) => path === detail).length, 1);
  });
  await run('failed warm refresh retains the full previous snapshot', {}, async ({ page, options }) => {
    await complete(page);
    const gate = deferred();
    options.second = gate;
    options.failSecond = true;
    options.rows = [{ ...jobA, title: '未完成更新不得出现' }, jobB];
    await page.getByRole('button', { name: '重新读取招聘数据' }).click();
    await page.locator('.progressive-pill').waitFor();
    assert.equal(await page.locator('.result-count-num').innerText(), '2');
    assert.equal(await page.locator('.opp-card').count(), 2);
    assert.equal(await page.getByText('未完成更新不得出现', { exact: true }).count(), 0);
    gate.release();
    await page.getByRole('alert').filter({ hasText: '数据分片读取失败' }).waitFor();
    assert.match(await page.getByRole('alert').first().innerText(), /上次完整结果/);
    assert.equal(await page.locator('.result-count-num').innerText(), '2');
    assert.equal(await page.locator('.opp-card').count(), 2);
  });
  const oldDetailGate = deferred(), oldDetailStarted = deferred();
  await run('new snapshot details replace old cache and ignore late old responses', {}, async ({ page, options }) => {
    await complete(page);
    options.detailGate = oldDetailGate;
    options.detailStarted = oldDetailStarted;
    await page.locator('.opp-card').filter({ hasText: jobA.title }).getByRole('button', { name: '详情', exact: true }).click();
    await oldDetailStarted.promise;
    // Refresh through an actual button after closing the drawer, keeping the old request pending.
    await page.keyboard.press('Escape');
    options.detailPath = nextDetail;
    options.detailGate = undefined;
    options.generated = '2026-10-28T11:00:00+08:00';
    await page.getByRole('button', { name: '重新读取招聘数据' }).click();
    await page.getByRole('button', { name: '重新读取招聘数据' }).waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('[aria-label="重新读取招聘数据"]').disabled);
    await page.locator('.opp-card').filter({ hasText: jobA.title }).getByRole('button', { name: '详情', exact: true }).click();
    await drawer(page).getByText('NEW_SNAPSHOT_BODY', { exact: true }).waitFor();
    oldDetailGate.release();
    await page.waitForTimeout(150);
    assert.doesNotMatch(await drawer(page).innerText(), /FULL_BODY_SUCCESS/);
  });
  await run('recipient filters cannot contaminate a shared city', {
    stored: { ...stored, filters: { ...defaultFilters, city: '北京', workCities: ['北京'], salary: '20K以上', major: '会计' } }, query: '?city=青岛',
  }, async ({ page }) => {
    await complete(page);
    const state = await preferences(page);
    assert.deepEqual(selectedWorkCities(state.filters), ['青岛']);
    assert.equal(state.filters.salary, '全部');
    assert.equal(state.filters.major, '');
  });
  await run('URL conditions work without local storage', { storageBlocked: true, query: '?city=青岛' }, async ({ page }) => {
    await complete(page);
    assert.equal(new URL(page.url()).searchParams.get('city'), '青岛');
    assert.match(await page.locator('aside[aria-label="筛选条件"]:visible').innerText(), /青岛/);
  });
  await run('legacy duplicate ID opens and stays shareable', { rows: [{ ...jobA, duplicate_ids: [OLD] }, jobB], query: `?f=1&cities=&job=${OLD}` }, async ({ page }) => {
    await drawer(page).getByText('FULL_BODY_SUCCESS', { exact: true }).waitFor({ timeout: 60000 });
    assert.equal(new URL(page.url()).searchParams.get('job'), OLD);
  });
  await run('missing job link is preserved with an explanation', { query: `?job=${OLD}` }, async ({ page }) => {
    await complete(page);
    await page.getByText(/这条链接对应的机会暂不在当前索引中/).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('job'), OLD);
  });
  await run('browser history restores filters as well as the selected job', {}, async ({ page }) => {
    await complete(page);
    await page.evaluate(() => {
      history.pushState({}, '', '?f=1&city=青岛&salary=20K以上&major=会计');
      dispatchEvent(new PopStateEvent('popstate'));
    });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('job-radar-browsing-v1')).filters.major === '会计');
    await page.evaluate(() => history.back());
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('job-radar-browsing-v1')).filters.major === '');
    assert.deepEqual(selectedWorkCities((await preferences(page)).filters), []);
    assert.equal((await preferences(page)).filters.salary, '全部');
  });
  const event = fixtureJob({ id: B, source_id: 'pku-talks', kind: '宣讲会', company: '', title: '中粮集团校园宣讲会', cities: [], location_evidence: [],
    talk_event: { id: 'regression-event', date: '2099-11-01', start_time: '14:00', end_time: '16:00', school: '北京大学', city: '北京', venue: '英杰交流中心', url: 'https://example.org/event', status: 'scheduled', mode: 'offline', event_type: 'talk' } });
  await run('calendar preserves the known title when the company is empty', { rows: [jobA, event] }, async ({ page }) => {
    await complete(page);
    const title = page.locator('aside[aria-label="宣讲日程安排"]:visible .agenda-event button strong');
    await title.waitFor();
    assert.equal(await title.innerText(), event.title);
  });
  for (const width of [1440, 390]) await run(`compact calendar filters remain visible and functional at ${width}px`, {
    rows: [jobA, event], viewport: { width, height: 900 },
  }, async ({ page }) => {
    await complete(page);
    if (width === 390) await page.locator('.plan-mobile > summary').click();
    const rail = page.locator('aside[aria-label="宣讲日程安排"]:visible');
    await rail.locator('.agenda-event strong').waitFor();
    assert.equal(await rail.locator('.agenda-more').getAttribute('open'), null);
    await rail.getByLabel('参加活动城市').fill('北京');
    await rail.getByLabel('筛选宣讲学校').selectOption('北京大学');
    await rail.locator('.agenda-quick').getByRole('button', { name: '今天', exact: true }).click();
    await rail.locator('.plan-empty').waitFor();
    await rail.locator('.agenda-quick').getByRole('button', { name: '全部', exact: true }).click();
    await rail.locator('.agenda-event strong').waitFor();
    await rail.locator('.agenda-more summary').click();
    await rail.getByLabel('日程形式', { exact: true }).selectOption('online');
    await rail.getByLabel('日程类型', { exact: true }).selectOption('talk');
    await rail.getByLabel('日程日期范围', { exact: true }).selectOption('custom');
    await rail.getByLabel('活动开始日期').fill('2099-11-01');
    await rail.getByLabel('活动结束日期').fill('2099-11-02');
    await rail.locator('.agenda-more summary').click();
    await rail.locator('.plan-empty').waitFor();
    assert.match(await rail.locator('.agenda-active').innerText(), /线上/);
    assert.match(await rail.locator('.agenda-active').innerText(), /2099-11-01/);
    await rail.getByRole('button', { name: '清除附加筛选' }).click();
    await rail.locator('.agenda-event strong').waitFor();
    assert.equal(await rail.getByLabel('参加活动城市').inputValue(), '北京');
    assert.equal(await rail.getByLabel('筛选宣讲学校').inputValue(), '北京大学');
    await rail.getByRole('button', { name: '收藏活动', exact: true }).click();
    await rail.getByRole('button', { name: '取消收藏活动', exact: true }).waitFor();
    const downloaded = page.waitForEvent('download');
    await rail.getByRole('button', { name: '导出当前日程到日历' }).click();
    assert.match((await downloaded).suggestedFilename(), /\.ics$/);
    const contrast = await rail.getByRole('button', { name: '导出当前日程到日历' }).evaluate((button) => {
      const luminance = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => {
        const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
      const text = luminance(getComputedStyle(button).color);
      const background = luminance(getComputedStyle(button.closest('.plan-card')).backgroundColor);
      return (Math.max(text, background) + .05) / (Math.min(text, background) + .05);
    });
    assert.ok(contrast >= 4.5, 'Calendar export text remains readable on the light card');
    assert.ok((await rail.locator('.agenda').boundingBox()).height < 320, 'One event must not reserve a large blank panel');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (output) await page.screenshot({ path: resolve(output, `calendar-${width}.png`), fullPage: false });
  });
  await run('multi-city hints name only cities matched by this job', { stored: { ...stored, filters: { ...defaultFilters, city: '全部城市', workCities: ['北京', '上海'] } } }, async ({ page }) => {
    await complete(page);
    assert.equal(await page.locator('.opp-card').filter({ hasText: jobA.title }).locator('.opp-loc-note').innerText(), '工作地含北京');
    assert.equal(await page.locator('.opp-card').filter({ hasText: jobB.title }).locator('.opp-loc-note').innerText(), '工作地含上海');
  });
  await run('official source brand appears on department-only company cards', { rows: [{ ...jobA, source_id: 'hisense-campus', company: '全球营销中心-中国区', title: '销售经理（全国）(J45816)' }, jobB] }, async ({ page }) => {
    await complete(page);
    assert.match(await page.locator('.opp-card').first().innerText(), /海信集团 · 全球营销中心-中国区/);
  });
  for (const width of [1440, 390]) await run(`no horizontal overflow at ${width}px`, { viewport: { width, height: 900 } }, async ({ page }) => {
    await complete(page);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Page fits viewport');
    if (output) await page.screenshot({ path: resolve(output, `workspace-${width}.png`), fullPage: false });
  });
} finally { await browser.close(); }
if (output) writeFileSync(resolve(output, 'browser-report.json'), JSON.stringify(results, null, 2));
assert.deepEqual(results.filter((result) => !result.passed), [], 'Browser regression failures (see report)');
console.log(`${results.length} browser regressions passed`);
