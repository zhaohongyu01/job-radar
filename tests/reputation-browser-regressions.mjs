// Every reputation/job response is an isolated synthetic fixture. No third-
// party pages are crawled and no user records or publication APIs are touched.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fixtureJob } from './fixtures/job.ts';
import { defaultFilters } from '../lib/jobs.ts';
import { summarizeReputationEntity } from '../lib/reputation.ts';
import { resolveEmployer } from '../lib/employers.ts';
import { EMPLOYER_PERSONAL_STORAGE } from '../lib/employer-personal.ts';

const { chromium } = createRequire(import.meta.url)(process.env.JOB_RADAR_PLAYWRIGHT || 'playwright');
const base = process.env.JOB_RADAR_BROWSER_URL || 'http://127.0.0.1:3002';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const output = process.env.JOB_RADAR_BROWSER_OUTPUT;
if (output) mkdirSync(output, { recursive: true });
const now = Date.parse('2026-10-29T04:00:00Z'), at = new Date(now).toISOString();
const hash = text => createHash('sha256').update(text).digest('hex');
const dims = ['pay', 'worklife', 'growth', 'management'];
const jobs = [fixtureJob({ id: 'aaaaaaaaaaaaaaaaaaa1', title: '高分合成岗位甲', company: '示例科技有限公司', published_at: '2026-10-25' }),
  fixtureJob({ id: 'bbbbbbbbbbbbbbbbbbb2', title: '低分合成岗位乙', company: '其他科技有限公司', published_at: '2026-10-26' }),
  fixtureJob({ id: 'ccccccccccccccccccc3', title: '未知合成岗位丙', company: '尚无评价有限公司', published_at: '2026-10-27' })];
function makeEntity(id, name, polarity) {
  const records = Array.from({ length: 10 }, (_, i) => ({
    id: `nowcoder:${1000 * id + i}`, provider: 'nowcoder', url: `https://www.nowcoder.com/discuss/${1000 * id + i}`,
    title: `合成工作体验${id}-${i}`, excerpt: '隔离测试样本，不代表任何真实企业。', kind: 'experience',
    published_at: '2026-10-28T00:00:00Z', collected_at: at, city: i ? '上海' : '北京', role: i ? '销售' : '研发', department: i ? null : '产品',
    contributor: hash('account-' + i).slice(0, 24), fingerprint: hash(`body-${id}-${i}`),
    signals: dims.map(dimension => ({ dimension, polarity, quote: '合成测试体验表述' })),
  }));
  records.push({ ...records[0], id: `nowcoder:${id}900`, url: `https://www.nowcoder.com/discuss/${id}900`, title: '旧年实习体验测试',
    published_at: '2024-01-01T00:00:00Z', fingerprint: hash('old-' + id), contributor: hash('old-author').slice(0, 24) });
  for (const kind of ['interview', 'question']) records.push({ ...records[0], id: `nowcoder:${id}${kind === 'interview' ? 901 : 902}`,
    url: `https://www.nowcoder.com/discuss/${id}${kind === 'interview' ? 901 : 902}`, title: kind === 'interview' ? '隔离面经测试' : '隔离求助测试',
    fingerprint: hash(id + kind), kind, signals: [] });
  return { id: `nowcoder:${id}`, provider: 'nowcoder', name, legal_name: name, names: [name],
    source_url: `https://www.nowcoder.com/enterprise/${id}/discussion`, status: 'partial', partial: true, collected_at: at, records };
}
const fixtures = [makeEntity(1, jobs[0].company, 1), makeEntity(2, jobs[1].company, -1)];
const files = new Map(), metadata = fixtures.map(entity => {
  const raw = JSON.stringify(entity), file = `entity-${entity.id.split(':')[1]}-${hash(raw).slice(0, 20)}.json`;
  files.set(file, raw);
  const { records, ...rest } = entity;
  return { ...rest, ...summarizeReputationEntity(entity, now, records), file };
});
const index = { schema_version: 1, policy_version: 1, generated_at: at, entities: metadata };
const uncertainEntity = { ...fixtures[0], records: fixtures[0].records.map(row => row.kind === 'experience' ? { ...row, attribution: 'uncertain', signals: [] } : row) };
const uncertainRaw = JSON.stringify(uncertainEntity), uncertainFile = `entity-1-${hash(uncertainRaw).slice(0, 20)}.json`;
files.set(uncertainFile, uncertainRaw);
const { records: uncertainRecords, ...uncertainMeta } = uncertainEntity;
const uncertainIndex = { ...index, entities: [{ ...uncertainMeta, ...summarizeReputationEntity(uncertainEntity, now, uncertainRecords), file: uncertainFile }] };
const alternateEntity = { id: 'maimai:company3', provider: 'maimai', name: jobs[0].company, legal_name: jobs[0].company, names: [jobs[0].company],
  collected_at: at, source_url: 'https://maimai.cn/company?cid=3', status: 'partial', partial: true, records: [],
  platform_score: { value: 8.5, scale: 10, samples: 120, checked_at: at, url: 'https://maimai.cn/company?cid=3' } };
const alternateRaw = JSON.stringify(alternateEntity), alternateFile = `entity-maimai-company3-${hash(alternateRaw).slice(0, 20)}.json`;
files.set(alternateFile, alternateRaw);
const { records: alternateRecords, ...alternateMeta } = alternateEntity;
const multiSource = { ...index, schema_version: 2, entities: [...metadata, { ...alternateMeta, ...summarizeReputationEntity(alternateEntity, now, alternateRecords), file: alternateFile }] };
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [], panel = page => page.locator('.employer-sheet:visible');
const complete = page => page.locator('.result-count-num').waitFor({ timeout: 60000 });
async function setup(options = {}) {
  const context = await browser.newContext({ viewport: { width: options.width || 1440, height: 1000 } });
  const errors = [], requests = []; let failures = !!options.fail, detailFailures = !!options.detailFail;
  context.on('page', page => { page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push(r.url())); });
  await context.addInitScript(({ filters, personal, key, clock }) => {
    Date.now = () => clock;
    if (!['http:', 'https:'].includes(location.protocol) || localStorage.getItem('reputation-init')) return;
    localStorage.setItem('reputation-init', 'yes');
    localStorage.setItem('job-radar-browsing-v1', JSON.stringify({ filters, viewMode: 'cards', groupCompanies: false }));
    localStorage.setItem(key, JSON.stringify(personal || {}));
  }, { filters: { ...defaultFilters, city: '全部城市', workCities: [], ...options.filters },
    personal: options.personal, key: EMPLOYER_PERSONAL_STORAGE, clock: now });
  await context.route('**/jobs.json', route => route.fulfill({ json: { schema_version: 2, generated_at: at, schedule_enabled: true,
    last_success_at: at, jobs: options.jobs || jobs, cities: ['北京', '上海'], sources: [] } }));
  await context.route(/\/(?:api\/reputation(?:\?|$)|reputation\/)/, async route => {
    const url = new URL(route.request().url()), file = url.searchParams.get('file') || url.pathname.split('/').at(-1);
    if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay));
    if (failures || options.localFail && url.pathname.startsWith('/reputation/') || detailFailures && file !== 'index.json')
      return route.fulfill({ status: 503, json: { error: 'isolated source outage' } }).catch(() => {});
    if (file === 'index.json') return route.fulfill({ json: options.index || index }).catch(() => {});
    return route.fulfill({ status: files.has(file) ? 200 : 404, contentType: 'application/json',
      body: options.corrupt ? '{}' : files.get(file) || '{}' }).catch(() => {});
  });
  await context.route(/https:\/\/(?:www\.nowcoder|www\.bing|raw\.githubusercontent)\./, route => route.abort());
  const page = await context.newPage(); await page.goto(base); await complete(page);
  return { page, context, errors, requests, setFailures: value => { failures = value; }, recover: () => { failures = false; detailFailures = false; } };
}
async function open(page, job = jobs[0]) {
  await page.locator('.opp-card').filter({ hasText: job.title }).getByRole('button', { name: `查看企业口碑：${job.company}`, exact: true }).click();
  await panel(page).getByRole('heading', { name: '我的意向评分', exact: true }).waitFor();
}
async function loaded(page) { await panel(page).locator('.reputation-evidence article').first().waitFor(); }
async function run(name, options, check) {
  if (process.env.JOB_RADAR_REPUTATION_CASE && !name.includes(process.env.JOB_RADAR_REPUTATION_CASE)) return;
  let state;
  try { state = await setup(options); await check(state); assert.deepEqual(state.errors, []);
    results.push({ name, passed: true }); console.log('PASS', name);
  } catch (error) { results.push({ name, passed: false, error: String(error.stack || error) }); console.error('FAIL', name, error.message);
    if (output && state) await state.page.screenshot({ path: `${output}/failure-${results.length}.png` }).catch(() => {});
  } finally { await state?.context.close(); }
}
try {
  await run('uncertain company attribution never scores and automatically opens available interviews', { index: uncertainIndex }, async ({ page }) => {
    await open(page); await loaded(page);
    assert.match(await panel(page).locator('.reputation-evidence').innerText(), /隔离面经/);
    assert.equal(await panel(page).locator('.reputation-evidence article').count(), 1);
    assert.match(await panel(page).locator('.reputation-score').innerText(), /暂无综合分/);
    await panel(page).getByLabel('口碑内容类型').selectOption('unconfirmed');
    await panel(page).getByLabel('口碑发表时间').selectOption('all');
    assert.equal(await panel(page).locator('.reputation-evidence article').count(), 11);
    assert.equal(await panel(page).locator('.reputation-signal').count(), 0);
    assert.match(await panel(page).locator('.reputation-evidence').innerText(), /企业归属待核对/);
  });
  await run('optional slow reputation does not postpone job results or erase a private draft', { delay: 1200 }, async ({ page }) => {
    assert.equal(await page.locator('.opp-card').count(), 3); await open(page);
    const notes = panel(page).getByLabel('个人备注', { exact: true }); await notes.fill('私密草稿保留');
    await loaded(page); assert.equal(await notes.inputValue(), '私密草稿保留');
    assert.equal(await page.locator('.opp-card').count(), 3); assert.doesNotMatch(page.url(), /私密/);
  });
  await run('real evidence types dates and dimensions are separately displayed with attributed source links', {}, async ({ page, requests }) => {
    await open(page); await loaded(page);
    assert.match(await panel(page).innerText(), /体验倾向参考 4.3\/5/);
    assert.equal(await panel(page).locator('.reputation-evidence article').count(), 10);
    assert.match(await panel(page).innerText(), /牛客 · 公开页部分收录/);
    assert.equal(await panel(page).locator('.reputation-themes a').count(), 4);
    await panel(page).getByLabel('口碑内容类型').selectOption('interview');
    assert.equal(await panel(page).locator('.reputation-evidence article').count(), 1);
    assert.match(await panel(page).locator('.reputation-score').innerText(), /评价不足/);
    await panel(page).getByLabel('口碑内容类型').selectOption('question');
    assert.match(await panel(page).locator('.reputation-evidence').innerText(), /隔离求助/);
    assert.ok(!requests.some(url => /^https:\/\/(?:www\.nowcoder|raw\.githubusercontent)\./.test(url)));
  });
  await run('two providers share a verified company while keeping native scores, evidence and private drafts separate', { index: multiSource }, async ({ page }) => {
    await open(page); await loaded(page); await panel(page).getByLabel('个人备注', { exact: true }).fill('跨来源保留草稿');
    await panel(page).getByLabel('选择评价来源').selectOption('maimai:company3');
    await panel(page).getByText(/脉脉平台原生评分：8.5\/10/).waitFor();
    await panel(page).getByText('当前条件没有内容。', { exact: false }).waitFor();
    assert.match(await panel(page).locator('.reputation-score').innerText(), /评价不足/);
    assert.equal(await panel(page).getByLabel('个人备注', { exact: true }).inputValue(), '跨来源保留草稿');
    await panel(page).getByLabel('选择评价来源').selectOption('nowcoder:1'); await loaded(page);
    assert.equal(await panel(page).locator('.reputation-evidence article').count(), 10);
  });
  await run('old experience appears only in historical mode and never increases the recent score sample', {}, async ({ page }) => {
    await open(page); await loaded(page); assert.doesNotMatch(await panel(page).locator('.reputation-evidence').innerText(), /旧年/);
    await panel(page).getByLabel('口碑发表时间').selectOption('all');
    assert.equal(await panel(page).locator('.reputation-evidence article').count(), 11);
    assert.match(await panel(page).locator('.reputation-evidence').innerText(), /2024/);
    assert.match(await panel(page).locator('.reputation-score').innerText(), /10个账号/);
  });
  await run('city role department filters reduce evidence and insufficient samples do not receive a score', {}, async ({ page }) => {
    await open(page); await loaded(page);
    await panel(page).locator('.reputation-more > summary').click();
    await panel(page).getByLabel('评价工作城市', { exact: true }).selectOption('北京');
    assert.equal(await panel(page).locator('.reputation-evidence article').count(), 1);
    assert.match(await panel(page).locator('.reputation-score').innerText(), /评价不足/);
    await panel(page).getByLabel('评价岗位关键词').fill('研发'); await panel(page).getByLabel('评价部门关键词').fill('产品');
    assert.equal(await panel(page).locator('.reputation-evidence article').count(), 1);
  });
  await run('public minimum keeps unscored employers unless explicitly excluded and survives a shared URL', {
    filters: { reputationMin: '4' },
  }, async ({ page }) => {
    await page.waitForFunction(() => document.querySelectorAll('.opp-card').length === 2);
    assert.match((await page.locator('.opp-card').allTextContents()).join('\n'), /未知合成岗位丙/);
    const rail = page.locator('.filters-desktop'); await rail.locator('.filter-more > summary').click();
    await rail.getByRole('checkbox', { name: '保留评分不足的企业' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.opp-card').length === 1);
    const url = page.url(); assert.match(url, /includeUnrated=0/); assert.match(url, /reputationMin=4/);
    await page.reload(); await complete(page);
    await page.waitForFunction(() => document.querySelectorAll('.opp-card').length === 1);
    assert.match(await page.locator('.opp-card').innerText(), /高分合成岗位甲/);
  });
  await run('public sorting is selectable and leaves all opportunities present', {}, async ({ page }) => {
    await page.locator('.employer-public-pill').filter({ hasText: '4.3' }).waitFor();
    await page.getByRole('combobox', { name: '排序方式' }).click();
    await page.getByRole('option', { name: '企业体验参考优先', exact: true }).click();
    assert.match(await page.locator('.opp-card').first().innerText(), /高分合成岗位甲/);
    assert.equal(await page.locator('.opp-card').count(), 3);
  });
  await run('private intent sorting works without an external index', { fail: true, filters: { sort: 'employer_intent_desc' }, personal: {
    [resolveEmployer(jobs[1]).id]: { rating: 5, notes: '仅在本机', updated_at: at },
  } }, async ({ page }) => { assert.match(await page.locator('.opp-card').first().innerText(), /低分合成岗位乙/); });
  await run('source outage leaves every job visible and explicit retry can recover the enterprise panel', { fail: true,
    filters: { reputationMin: '4', includeUnrated: false },
  }, async ({ page, recover }) => {
    assert.equal(await page.locator('.opp-card').count(), 3); await open(page);
    await panel(page).getByRole('button', { name: '重试口碑' }).waitFor(); recover();
    await panel(page).getByRole('button', { name: '重试口碑' }).click(); await loaded(page);
    assert.match(await panel(page).locator('.reputation-score').innerText(), /4.3/);
  });
  await run('dedicated data delivery can supply assets absent from the code-bundled seed', { localFail: true }, async ({ page }) => {
    await open(page); await loaded(page); assert.match(await panel(page).locator('.reputation-score').innerText(), /4.3/);
  });
  await run('a warm update outage retains loaded evidence and drafts and exposes a working retry', {}, async ({ page, setFailures, recover }) => {
    await open(page); await loaded(page); await panel(page).getByRole('button', { name: '更新口碑', exact: true }).waitFor();
    await panel(page).getByLabel('个人备注', { exact: true }).fill('更新失败也不丢的草稿'); setFailures(true);
    await panel(page).getByRole('button', { name: '更新口碑', exact: true }).click();
    await panel(page).getByRole('button', { name: '重试口碑', exact: true }).waitFor();
    assert.equal(await panel(page).locator('.reputation-evidence article').count(), 10);
    assert.equal(await panel(page).getByLabel('个人备注', { exact: true }).inputValue(), '更新失败也不丢的草稿');
    recover(); await panel(page).getByRole('button', { name: '重试口碑', exact: true }).click();
    await panel(page).getByRole('button', { name: '更新口碑', exact: true }).waitFor();
    assert.equal(await panel(page).locator('.reputation-evidence article').count(), 10);
  });
  await run('failed detail requests are evicted so retry succeeds without losing private input', { detailFail: true }, async ({ page, recover }) => {
    await open(page); await panel(page).getByLabel('个人备注', { exact: true }).fill('不丢失的草稿');
    await panel(page).getByRole('button', { name: '重试评价详情' }).waitFor(); recover();
    await panel(page).getByRole('button', { name: '重试评价详情' }).click(); await loaded(page);
    assert.equal(await panel(page).getByLabel('个人备注', { exact: true }).inputValue(), '不丢失的草稿');
  });
  await run('a corrupt detail asset never displays unverified evidence', { corrupt: true }, async ({ page }) => {
    await open(page); await panel(page).getByRole('button', { name: '重试评价详情' }).waitFor();
    assert.equal(await panel(page).locator('.reputation-evidence article').count(), 0);
  });
  for (const width of [320, 390, 1440]) await run(`evidence controls and source quotes fit ${width}px without overflow`, { width }, async ({ page }) => {
    await open(page); await loaded(page); await panel(page).locator('.reputation-more > summary').click();
    await panel(page).getByLabel('评价部门关键词').fill('产品');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const box = await panel(page).boundingBox(); assert.ok(box.x >= -1 && box.x + box.width <= width + 1);
    if (output) await page.screenshot({ path: `${output}/reputation-${width}.png` });
    await page.keyboard.press('Escape'); await panel(page).waitFor({ state: 'hidden' });
    assert.ok(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')?.startsWith('查看企业口碑：')));
  });
} finally { await browser.close(); }
if (output) writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
console.log(`${results.filter(result => result.passed).length}/${results.length} passed`);
if (results.some(result => !result.passed)) process.exitCode = 1;
