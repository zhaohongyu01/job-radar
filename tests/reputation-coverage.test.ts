import assert from 'node:assert/strict';
import test from 'node:test';
import { auditEmployerCoverage } from '../lib/reputation-coverage.ts';
import { fixtureJob } from './fixtures/job.ts';
import type { ReputationIndex } from '../lib/reputation.ts';
await test('coverage counts active public employers once and excludes expired jobs/events', () => {
  const now = Date.parse('2026-11-02T00:00:00Z');
  const rows = [fixtureJob({ company: '示例有限公司' }), fixtureJob({ id: 'two', company: '示例有限公司' }),
    fixtureJob({ company: '过期有限公司', deadline: '2020-01-01' }), fixtureJob({ company: '活动有限公司', kind: '宣讲会' })];
  const index: ReputationIndex = { schema_version: 2, policy_version: 1, generated_at: new Date(now).toISOString(), entities: [] };
  const report = auditEmployerCoverage(rows, index, now);
  assert.equal(report.active_employers, 1);
  assert.equal(report.employers[0].active_jobs, 2);
  assert.equal(report.gaps.unmapped_or_ambiguous, 1);
  assert.equal(report.employers[0].score, null);
});
