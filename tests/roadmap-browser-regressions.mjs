// Isolated local fixtures. No user state, live reviews or source site requests.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fixtureJob } from './fixtures/job.ts';
import { defaultFilters } from '../lib/jobs.ts';
import { resolveEmployer } from '../lib/employers.ts';
import { formatUrlQuery } from '../lib/browsing.ts';

const { chromium } = createRequire(import.meta.url)(process.env.JOB_RADAR_PLAYWRIGHT || 'playwright');
const base = process.env.JOB_RADAR_BROWSER_URL || 'http://127.0.0.1:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = process.env.JOB_RADAR_BROWSER_OUTPUT;
if (output) mkdirSync(output, { recursive: true });
const now = Date.parse('2026-10-30T04:00:00Z');
const ids = ['a', 'b', 'c', 'd', 'e', 'f'].map(char => char.repeat(20));
const talk = { id: 'event-test', date: '2026-11-05', start_time: '14:00', city: '济南', school: '示例大学', venue: '济南校区大厅', status: 'scheduled', url: 'https://example.org/talk' };
const rows = ids.map((id, i) => fixtureJob({ id, title: `回归岗位${'ABCDEF'[i]}`,
  company: i < 3 ? '示例科技有限公司' : i === 3 ? '示例科技有限公司济南分公司' : `另一科技${i}有限公司`,
  cities: i === 1 ? ['上海'] : ['北京'], deadline: i === 0 ? '2026-10-30' : i === 2 ? '2026-10-01' : null,
  ...(i < 2 ? { talk_events: [talk] } : {}), body: `完整岗位正文${'ABCDEF'[i]}`, emails: [], attachments: [], links: [] }));
const records = { [ids[0]]: { saved: true }, [ids[1]]: { saved: true }, [ids[2]]: { saved: true },
  [ids[3]]: { application_stage: 'offer', applied: true }, [ids[4]]: { saved: true, applied: true, application_stage: 'interview' },
  [ids[5]]: { saved: true, hidden: true } };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [], panel = page => page.locator('.employer-sheet:visible');
const complete = page => page.locator('.result-count-num').waitFor({ timeout: 60000 });
async function setup(options = {}) {
  const context = await browser.newContext({ viewport: { width: options.width || 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const errors = [], requests = [];
  context.on('page', page => { page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push(r.url())); });
  await context.addInitScript(({ filters, records, clock }) => {
    Date.now = () => clock;
    if (!['http:', 'https:'].includes(location.protocol) || localStorage.getItem('roadmap-fixture')) return;
    localStorage.setItem('roadmap-fixture', 'yes');
    localStorage.setItem('job-radar-browsing-v1', JSON.stringify({ filters, viewMode: 'cards', groupCompanies: false }));
    localStorage.setItem('quancheng-personal-v1', JSON.stringify(records));
  }, { filters: { ...defaultFilters, city: '全部城市', workCities: [], ...options.filters }, records, clock: now });
  await context.route('**/jobs.json', route => route.fulfill({ json: { schema_version: 2, generated_at: new Date(now).toISOString(),
    last_success_at: new Date(now).toISOString(), schedule_enabled: true, jobs: options.gate ? [] : rows,
    ...(options.gate ? { index_count: rows.length, index_shards: ['/job-assets/index-11111111111111111111.json', '/job-assets/index-22222222222222222222.json'] } : {}),
    cities: ['北京', '上海', '济南'], sources: [] } }));
  if (options.gate) await context.route('**/job-assets/index-*.json', async route => {
    const first = new URL(route.request().url()).pathname.endsWith('index-11111111111111111111.json');
    if (!first) await options.gate.promise;
    return route.fulfill({ json: { jobs: first ? [rows[0]] : rows.slice(1) } });
  });
  await context.route(/\/(?:api\/reputation(?:\?|$)|reputation\/)/, route => route.fulfill({ status: 503, json: { error: 'isolated fixture' } }));
  const page = await context.newPage(); await page.goto(base + (options.query || ''));
  if (options.gate) await page.getByLabel('首批预览', { exact: true }).locator('.opp-card').first().waitFor({ timeout: 60000 });
  else await complete(page);
  return { context, page, errors, requests };
}
async function open(page, row = rows[0]) {
  await page.locator('.opp-card').filter({ hasText: row.title }).getByRole('button', { name: `查看企业口碑：${row.company}`, exact: true }).click();
  await panel(page).getByRole('heading', { name: '企业全部机会', exact: true }).waitFor();
}
async function run(name, options, check) {
  if (process.env.JOB_RADAR_ROADMAP_CASE && !name.includes(process.env.JOB_RADAR_ROADMAP_CASE)) return;
  let state;
  try { state = await setup(options); await check(state); assert.deepEqual(state.errors, []);
    results.push({ name, passed: true }); console.log('PASS', name);
  } catch (error) { results.push({ name, passed: false, error: String(error.stack || error) }); console.error('FAIL', name, error.message);
    if (output && state) await state.page.screenshot({ path: `${output}/failure-${results.length}.png` }).catch(() => {});
  } finally { options.gate?.release(); await state?.context.close(); }
}
try {
  await run('pending count opens exactly the pending queue and keeps full saved history separate', {}, async ({ page }) => {
    await page.locator('.top-action-card').getByRole('button', { name: '待投递', exact: false }).first().click();
    await page.getByRole('heading', { name: '待投递', exact: true }).waitFor();
    assert.equal(await page.locator('.opp-card').count(), 2);
    assert.match(await page.locator('.opp-card').first().innerText(), /回归岗位A/);
    await page.locator('.app-nav').getByRole('button', { name: '我的收藏', exact: false }).click();
    assert.equal(await page.locator('.opp-card').count(), 5);
    await page.locator('.app-nav').getByRole('button', { name: '待投递', exact: true }).click();
    assert.equal(await page.locator('.opp-card').count(), 2);
    await page.reload(); await complete(page); assert.equal(await page.locator('.opp-card').count(), 2);
  });
  await run('stage overview includes expired records and updates after editing the existing tracker', { filters: { view: 'pipeline' } }, async ({ page }) => {
    const overview = page.getByLabel('投递阶段总览', { exact: true });
    assert.match(await overview.innerText(), /全部进度\s*5/);
    await overview.getByRole('button', { name: /面试中/ }).click();
    assert.equal(await page.locator('.opp-card').count(), 1); assert.match(await page.locator('.opp-card').innerText(), /我的进度：面试中/);
    await page.locator('.opp-card').getByRole('button', { name: '详情', exact: true }).click();
    const detail = page.locator('.detail-sheet:visible'); await detail.getByText('完整岗位正文E', { exact: true }).waitFor();
    await detail.getByLabel('投递阶段', { exact: true }).selectOption('offer');
    await detail.getByRole('button', { name: '保存跟进记录', exact: true }).click();
    await detail.locator('output').filter({ hasText: '跟进记录已保存' }).waitFor();
    await page.keyboard.press('Escape'); await detail.waitFor({ state: 'hidden' });
    await overview.getByRole('button', { name: /已获 Offer/ }).click(); assert.equal(await page.locator('.opp-card').count(), 2);
  });
  await run('employer aggregates exact entity jobs across cities but keeps branches and event-city filters separate', {}, async ({ page }) => {
    await open(page); const catalog = panel(page).getByLabel('企业全部机会', { exact: true });
    assert.equal(await catalog.locator('article').count(), 2);
    assert.doesNotMatch(await catalog.innerText(), /回归岗位D/);
    await panel(page).getByLabel('企业岗位工作城市', { exact: true }).selectOption('上海');
    assert.equal(await catalog.locator('article').count(), 1); assert.match(await catalog.innerText(), /回归岗位B/);
    assert.match(await panel(page).getByLabel('企业宣讲安排', { exact: true }).innerText(), /济南校区大厅/);
    assert.equal(await panel(page).locator('.employer-event').count(), 1);
    await panel(page).getByLabel('企业岗位工作城市', { exact: true }).selectOption('全部城市');
    await panel(page).getByRole('checkbox', { name: '包含已截止与撤回记录' }).click();
    assert.equal(await catalog.locator('article').count(), 3);
    await catalog.getByRole('button', { name: '回归岗位B', exact: true }).click();
    await page.locator('.detail-sheet:visible').getByText('完整岗位正文B', { exact: true }).waitFor();
    assert.ok(!new URL(page.url()).searchParams.has('employer'));
  });
  let releaseIndex;
  const indexGate = { promise: new Promise(resolve => { releaseIndex = resolve; }), release: () => releaseIndex() };
  await run('a preview company never claims full counts and keeps private input when the complete catalog arrives', { gate: indexGate }, async ({ page }) => {
    await page.getByLabel('首批预览', { exact: true }).getByRole('button', { name: `查看企业口碑：${rows[0].company}`, exact: true }).click();
    await panel(page).getByRole('heading', { name: '企业机会预览', exact: true }).waitFor();
    await panel(page).getByLabel('个人备注', { exact: true }).fill('PRIVATE_PREVIEW_DRAFT');
    indexGate.release(); await complete(page);
    await panel(page).getByRole('heading', { name: '企业全部机会', exact: true }).waitFor();
    await panel(page).getByText('3条已收录', { exact: true }).waitFor();
    assert.equal(await panel(page).getByLabel('个人备注', { exact: true }).inputValue(), 'PRIVATE_PREVIEW_DRAFT');
  });
  await run('company share link restores the same catalog without private intent or notes', {}, async ({ page }) => {
    await open(page); await panel(page).getByLabel('个人备注', { exact: true }).fill('PRIVATE_COMPANY_DRAFT');
    await panel(page).getByRole('button', { name: '分享企业', exact: true }).click();
    await panel(page).getByText('企业链接已复制，不包含个人意向或备注', { exact: true }).waitFor();
    const url = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(new URL(url).searchParams.get('employer'), resolveEmployer(rows[0]).id);
    assert.doesNotMatch(url, /PRIVATE|rating|notes/);
    await page.goto(url); await complete(page); await panel(page).getByRole('heading', { name: '企业全部机会', exact: true }).waitFor();
    assert.equal(await panel(page).getByLabel('企业全部机会', { exact: true }).locator('article').count(), 2);
  });
  await run('missing company identity is preserved with a dismissible explanation', { query: formatUrlQuery(defaultFilters, null,
    resolveEmployer(fixtureJob({ company: '已经不在索引的公司有限公司' })).id) }, async ({ page }) => {
    await page.getByText('这个企业暂不在当前索引中，企业链接已保留，可刷新后再查看。', { exact: false }).waitFor();
    assert.ok(new URL(page.url()).searchParams.has('employer'));
    await page.getByRole('button', { name: '关闭企业链接', exact: true }).click();
    assert.ok(!new URL(page.url()).searchParams.has('employer'));
  });
  await run('source panel distinguishes real integration from historical search and restricted access', {}, async ({ page }) => {
    await page.getByRole('button', { name: '信息来源', exact: true }).click();
    const coverage = page.getByLabel('企业评价来源覆盖', { exact: true }); await coverage.waitFor();
    await coverage.locator('summary').filter({ hasText: '看准' }).click();
    assert.match(await coverage.innerText(), /婚恋交友产品/);
    await coverage.locator('summary').filter({ hasText: '脉脉' }).click();
    assert.match(await coverage.innerText(), /尚未取得授权评价数据渠道/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  });
  for (const width of [320, 390, 1440]) await run(`catalog and pipeline fit ${width}px with keyboard focus restored`, { width }, async ({ page }) => {
    await open(page); await panel(page).getByLabel('企业岗位工作城市', { exact: true }).selectOption('上海');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (output) await page.screenshot({ path: `${output}/company-${width}.png` });
    await page.keyboard.press('Escape'); await panel(page).waitFor({ state: 'hidden' });
    assert.ok(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')?.startsWith('查看企业口碑：')));
    await page.goto(base + formatUrlQuery({ ...defaultFilters, city: '全部城市', workCities: [], view: 'pipeline' }));
    await complete(page); await page.getByLabel('投递阶段总览', { exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (output) await page.screenshot({ path: `${output}/pipeline-${width}.png` });
  });
} finally { await browser.close(); }
if (output) writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
console.log(`${results.filter(row => row.passed).length}/${results.length} passed`);
if (results.some(row => !row.passed)) process.exitCode = 1;
