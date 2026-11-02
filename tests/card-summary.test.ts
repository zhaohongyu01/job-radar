import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureJob } from './fixtures/job.ts';
import { filterJobs, defaultFilters } from '../lib/jobs.ts';
import { buildCardSummaries, CARD_SUMMARY_LIMIT, cardSummaryFor, extractCardSummary, validateCardSummary } from '../lib/card-summary.ts';
import { projectBrowsingJobs, validateBrowsingJob } from '../lib/browse-index.ts';

const company = '甲科技有限公司';
const intro = `${company}成立于2010年，专注于工业设备的研发与服务，为客户提供设备制造和技术服务，拥有独立研发团队。`;
const duties = '1、负责海外市场开拓和客户维护，参与商务谈判与合同执行，协调交付及售后服务。';
const metadata = `单位名称：${company}\n学历要求：本科\n工作地点：济南\n联系人：示例联系人\n`;

await test('company introduction is selected beyond metadata and stops before duties or contacts', () => {
  const summary = extractCardSummary(fixtureJob({ company, body: `${metadata}一、公司简介\n${intro}\n二、岗位职责：\n${duties}\n联系方式：不展示` }));
  assert.equal(summary.kind, 'company');
  assert.equal(summary.text, intro);
  assert.doesNotMatch(summary.text, /本科|联系人|负责海外|不展示/);
});

await test('a real role section replaces repeated table fields without inventing company facts', () => {
  const summary = extractCardSummary(fixtureJob({ company, body: `${metadata}岗位职责：\n${duties}\n任职要求：\n熟悉国际贸易。` }));
  assert.equal(summary.kind, 'responsibilities');
  assert.equal(summary.text, duties);
  assert.doesNotMatch(summary.text, /成立|单位名称|本科|济南|示例联系人|任职要求/);
  assert.equal(extractCardSummary(fixtureJob({ excerpt: metadata })).kind, 'notice');
  assert.equal(extractCardSummary(fixtureJob({ excerpt: metadata })).text, '单位介绍与岗位说明请查看原公告。');
});

await test('nested description headings, HTML and source entities remain safe plain text', () => {
  const job = fixtureJob({ company, body: `<p>职位描述：</p><div>岗位职责：<br>${duties}</div><p>任职要求：本科</p><script>untrusted()</script>` });
  assert.equal(extractCardSummary(job).text, duties);
  const summary = extractCardSummary(fixtureJob({ company, body: `<h2>【公司简介】</h2><p>${intro}&nbsp;研发&amp;服务。</p><h2>招聘岗位</h2><p>不进入介绍</p>` }));
  assert.equal(summary.kind, 'company');
  assert.match(summary.text, /研发&服务/);
  assert.doesNotMatch(summary.text, /<|招聘岗位|不进入介绍|untrusted/);
});

await test('an unlabelled introduction must explicitly name the employer', () => {
  assert.equal(extractCardSummary(fixtureJob({ company, body: intro })).kind, 'company');
  assert.notEqual(extractCardSummary(fixtureJob({ company: '另一家有限公司', body: intro })).kind, 'company');
  assert.notEqual(extractCardSummary(fixtureJob({ company, body: '公司介绍信专员岗位主要协助编写材料，与单位的基本情况介绍没有关系。' })).kind, 'company');
});

await test('a unit paragraph in its own announcement takes precedence over unrelated group businesses', () => {
  const text = '公司简介：\n甲集团主要从事食品和贸易业务，拥有多个不同领域的业务板块。\n旗下乙方重工专注新能源装载机和工程机械研发，提供装备制造及技术支持服务。\n招聘岗位：工程师';
  const summary = extractCardSummary(fixtureJob({ company: '乙方重工有限公司', body: text }));
  assert.equal(summary.kind, 'company');
  assert.match(summary.text, /新能源装载机/);
  assert.doesNotMatch(summary.text, /食品和贸易/);
});

await test('exact same company can reuse an attributed introduction; branches, departments and uncertain names cannot', () => {
  const jobs = [fixtureJob({ id: 'intro', company, body: `公司简介：${intro}`, published_at: '2026-10-10', source_url: 'https://example.org/intro' }),
    fixtureJob({ id: 'role', company, body: `岗位职责：${duties}` }),
    fixtureJob({ id: 'branch', company: company + '济南分公司', body: `岗位职责：${duties}` }),
    fixtureJob({ id: 'conflict', company, company_conflict: true, body: `岗位职责：${duties}` })];
  const summaries = buildCardSummaries(jobs);
  assert.equal(summaries.get('role')?.kind, 'company');
  assert.equal(summaries.get('role')?.source_url, 'https://example.org/intro');
  assert.equal(summaries.get('role')?.source_published_at, '2026-10-10');
  assert.equal(summaries.get('branch')?.kind, 'responsibilities');
  assert.equal(summaries.get('conflict')?.kind, 'responsibilities');
  const unsafe = buildCardSummaries(jobs.map(job => job.id === 'intro' ? { ...job, provenance: '第三方线索' } : job));
  assert.equal(unsafe.get('role')?.kind, 'responsibilities');
  const unnamed = buildCardSummaries(jobs.map(job => job.id === 'intro' ? { ...job, body: '公司简介：本公司专注工业设备研发与技术服务，拥有独立研发团队并提供可靠的售后支持服务。' } : job));
  assert.equal(unnamed.get('intro')?.kind, 'company');
  assert.equal(unnamed.get('role')?.kind, 'responsibilities');
  const bracketedName = '甲科技（中国）有限公司';
  const bracketed = buildCardSummaries([fixtureJob({ id: 'a', company: bracketedName, source_url: 'https://example.org/about', body: '公司简介：' + bracketedName + '成立于2010年，专注工业设备研发和技术服务，拥有独立的技术研发团队。' }),
    fixtureJob({ id: 'b', company: bracketedName, body: `岗位职责：${duties}` })]);
  assert.equal(bracketed.get('b')?.kind, 'company');
});

await test('browsing uses existing full search text and leaves canonical excerpt, time and eligibility unchanged', () => {
  const job = fixtureJob({ company, excerpt: metadata, deadline: '2026-12-01', published_at: '2026-10-20' });
  const original = structuredClone(job);
  const { jobs: [projected] } = projectBrowsingJobs([job], { [job.id]: metadata + '\n公司简介：' + intro });
  assert.deepEqual(job, original);
  assert.equal(projected.card_summary?.kind, 'company');
  assert.equal(projected.excerpt, intro);
  for (const key of ['deadline', 'published_at', 'cities', 'education', 'types', 'first_seen_at', 'last_verified_at'] as const)
    assert.deepEqual(projected[key], job[key]);
  validateBrowsingJob(projected);
  assert.deepEqual(cardSummaryFor(projected), { ...projected.card_summary, text: intro });
});

await test('an attributed company introduction never adds another announcement keywords to job search', () => {
  const input = [fixtureJob({ id: 'source', company, body: `公司简介：${intro} 稀有行业关键词。`, source_url: 'https://example.org/intro' }),
    fixtureJob({ id: 'position', company, body: `岗位职责：${duties}` })];
  const { jobs } = projectBrowsingJobs(input);
  const withSearch = jobs.map(job => ({ ...job, search_text: input.find(row => row.id === job.id)!.body }));
  const result = filterJobs(withSearch, { ...defaultFilters, city: '全部城市', workCities: [], query: '稀有行业关键词' }, {}, null);
  assert.deepEqual(result.map(job => job.id), ['source']);
});

await test('summary bounds count unicode characters and malformed source metadata is rejected', () => {
  const summary = extractCardSummary(fixtureJob({ company, body: '公司简介：' + intro + '🙂'.repeat(500) }));
  assert.equal(Array.from(summary.text).length, CARD_SUMMARY_LIMIT);
  assert.ok(summary.text.endsWith('…'));
  validateCardSummary(summary);
  for (const changes of [{ text: 'a'.repeat(CARD_SUMMARY_LIMIT + 1) }, { source_url: 'javascript:alert(1)' }, { source_url: 'https://user:password@example.org' }, { source_published_at: 'invalid' }])
    assert.throws(() => validateCardSummary({ ...summary, ...changes }));
});
