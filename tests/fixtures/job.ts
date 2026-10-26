import type { Job } from '../../lib/jobs.ts';

export function fixtureJob(changes: Partial<Job> = {}): Job {
  return { id: '0123456789abcdef0123', title: '示例岗位', company: '示例公司', source_id: 'fixture', source_name: '官方样本', source_url: 'https://example.org/job',
    kind: '具体岗位', published_at: '2026-10-24', cities: ['北京'], location_evidence: ['工作地点：北京'],
    types: ['校招'], graduation_years: ['2027'], sectors: [], directions: [], education: '本科', deadline: null,
    deadline_precision: null, application_url: null, excerpt: '', first_seen_at: '2026-10-24T00:00:00+08:00',
    updated_at: '2026-10-24T00:00:00+08:00', last_verified_at: '2026-10-24T00:00:00+08:00', revision: 1, ...changes };
}
