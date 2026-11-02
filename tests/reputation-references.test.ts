import assert from 'node:assert/strict';
import test from 'node:test';
import config from '../config/employer-public-references.json' with { type: 'json' };
import { employerPublicReferences, validatePublicEmployerReference } from '../lib/reputation-references.ts';
import { resolveEmployer } from '../lib/employers.ts';
import { fixtureJob } from './fixtures/job.ts';

await test('curated public references keep original date and never become employee scores', () => {
  const profile = resolveEmployer(fixtureJob({ company: '海尔集团', source_id: 'haier-campus' }))!;
  const [row] = employerPublicReferences(profile);
  assert.equal(row.published_on, '2024-12-17');
  assert.equal(row.checked_on, '2026-11-02');
  assert.equal(row.kind, 'interview');
  assert.ok(!('score' in row));
  assert.equal(row.method, 'manual_public_read');
});
await test('only explicit name or configured official brand matches, never a substring subsidiary', () => {
  assert.equal(employerPublicReferences(resolveEmployer(fixtureJob({ company: '海尔智家股份有限公司' }))!).length, 0);
  assert.equal(employerPublicReferences(resolveEmployer(fixtureJob({ company: '其它企业有限公司' }))!).length, 0);
  const department = resolveEmployer(fixtureJob({ company: '全球营销中心-中国区', source_id: 'haier-campus' }))!;
  assert.equal(employerPublicReferences(department).length, 1);
});
await test('untrusted URLs, dates and score-bearing curated records are rejected', () => {
  const row = config.references[0];
  for (const changes of [{ url: 'javascript:alert(1)' }, { url: 'https://maimai.cn/article/detail?fid=1&token=private' },
    { published_on: '2024-02-30' }, { checked_on: '2023-01-01' }, { kind: 'experience' }, { score: 4.5 }, { signals: [] }])
    assert.throws(() => validatePublicEmployerReference({ ...row, ...changes }));
});
