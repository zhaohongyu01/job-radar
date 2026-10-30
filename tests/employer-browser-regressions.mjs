// Isolated fixtures and storage only; external research links are inspected,
// never opened or scraped. Run with the same env vars as browser-regressions.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fixtureJob } from './fixtures/job.ts';
import { defaultFilters } from '../lib/jobs.ts';
import { resolveEmployer } from '../lib/employers.ts';
import { EMPLOYER_PERSONAL_STORAGE } from '../lib/employer-personal.ts';

const { chromium } = createRequire(import.meta.url)(process.env.JOB_RADAR_PLAYWRIGHT || 'playwright');
const base = process.env.JOB_RADAR_BROWSER_URL || 'http://127.0.0.1:3002';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = process.env.JOB_RADAR_BROWSER_OUTPUT;
if (output) mkdirSync(output, { recursive: true });
const A = 'aaaaaaaaaaaaaaaaaaa1', B = 'bbbbbbbbbbbbbbbbbbb2', C = 'ccccccccccccccccccc3';
const rows = [fixtureJob({ id: A, title: '企业样本甲岗位', company: '示例科技有限公司' }),
  fixtureJob({ id: B, title: '企业样本乙岗位', company: '示例科技有限公司', source_id: 'other' }),
  fixtureJob({ id: C, title: '企业样本分公司岗位', company: '示例科技有限公司济南分公司' })];
const employer = resolveEmployer(rows[0]);
const panel = page => page.locator('.employer-sheet:visible');
const complete = page => page.locator('.result-count-num').waitFor({ timeout: 60000 });
const rating = page => panel(page).getByLabel('意向评分', { exact: true });
const notes = page => panel(page).getByLabel('个人备注', { exact: true });
const current = page => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '{}'), EMPLOYER_PERSONAL_STORAGE);
const browser = await chromium.launch({ channel: process.env.JOB_RADAR_BROWSER_CHANNEL || 'msedge', headless: true });
const results = [];
async function open(page, row = rows[0]) {
  await page.locator('.opp-card').filter({ hasText: row.title }).getByRole('button', { name: `查看企业口碑：${row.company}`, exact: true }).click();
  await panel(page).getByRole('heading', { name: '我的意向评分', exact: true }).waitFor();
}
async function save(page) {
  await panel(page).getByRole('button', { name: '保存我的企业评价', exact: true }).click();
  await panel(page).locator('output').filter({ hasText: '企业个人记录已保存' }).waitFor();
}
async function setup(options = {}) {
  const context = await browser.newContext({ viewport: { width: options.width || 1440, height: 900 }, acceptDownloads: true });
  const errors = [], requests = [];
  await context.route(/\/(?:api\/reputation(?:\?|$)|reputation\/)/, route => route.fulfill({ status: 503, json: { error: 'isolated fixture' } }));
  context.on('page', page => {
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => requests.push(r.url()));
  });
  await context.addInitScript(({ records, key, filters }) => {
    if (!['http:', 'https:'].includes(location.protocol) || localStorage.getItem('employer-init')) return;
    localStorage.setItem('employer-init', 'yes');
    localStorage.setItem('job-radar-browsing-v1', JSON.stringify({ filters, viewMode: 'cards', groupCompanies: false }));
    localStorage.setItem('quancheng-personal-v1', '{}');
    if (records) localStorage.setItem(key, JSON.stringify(records));
  }, { records: options.records, key: EMPLOYER_PERSONAL_STORAGE, filters: { ...defaultFilters, city: '全部城市', workCities: [] } });
  await context.route('**/jobs.json', route => route.fulfill({ json: {
    schema_version: 2, generated_at: '2026-10-29T12:00:00+08:00', schedule_enabled: true,
    last_success_at: '2026-10-29T12:00:00+08:00', jobs: rows, cities: ['北京', '济南'], sources: [],
    detail_shards: { aa: '/job-assets/detail-aa-11111111111111111111.json' },
  } }));
  await context.route('**/job-assets/**', route => route.fulfill({ json: {
    schema_version: 1, jobs: Object.fromEntries(rows.map(job => [job.id, { ...job, body: '完整岗位正文', emails: [], attachments: [], links: [] }])),
  } }));
  await context.route('https://www.bing.com/**', route => route.abort());
  const page = await context.newPage(); await page.goto(base); await complete(page);
  return { page, context, errors, requests };
}
async function run(name, options, check) {
  if (process.env.JOB_RADAR_EMPLOYER_CASE && !name.includes(process.env.JOB_RADAR_EMPLOYER_CASE)) return;
  let state;
  try { state = await setup(options); await check(state); assert.deepEqual(state.errors, []);
    results.push({ name, passed: true }); console.log('PASS', name);
  } catch (error) {
    results.push({ name, passed: false, error: String(error.stack || error) }); console.error('FAIL', name, error.message);
    if (output && state) await state.page.screenshot({ path: `${output}/failure-${results.length}.png` }).catch(() => {});
  } finally { await state?.context.close(); }
}
try {
  await run('research panel is lazy and shows no invented external score or source requests', {}, async ({ page, requests }) => {
    assert.ok(!requests.some(url => url.includes('/employer-drawer.')));
    await open(page);
    assert.ok(requests.some(url => url.includes('/employer-drawer.')));
    assert.match(await panel(page).innerText(), /评价不足 · 暂无综合分/);
    assert.equal(await panel(page).locator('.employer-source-links a').count(), 3);
    for (const link of await panel(page).locator('.employer-source-links a').all()) {
      const url = new URL(await link.getAttribute('href'));
      assert.equal(url.origin, 'https://www.bing.com'); assert.match(url.searchParams.get('q'), /示例科技有限公司/);
      assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
    }
    assert.ok(!requests.some(url => /^https:\/\/(?:www\.bing|www\.kanzhun|www\.nowcoder|maimai)\./.test(url)));
    assert.equal(requests.filter(url => url.includes('/jobs.json')).length, 1);
  });
  await run('rating shares across exact employer jobs, survives reload and remains separate from a branch', {}, async ({ page }) => {
    await open(page); await rating(page).selectOption('4'); await notes(page).fill('PRIVATE_NOTE_不要放进网址'); await save(page);
    await page.keyboard.press('Escape'); await panel(page).waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.employer-rating-pill').count(), 2);
    assert.doesNotMatch(page.url(), /PRIVATE_NOTE/);
    await open(page, rows[2]); assert.equal(await rating(page).inputValue(), '');
    await page.keyboard.press('Escape'); await page.reload(); await complete(page);
    await open(page, rows[1]); assert.equal(await rating(page).inputValue(), '4');
    assert.equal(await notes(page).inputValue(), 'PRIVATE_NOTE_不要放进网址');
  });
  await run('job details remain open with their draft after opening and closing company reputation', {}, async ({ page }) => {
    await page.locator('.opp-card').filter({ hasText: rows[0].title }).getByRole('button', { name: '详情', exact: true }).click();
    const detail = page.locator('.detail-sheet:visible'); await detail.getByText('完整岗位正文', { exact: true }).waitFor();
    await detail.locator('.application-tracker textarea').fill('岗位草稿保留');
    await detail.getByRole('button', { name: `查看企业口碑：${rows[0].company}`, exact: true }).click();
    await panel(page).getByRole('heading', { name: '我的意向评分' }).waitFor();
    await page.keyboard.press('Escape'); await panel(page).waitFor({ state: 'hidden' });
    assert.equal(await detail.locator('.application-tracker textarea').inputValue(), '岗位草稿保留');
    await detail.getByRole('button', { name: '保存跟进记录', exact: true }).click();
    await detail.locator('output').filter({ hasText: '跟进记录已保存' }).waitFor();
  });
  await run('two tabs preserve unrelated company edits and expose same-field draft conflicts', {}, async ({ context, page }) => {
    await open(page); const second = await context.newPage(); await second.goto(base); await complete(second); await open(second);
    await notes(page).fill('本页草稿'); await rating(second).selectOption('5'); await save(second);
    await page.waitForFunction(() => document.querySelector('.employer-personal select')?.value === '5');
    assert.equal(await notes(page).inputValue(), '本页草稿'); await save(page);
    await second.waitForFunction(() => document.querySelector('.employer-personal textarea')?.value === '本页草稿');
    await notes(page).fill('第二份本页草稿'); await notes(second).fill('另一页已保存'); await save(second);
    await panel(page).getByRole('alert').filter({ hasText: '其他页面更新了个人备注' }).waitFor();
    assert.equal(await notes(page).inputValue(), '第二份本页草稿');
    await panel(page).getByRole('button', { name: '以当前输入覆盖冲突', exact: true }).click();
    await panel(page).locator('output').filter({ hasText: '企业个人记录已保存' }).waitFor();
    assert.equal((await current(page))[employer.id].notes, '第二份本页草稿');
    assert.equal((await current(page))[employer.id].rating, 5);
  });
  await run('company ratings round trip through a downloaded v4 personal backup', {}, async ({ page }) => {
    await open(page); await rating(page).selectOption('4'); await notes(page).fill('备份保留'); await save(page);
    await page.keyboard.press('Escape'); await panel(page).waitFor({ state: 'hidden' });
    const [download] = await Promise.all([page.waitForEvent('download'),
      page.locator('.filters-desktop').getByRole('button', { name: '导出', exact: true }).click()]);
    const stream = await download.createReadStream();
    const chunks = []; for await (const chunk of stream) chunks.push(chunk);
    const backup = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    assert.equal(backup.version, 4); assert.equal(backup.employer_records[employer.id].rating, 4);
    await page.keyboard.press('Escape');
    await page.evaluate(key => localStorage.removeItem(key), EMPLOYER_PERSONAL_STORAGE);
    await page.reload(); await complete(page);
    await page.locator('input[type=file]').first().setInputFiles({ name: 'company.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.getByRole('button', { name: '合并，保留本机冲突状态', exact: true }).click();
    await page.getByText('备份已合并；个人记录、活动及设置已保存。', { exact: true }).waitFor();
    await open(page); assert.equal(await rating(page).inputValue(), '4'); assert.equal(await notes(page).inputValue(), '备份保留');
  });
  await run('clearing personal rating persists a tombstone against an older company backup', {
    records: { [employer.id]: { rating: 4, notes: '原备注', updated_at: '2026-10-28T00:00:00Z' } },
  }, async ({ page }) => {
    await open(page); await panel(page).getByRole('button', { name: '清空评分和备注', exact: true }).click(); await save(page);
    assert.equal((await current(page))[employer.id].rating, null);
    assert.equal((await current(page))[employer.id].notes, '');
    await page.keyboard.press('Escape'); await panel(page).waitFor({ state: 'hidden' });
    await page.locator('input[type=file]').first().setInputFiles({ name: 'older.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ version: 4, records: {},
      employer_records: { [employer.id]: { rating: 4, notes: '原备注', updated_at: '2026-10-28T00:00:00Z' } } })) });
    await page.getByRole('button', { name: '合并，冲突以备份为准', exact: true }).click();
    await page.getByText('备份已合并；个人记录、活动及设置已保存。', { exact: true }).waitFor();
    await open(page); assert.equal(await rating(page).inputValue(), ''); assert.equal(await notes(page).inputValue(), '');
  });
  await run('table entry opens the same company profile and saved personal score', {}, async ({ page }) => {
    await open(page); await rating(page).selectOption('4'); await save(page);
    await page.keyboard.press('Escape'); await panel(page).waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '表格', exact: true }).click();
    await page.locator('.job-table').getByRole('button', { name: `查看企业口碑：${rows[0].company}`, exact: true }).first().click();
    assert.equal(await rating(page).inputValue(), '4');
  });
  await run('storage failure keeps company draft and successful retry preserves its input', {}, async ({ page }) => {
    await open(page); await notes(page).fill('失败后保留的企业备注');
    await page.evaluate(key => {
      const native = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem').value;
      window.restoreEmployerStorage = () => { Storage.prototype.setItem = native; };
      Storage.prototype.setItem = function (k, v) { if (k === key) throw new DOMException('quota', 'QuotaExceededError'); return native.call(this, k, v); };
    }, EMPLOYER_PERSONAL_STORAGE);
    await panel(page).getByRole('button', { name: '保存我的企业评价', exact: true }).click();
    await panel(page).locator('output').filter({ hasText: '草稿已保留' }).waitFor();
    assert.equal(await notes(page).inputValue(), '失败后保留的企业备注');
    assert.equal((await current(page))[employer.id], undefined);
    await page.evaluate(() => window.restoreEmployerStorage()); await save(page);
    assert.equal((await current(page))[employer.id].notes, '失败后保留的企业备注');
  });
  for (const width of [320, 390, 1440]) await run(`company panel and entry fit ${width}px and return keyboard focus`, { width }, async ({ page }) => {
    await open(page); await notes(page).fill('长备注'.repeat(300));
    const box = await panel(page).boundingBox(); assert.ok(box.x >= -1 && box.x + box.width <= width + 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await panel(page).getByRole('button', { name: '保存我的企业评价' }).scrollIntoViewIfNeeded();
    await save(page); await page.waitForTimeout(200);
    if (output) await page.screenshot({ path: `${output}/employer-${width}.png` });
    await page.keyboard.press('Escape'); await panel(page).waitFor({ state: 'hidden' });
    assert.ok(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')?.startsWith('查看企业口碑：')));
  });
} finally { await browser.close(); }
if (output) writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
console.log(`${results.filter(r => r.passed).length}/${results.length} passed`);
if (results.some(r => !r.passed)) process.exitCode = 1;
