// Browser checks for the 2026-11-06 usability batch. Run against a dedicated
// local dev server (see docs/gemini-fixes-20261028.md); all data is intercepted.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixtureJob } from './fixtures/job.ts';
import { defaultFilters } from '../lib/jobs.ts';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.JOB_RADAR_PLAYWRIGHT || 'playwright');
const base = process.env.JOB_RADAR_BROWSER_URL || 'http://127.0.0.1:3002';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'Use an isolated local dev server');
const output = process.env.JOB_RADAR_BROWSER_OUTPUT;
if (output) mkdirSync(output, { recursive: true });
const p1 = '/job-assets/index-00000000000000000011.json', p2 = '/job-assets/index-00000000000000000012.json';
const detailPath = '/job-assets/detail-aa-00000000000000000013.json';
const hex = (n) => n.toString(16).padStart(18, '0');
const id = (n) => `aa${hex(n)}`;
const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const browser = await chromium.launch({ channel: process.env.JOB_RADAR_BROWSER_CHANNEL || 'msedge', headless: true });
const results = [];

async function setup({ rows, viewport = { width: 1440, height: 1000 }, prefs = {}, pageSize, query = '' }) {
  const context = await browser.newContext({ viewport });
  await context.route(/\/(?:api\/reputation(?:\?|$)|reputation\/)/, route => route.fulfill({ status: 503, json: { error: 'isolated fixture' } }));
  await context.addInitScript(([stored, size]) => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('job-radar-browsing-v1', JSON.stringify(stored));
      if (size) localStorage.setItem('job-radar-page-size-v1', String(size));
      sessionStorage.setItem('seeded', '1');
    }
  }, [{ filters: { ...defaultFilters, city: '全部城市', workCities: [], year: '全部' }, viewMode: 'cards', groupCompanies: false, ...prefs }, pageSize]);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const half = Math.ceil(rows.length / 2);
  await page.route('**/jobs.json', (route) => route.fulfill({ json: {
    schema_version: 3, generated_at: `${today}T08:00:00+08:00`, last_success_at: `${today}T08:00:00+08:00`,
    index_count: rows.length, index_shards: [p1, p2], jobs: [], cities: ['济南', '青岛'], schedule_enabled: true,
    detail_shards: { aa: detailPath }, sources: [{ id: 'fixture', name: '回归来源', status: 'ok', pages: 1, parsed: rows.length, cached: 0 }],
  } }));
  await page.route('**/job-assets/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === p1) return route.fulfill({ json: { jobs: rows.slice(0, half) } });
    if (path === p2) return route.fulfill({ json: { jobs: rows.slice(half) } });
    if (path === detailPath) return route.fulfill({ json: { schema_version: 1, jobs: Object.fromEntries(rows.map((row) =>
      [row.id, { ...row, body: `${row.title} 公告正文`, emails: [], links: [], attachments: [] }])) } });
    return route.fulfill({ status: 404, body: 'not found' });
  });
  await page.goto(base + query, { waitUntil: 'domcontentloaded' });
  await page.locator('.result-count-num').waitFor({ timeout: 60000 });
  return { context, page, errors };
}

async function run(name, options, check) {
  let s;
  try {
    s = await setup(options);
    await check(s);
    assert.deepEqual(s.errors, [], 'No browser runtime errors');
    assert.ok(await s.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
    results.push({ name, passed: true });
    console.log('PASS', name);
  } catch (error) {
    results.push({ name, passed: false });
    console.error('FAIL', name, error.message);
  } finally { await s?.context.close(); }
}

const job = (n, changes = {}) => fixtureJob({ id: id(n), title: `核验岗位${n}`, company: `核验公司${n}`, published_at: today,
  first_seen_at: `${today}T07:00:00+08:00`, updated_at: `${today}T07:00:00+08:00`, graduation_years: [], ...changes });

try {
  const groupRows = [
    job(1, { company: '合并样本有限公司', title: '合并样本有限公司 · 会计', deadline: '2026-12-31T23:59:59+08:00',
      recent_change: { type: 'deadline_extended', label: '明确截止时间', detail: '明确报名截止时间为 2026-12-31T23:59:59+08:00', date: today } }),
    job(2, { company: '合并样本有限公司', title: '合并样本有限公司 · 出纳' }),
    job(3, { company: '合并样本有限公司', title: '合并样本有限公司 · 行政' }),
    job(4, { title: '独立样本岗位', recent_change: { type: 'deadline_extended', label: '截止调整', detail: '报名截止时间调整为 2026-11-20（原截止时间：2026-11-30）', date: today }, deadline: '2026-11-20T23:59:59+08:00' }),
  ];
  await run('company groups show the newest record and expand the rest; clarified deadlines are not extensions', { rows: groupRows, prefs: { groupCompanies: true } }, async ({ page }) => {
    const group = page.locator('.opp-group').first();
    await group.waitFor();
    assert.equal(await group.locator('.opp-card:visible').count(), 1);
    await group.getByText('展开其余 2 条').click();
    assert.equal(await group.locator('.opp-card:visible').count(), 3);
    assert.ok(await group.getByText('收起其余 2 条').isVisible());
    const clarified = page.locator('.opp-card').filter({ hasText: '会计' });
    assert.equal(await clarified.getByText('截止延期').count(), 0);
    assert.equal(await clarified.locator('.opp-alert').count(), 0);
    assert.equal(await page.locator('.opp-card').filter({ hasText: '独立样本岗位' }).locator('.opp-alert.is-warning').count(), 1);
    assert.equal(await page.getByText('单位性质未明确').count(), 0);
    if (output) await page.screenshot({ path: resolve(output, 'groups-1440.png'), fullPage: true });
  });

  const many = Array.from({ length: 45 }, (_, i) => job(100 + i));
  await run('page jump writes the page to the URL and survives reload', { rows: many, pageSize: 20 }, async ({ page }) => {
    await page.getByRole('combobox', { name: /跳转页码/ }).first().click();
    await page.getByRole('option', { name: '第 3 页' }).click();
    await page.waitForFunction(() => new URLSearchParams(location.search).get('page') === '3');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('.result-count-num').waitFor({ timeout: 60000 });
    await page.waitForFunction(() => document.querySelector('.pager-mini span')?.textContent?.trim() === '3 / 3');
  });

  await run('search box stays responsive and filters after the pause', { rows: groupRows }, async ({ page }) => {
    const input = page.getByLabel('搜索岗位、企业或专业');
    await input.pressSequentially('出纳', { delay: 30 });
    assert.equal(await input.inputValue(), '出纳');
    await page.waitForFunction(() => document.querySelector('.result-count-num')?.textContent === '1');
    await page.getByRole('button', { name: '清空搜索' }).click();
    await page.waitForFunction(() => document.querySelector('.result-count-num')?.textContent === '4');
  });

  await run('phone filter sheet holds sorting/layout and reports the result count', { rows: groupRows, viewport: { width: 390, height: 844 } }, async ({ page }) => {
    assert.equal(await page.getByRole('combobox', { name: '排序方式' }).isVisible(), true);
    assert.equal(await page.getByRole('group', { name: '招聘信息显示方式' }).isVisible(), false);
    await page.getByRole('button', { name: '打开筛选面板' }).click();
    const sheet = page.locator('[data-slot="sheet-content"]');
    await sheet.getByRole('region', { name: '显示与排序' }).waitFor();
    await sheet.getByLabel('排序方式（筛选面板）').selectOption('deadline_asc');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('job-radar-browsing-v1')).filters.sort), 'deadline_asc');
    if (output) await page.screenshot({ path: resolve(output, 'filter-sheet-390.png') });
    await sheet.getByRole('button', { name: '查看 4 条结果' }).click();
    await sheet.waitFor({ state: 'detached' });
    if (output) await page.screenshot({ path: resolve(output, 'list-390.png') });
  });

  const positions = [
    { name: '财务岗', majors: ['会计学'], education: '本科', city: '北京' },
    { name: '研发岗', majors: ['软件工程'], education: '本科', city: '北京' },
  ];
  await run('detail drawer puts the announcement before folded history and highlights matching rows', {
    rows: [job(7, { positions, position_count: 2, recent_change: { type: 'content_updated', label: '内容更新', detail: '公告正文补充薪酬福利与待遇说明', date: today } })],
    prefs: { filters: { ...defaultFilters, city: '全部城市', workCities: [], year: '全部', major: '会计' } },
  }, async ({ page }) => {
    await page.locator('.opp-card .opp-title button').first().click();
    const sheet = page.locator('[data-slot="sheet-content"]');
    await sheet.getByText('核验岗位7 公告正文').waitFor();
    assert.equal(await sheet.locator('tr.is-match').count(), 1);
    assert.equal(await sheet.getByRole('button', { name: '标为已读' }).count(), 0);
    assert.ok(await sheet.getByRole('button', { name: '标为未读' }).isVisible());
    const order = await sheet.evaluate((node) => {
      const text = node.textContent || '';
      return [text.indexOf('公告文字'), text.indexOf('招聘全流程与变更时间线')];
    });
    assert.ok(order[0] >= 0 && order[1] > order[0], 'announcement precedes the folded timeline');
    assert.equal(await sheet.locator('details.drawer-fold-timeline').getAttribute('open'), null);
    if (output) await page.screenshot({ path: resolve(output, 'drawer-1440.png') });
  });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.passed).length;
console.log(`${results.length - failed}/${results.length} usability browser checks passed`);
process.exitCode = failed ? 1 : 0;
