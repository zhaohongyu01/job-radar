// Uses an isolated browser context and intercepted fixtures; never changes a
// real user's records or downloads recruitment data from source sites.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fixtureJob } from './fixtures/job.ts';
import { defaultFilters } from '../lib/jobs.ts';

const { chromium } = createRequire(import.meta.url)(process.env.JOB_RADAR_PLAYWRIGHT || 'playwright');
const base = process.env.JOB_RADAR_BROWSER_URL || 'http://127.0.0.1:3002';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const output = process.env.JOB_RADAR_BROWSER_OUTPUT;
if (output) mkdirSync(output, { recursive: true });
const A = 'aaaaaaaaaaaaaaaaaaa1', B = 'bbbbbbbbbbbbbbbbbbb2';
const personalKey = 'quancheng-personal-v1';
const at = Date.parse('2026-10-29T12:00:00+08:00');
const jobA = fixtureJob({ id: A, title: '回归岗位甲', company: '甲公司', sectors: ['企业 / 其他'] });
const jobB = fixtureJob({ id: B, title: '回归岗位乙', company: '乙公司', sectors: ['企业 / 其他'], cities: ['上海'] });
const browser = await chromium.launch({ channel: process.env.JOB_RADAR_BROWSER_CHANNEL || 'msedge', headless: true });
const results = [];
const complete = (page) => page.locator('.result-count-num').waitFor({ timeout: 60000 });
const drawer = (page) => page.locator('[data-slot="sheet-content"]:visible');
const tracker = (page) => drawer(page).locator('.application-tracker');
const records = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), personalKey);
async function searchStarted(page, readCount) {
  const until = Date.now() + 10000;
  while (!readCount() && Date.now() < until) await page.waitForTimeout(25);
  assert.ok(readCount(), 'Full-text request must start within 10 seconds');
}
async function saved(page, text = '跟进记录已保存') {
  await tracker(page).locator('output').filter({ hasText: text }).waitFor();
}
async function openDetail(page) {
  await page.locator('.opp-card').filter({ hasText: jobA.title }).getByRole('button', { name: '详情', exact: true }).click();
  await drawer(page).getByText('完整回归招聘说明', { exact: true }).waitFor();
}
async function secondPage(context) {
  const page = await context.newPage();
  await page.goto(base, { waitUntil: 'domcontentloaded' }); await complete(page);
  return page;
}
async function setup(options = {}) {
  const context = await browser.newContext({ viewport: { width: options.width || 1440, height: options.height || 1000 } });
  await context.route(/\/(?:api\/reputation(?:\?|$)|reputation\/)/, route => route.fulfill({ status: 503, json: { error: 'isolated fixture' } }));
  const jobs = options.jobs || [jobA, jobB];
  let searchCalls = 0, listCalls = 0;
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.addInitScript(({ state, filters, clock }) => {
    Date.now = () => clock;
    if (!['http:', 'https:'].includes(location.protocol)) return;
    if (localStorage.getItem('regression-init')) return;
    localStorage.setItem('regression-init', 'yes');
    localStorage.setItem('quancheng-personal-v1', JSON.stringify(state));
    localStorage.setItem('job-radar-browsing-v1', JSON.stringify({ filters, viewMode: 'cards', groupCompanies: false }));
    localStorage.setItem('job-radar-reminders-v1', 'true');
    localStorage.setItem('job-radar-agenda-v1', JSON.stringify({ city: '全部城市', school: '', range: 'all', mode: 'all', eventType: 'all', includeOnline: false }));
  }, { state: options.records || {}, filters: options.filters || { ...defaultFilters, city: '全部城市', workCities: [] }, clock: at });
  await context.route('**/jobs.json', route => {
    listCalls++;
    return route.fulfill({ json: {
      schema_version: 2, generated_at: '2026-10-29T12:00:00+08:00', last_success_at: '2026-10-29T12:00:00+08:00', schedule_enabled: true,
      jobs, cities: ['北京', '上海', '济南', '青岛'], sources: [{ id: 'fixture', name: '回归来源', status: 'ok', pages: 1 }],
      detail_shards: { aa: '/job-assets/detail-aa-11111111111111111111.json' },
      ...(options.search ? { search_url: '/job-assets/search-33333333333333333333.json' } : {}),
    } });
  });
  await context.route('**/job-assets/**', async route => {
    if (route.request().url().includes('/search-')) {
      const call = ++searchCalls;
      if (options.searchReply) return route.fulfill({ json: await options.searchReply(call) });
      if (options.searchGate) await options.searchGate;
      if (options.searchFailure && searchCalls === 1) return route.fulfill({ status: 503, body: 'temporary failure' });
      return route.fulfill({ json: { jobs: Object.fromEntries(jobs.map(j => [j.id, j.title])) } });
    }
    return route.fulfill({ json: { schema_version: 1, jobs: Object.fromEntries(jobs.map(j => [j.id,
      { ...j, body: '完整回归招聘说明', emails: [], links: [], attachments: [] }])) } });
  });
  const page = await secondPage(context);
  return { context, page, errors, searchCalls: () => searchCalls, listCalls: () => listCalls };
}
async function run(name, options, check) {
  if (process.env.JOB_RADAR_UI_CASE && !name.includes(process.env.JOB_RADAR_UI_CASE)) return;
  let state;
  try {
    state = await setup(options); await check(state);
    assert.deepEqual(state.errors, [], 'No browser runtime errors');
    results.push({ name, passed: true }); console.log('PASS', name);
  } catch (error) {
    results.push({ name, passed: false, error: String(error.stack || error) });
    console.error('FAIL', name, error.message);
    if (output && state?.page) await state.page.screenshot({ path: `${output}/failure-${results.length}.png` }).catch(() => {});
  } finally { await state?.context.close(); }
}
async function importBackup(page, data, preferImported = false) {
  await page.locator('input[type=file]').first().setInputFiles({ name: 'regression.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await page.getByRole('button', { name: preferImported ? '合并，冲突以备份为准' : '合并，保留本机冲突状态', exact: true }).click();
  await page.getByText('备份已合并；个人记录、活动及设置已保存。', { exact: true }).waitFor();
}

try {
  await run('two tabs retain saves, explicit cancellations and reload state', {}, async ({ context, page }) => {
    const second = await secondPage(context);
    await page.getByRole('button', { name: '收藏：回归岗位甲', exact: true }).click();
    await second.getByRole('button', { name: '取消收藏：回归岗位甲', exact: true }).waitFor();
    await second.getByRole('button', { name: '收藏：回归岗位乙', exact: true }).click();
    await page.getByRole('button', { name: '取消收藏：回归岗位乙', exact: true }).waitFor();
    assert.equal((await records(page))[A].saved, true); assert.equal((await records(page))[B].saved, true);
    await page.getByRole('button', { name: '取消收藏：回归岗位甲', exact: true }).click();
    await second.getByRole('button', { name: '收藏：回归岗位甲', exact: true }).waitFor();
    await second.reload(); await complete(second);
    assert.equal((await records(second))[A].saved, false); assert.equal((await records(second))[B].saved, true);
  });
  await run('simultaneous cross-tab writes preserve both jobs under the browser lock', {}, async ({ context, page }) => {
    const second = await secondPage(context);
    assert.equal(await page.evaluate(() => typeof navigator.locks?.request), 'function');
    await Promise.all([
      page.getByRole('button', { name: '收藏：回归岗位甲', exact: true }).click(),
      second.getByRole('button', { name: '收藏：回归岗位乙', exact: true }).click(),
    ]);
    await page.getByRole('button', { name: '取消收藏：回归岗位乙', exact: true }).waitFor();
    await second.getByRole('button', { name: '取消收藏：回归岗位甲', exact: true }).waitFor();
    assert.equal((await records(page))[A].saved, true); assert.equal((await records(page))[B].saved, true);
  });
  await run('notes keep a draft and applied time after a quick apply action', {}, async ({ page }) => {
    await openDetail(page);
    await tracker(page).locator('textarea').fill('原有草稿要保留');
    await drawer(page).getByRole('button', { name: '标记已投递', exact: true }).click();
    await drawer(page).getByRole('button', { name: '已投递', exact: true }).waitFor();
    assert.equal(await tracker(page).locator('select').inputValue(), 'applied');
    assert.equal(await tracker(page).locator('textarea').inputValue(), '原有草稿要保留');
    const appliedTime = (await records(page))[A].applied_at;
    assert.ok(appliedTime);
    await tracker(page).getByRole('button', { name: '保存跟进记录', exact: true }).click(); await saved(page);
    const actual = (await records(page))[A];
    assert.equal(actual.applied, true); assert.equal(actual.application_stage, 'applied');
    assert.equal(actual.applied_at, appliedTime); assert.equal(actual.notes, '原有草稿要保留');
  });
  await run('different edited fields merge across open detail drawers', {}, async ({ context, page }) => {
    await openDetail(page);
    const second = await secondPage(context); await openDetail(second);
    await tracker(page).locator('textarea').fill('本页备注草稿');
    await tracker(second).locator('select').selectOption('interview');
    await tracker(second).getByLabel('下一步安排', { exact: true }).fill('另一页安排');
    await tracker(second).getByRole('button', { name: '保存跟进记录', exact: true }).click(); await saved(second);
    await page.waitForFunction(() => document.querySelector('.application-tracker select')?.value === 'interview');
    assert.equal(await tracker(page).locator('textarea').inputValue(), '本页备注草稿');
    await tracker(page).getByRole('button', { name: '保存跟进记录', exact: true }).click(); await saved(page);
    const actual = (await records(page))[A];
    assert.equal(actual.application_stage, 'interview'); assert.equal(actual.next_action_note, '另一页安排');
    assert.equal(actual.notes, '本页备注草稿');
  });
  await run('same-field cross-tab conflict keeps draft until an explicit choice', {}, async ({ context, page }) => {
    await openDetail(page); const second = await secondPage(context); await openDetail(second);
    await tracker(page).locator('textarea').fill('本页未保存草稿');
    await tracker(second).locator('textarea').fill('另一页已保存备注');
    await tracker(second).getByRole('button', { name: '保存跟进记录', exact: true }).click(); await saved(second);
    await tracker(page).getByRole('alert').filter({ hasText: '其他页面更新了备注' }).waitFor();
    assert.equal(await tracker(page).locator('textarea').inputValue(), '本页未保存草稿');
    assert.equal(await tracker(page).getByRole('button', { name: '保存跟进记录', exact: true }).isDisabled(), true);
    assert.equal((await records(page))[A].notes, '另一页已保存备注');
    await tracker(page).getByRole('button', { name: '以当前输入覆盖冲突', exact: true }).click(); await saved(page);
    await second.waitForFunction(() => document.querySelector('.application-tracker textarea')?.value === '本页未保存草稿');
    assert.equal((await records(page))[A].notes, '本页未保存草稿');
  });
  await run('a rejected storage write retains the draft and can be retried', {}, async ({ page }) => {
    await openDetail(page);
    await tracker(page).locator('textarea').fill('空间不足也不能丢草稿');
    await page.evaluate((key) => {
      const native = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem').value;
      window.restoreRegressionStorage = () => { Storage.prototype.setItem = native; };
      Storage.prototype.setItem = function (k, v) { if (k === key) throw new DOMException('quota', 'QuotaExceededError'); return native.call(this, k, v); };
    }, personalKey);
    await tracker(page).getByRole('button', { name: '保存跟进记录', exact: true }).click(); await saved(page, '尚未保存');
    assert.equal(await tracker(page).locator('textarea').inputValue(), '空间不足也不能丢草稿');
    assert.equal((await records(page))[A].notes, undefined);
    await page.evaluate(() => window.restoreRegressionStorage());
    await tracker(page).getByRole('button', { name: '保存跟进记录', exact: true }).click(); await saved(page);
    assert.equal((await records(page))[A].notes, '空间不足也不能丢草稿');
  });
  const current = { saved: true, hidden: false, readAt: '2026-10-29T02:00:00.000Z', notes: '新备注', personal_updated_at: '2026-10-29T02:00:00Z' };
  const old = { saved: false, hidden: true, readAt: null, notes: '旧备注', personal_updated_at: '2026-10-28T02:00:00Z' };
  await run('an older backup cannot undo newer saved, hidden, read and note states', { records: { [A]: current } }, async ({ page }) => {
    await importBackup(page, { version: 3, records: { [A]: old } });
    assert.deepEqual((await records(page))[A], current);
  });
  await run('untimed backup status conflicts obey the explicit import choice', { records: { [A]: { saved: true, hidden: false } } }, async ({ page }) => {
    await importBackup(page, { version: 2, records: { [A]: { saved: false, hidden: true, readAt: null } } }, true);
    const actual = (await records(page))[A];
    assert.equal(actual.saved, false); assert.equal(actual.hidden, true); assert.equal(actual.readAt, null);
  });
  await run('date-only deadline remains visible in reminders at noon in Beijing', {
    jobs: [{ ...jobA, deadline: '2026-10-29', deadline_precision: 'date' }, jobB], records: { [A]: { saved: true } }, width: 390,
  }, async ({ page }) => {
    await page.locator('.top-reminder-trigger').click();
    const panel = page.locator('.top-reminder-popover'); await panel.waitFor();
    await page.waitForTimeout(200);
    assert.equal(await panel.locator('.top-reminder-item').count(), 1);
    assert.match(await panel.innerText(), /10\/29.*23:59/s);
    if (output) await page.screenshot({ path: `${output}/reminder-390.png` });
  });
  for (const count of [0, 12]) {
    const rows = Array.from({ length: Math.max(2, count) }, (_, i) => fixtureJob({
      id: (i + 1).toString(16).padStart(20, '0'), title: `弹窗岗位${i}`, company: `企业${i}`, deadline: '2026-10-30',
    }));
    await run(`reminder popup stays in the viewport and restores focus with ${count} reminders`, {
      jobs: rows, records: count ? Object.fromEntries(rows.map(j => [j.id, { saved: true }])) : {}, width: 320, height: 640,
    }, async ({ page }) => {
      for (const width of [320, 360, 390, 768]) {
        await page.setViewportSize({ width, height: 640 });
        const trigger = page.locator('.top-reminder-trigger'); await trigger.click();
        const panel = page.locator('.top-reminder-popover'); await panel.waitFor();
        // Wait for Base UI's collision calculation and opening animation.
        await page.waitForTimeout(160);
        const box = await panel.boundingBox();
        assert.ok(box.x >= 15 && box.x + box.width <= width - 15, JSON.stringify({ width, box }));
        assert.ok(box.y >= 0 && box.y + box.height <= 641, JSON.stringify({ width, box }));
        assert.equal(await panel.locator('.top-reminder-item').count(), Math.min(count, 8));
        await page.keyboard.press('Escape'); await panel.waitFor({ state: 'hidden' });
        assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
      }
    });
  }
  const cities = ['北京', '上海', '广州', '深圳', '杭州', '南京', '苏州', '成都', '武汉', '西安', '重庆', '济南', '青岛', '天津', '郑州'];
  for (const count of [2, 5, 15]) {
    await run(`mobile cards wrap ${count} matched work cities without document overflow`, {
      jobs: [{ ...jobA, cities, location_evidence: [`工作地点：${cities.join('、')}`] }, jobB], width: 390,
      filters: { ...defaultFilters, city: '全部城市', workCities: cities.slice(0, count) },
    }, async ({ page }) => {
      const card = page.locator('.opp-card').filter({ hasText: jobA.title }), note = card.locator('.opp-loc-note');
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 1000 }); await note.scrollIntoViewIfNeeded();
        const box = await note.boundingBox(), cardBox = await card.boundingBox();
        assert.ok(box.x >= cardBox.x && box.x + box.width <= cardBox.x + cardBox.width, JSON.stringify({ width, box, cardBox }));
        const overflow = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth,
          elements: [...document.querySelectorAll('body *')].filter(el => {
            const box = el.getBoundingClientRect(); return box.width && box.right > window.innerWidth + 1;
          }).slice(0, 12).map(el => ({ tag: el.tagName, className: el.className, right: el.getBoundingClientRect().right })) }));
        assert.ok(overflow.scrollWidth <= width, JSON.stringify(overflow));
      }
      if (output && count === 15) await page.screenshot({ path: `${output}/cities-320.png` });
    });
  }
  await run('changing a failed nonempty search retries once and then reuses the successful index', { search: true, searchFailure: true }, async ({ page, searchCalls, listCalls }) => {
    const input = page.getByLabel('搜索岗位、企业或专业');
    await input.fill('甲'); await page.getByRole('alert').filter({ hasText: '数据分片读取失败' }).waitFor();
    assert.equal(searchCalls(), 1);
    await input.fill('乙'); await page.locator('.opp-card').filter({ hasText: jobB.title }).waitFor();
    assert.equal(searchCalls(), 2); assert.equal(listCalls(), 1);
    await input.fill('甲'); await page.locator('.opp-card').filter({ hasText: jobA.title }).waitFor();
    assert.equal(searchCalls(), 2); assert.equal(await page.getByRole('button', { name: '重试全文搜索' }).count(), 0);
  });
  await run('explicit full-text retry recovers without downloading the list again', { search: true, searchFailure: true }, async ({ page, searchCalls, listCalls }) => {
    await page.getByLabel('搜索岗位、企业或专业').fill('甲');
    await page.getByRole('button', { name: '重试全文搜索', exact: true }).click();
    await page.locator('.opp-card').filter({ hasText: jobA.title }).waitFor();
    assert.equal(searchCalls(), 2); assert.equal(listCalls(), 1);
  });
  let release;
  const searchGate = new Promise(resolve => { release = resolve; });
  await run('typing while a full-text fetch is in flight does not redownload it', { search: true, searchGate }, async ({ page, searchCalls }) => {
    const input = page.getByLabel('搜索岗位、企业或专业'); await input.fill('甲');
    await page.waitForFunction(() => document.querySelector('.result-count')?.textContent.includes('全文'));
    await searchStarted(page, searchCalls);
    await input.fill('乙'); await input.fill('岗位乙');
    release(); await page.locator('.opp-card').filter({ hasText: jobB.title }).waitFor();
    assert.equal(searchCalls(), 1);
  });
  let releaseOld;
  const oldSearch = new Promise(resolve => { releaseOld = resolve; });
  await run('late full-text response cannot replace the search index after refreshing the snapshot', {
    search: true, searchReply: async (call) => {
      if (call === 1) await oldSearch;
      return { jobs: { [A]: call === 1 ? '旧全文专属' : '新全文专属', [B]: '乙全文' } };
    },
  }, async ({ page, searchCalls, listCalls }) => {
    const input = page.getByLabel('搜索岗位、企业或专业'); await input.fill('新全文专属');
    await searchStarted(page, searchCalls);
    await page.getByRole('button', { name: '重新读取招聘数据', exact: true }).click();
    await page.locator('.opp-card').filter({ hasText: jobA.title }).waitFor();
    assert.equal(listCalls(), 2); assert.equal(searchCalls(), 2);
    releaseOld();
    await input.fill('旧全文专属'); await page.getByText('没有符合当前条件的公告', { exact: true }).waitFor();
    assert.equal(await page.locator('.opp-card').count(), 0); assert.equal(searchCalls(), 2);
    await input.fill('新全文专属'); await page.locator('.opp-card').filter({ hasText: jobA.title }).waitFor();
  });
} finally { await browser.close(); }
if (output) writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
console.log(`${results.filter(r => r.passed).length}/${results.length} passed`);
if (results.some(r => !r.passed)) process.exitCode = 1;
