import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGroupRoleItems, groupJobs } from '../lib/grouping.ts';
import { defaultFilters, employerGroupName, filterJobs } from '../lib/jobs.ts';
import type { Job } from '../lib/jobs.ts';

const base = { id: 'a', company: '某银行济南分行', title: '某银行2027届校园招聘', types: ['校招'],
  graduation_years: ['2027'], published_at: '2026-09-10', cities: ['济南'], location_evidence: ['工作地点：济南'],
  sectors: [], directions: [], education: '', deadline: null, domestic_status: 'domestic',
} as unknown as Job;

void test('grouping retains all records, URLs and newest-first group order', () => {
  const jobs = [base, { ...base, id: 'b', company: '另一企业' }, { ...base, id: 'c', source_url: 'https://example.com/apply', published_at: '2026-09-09' }];
  const groups = groupJobs(jobs);
  assert.deepEqual(groups.map((g) => g.jobs.map((j) => j.id)), [['a', 'c'], ['b']]);
  assert.equal(groups[0].jobs[1].source_url, 'https://example.com/apply');
  assert.equal(groupJobs(jobs, false).length, 3);
  assert.equal(jobs.length, 3);
});
void test('branches, cohorts, explicit phases and uncertain identities remain separate', () => {
  const jobs = [base, { ...base, id: 'b', company: '某银行青岛分行' }, { ...base, id: 'c', title: '2026届校园招聘' },
    { ...base, id: 'd', title: '2027届秋招' }, { ...base, id: 'e', company: '' },
    { ...base, id: 'f', title: '校园招聘', graduation_years: [] }, { ...base, id: 'g', types: ['社招'] }];
  assert.equal(groupJobs(jobs).length, jobs.length);
});
void test('city and personal filtering happens before grouping, so other records cannot leak in', () => {
  const jobs = [base, { ...base, id: 'b', cities: ['青岛'], location_evidence: ['工作地点：青岛'] }, { ...base, id: 'c' }];
  const filtered = filterJobs(jobs, defaultFilters, { c: { hidden: true } }, null);
  assert.deepEqual(groupJobs(filtered).flatMap((g) => g.jobs.map((j) => j.id)), ['a']);
});

void test('official departments can share a brand group without losing records or merging legal branches', () => {
  const jobs = [
    { ...base, id: 'sales', source_id: 'hisense-campus', company: '全球营销中心-中国区' },
    { ...base, id: 'research', source_id: 'hisense-campus', company: '研发中心' },
    { ...base, id: 'legal', source_id: 'hisense-campus', company: '海信视像科技股份有限公司' },
    { ...base, id: 'unknown', source_id: 'other', company: '研发中心' },
  ];
  const before = JSON.stringify(jobs);
  const groups = groupJobs(jobs);
  assert.deepEqual(groups.map((g) => g.jobs.map((j) => j.id)), [['sales', 'research'], ['legal'], ['unknown']]);
  assert.equal(groups[0].company, '海信集团');
  assert.equal(JSON.stringify(jobs), before);
  assert.equal(groupJobs(jobs, false).length, jobs.length);
});

void test('legal suffix variants normalize into one group and empty-company branded records fallback to brand', () => {
  const jobs = [
    { ...base, id: 'ql1', company: '齐鲁制药', title: '齐鲁制药2027届校园招聘' },
    { ...base, id: 'ql2', company: '齐鲁制药有限公司', title: '齐鲁制药有限公司2027届校园招聘' },
    { ...base, id: 'ql3', company: '齐鲁制药集团有限公司', title: '齐鲁制药集团有限公司2027届校园招聘' },
    { ...base, id: 'hs-empty', source_id: 'hisense-campus', company: '', title: '2027届算法工程师' },
    { ...base, id: 'hs-dept', source_id: 'hisense-campus', company: '产品中心', title: '2027届产品经理(J99881)' },
  ] as Job[];
  assert.equal(employerGroupName(jobs[3]), '海信集团');
  assert.equal(employerGroupName(jobs[4]), '海信集团');
  const groups = groupJobs(jobs);
  assert.deepEqual(groups.map((g) => g.jobs.map((j) => j.id)), [
    ['ql1', 'ql2', 'ql3'],
    ['hs-empty', 'hs-dept'],
  ]);

  const roleItems = buildGroupRoleItems([
    jobs[4],
    {
      ...base,
      id: 'brochure',
      company: '齐鲁制药',
      title: '齐鲁制药2027届校园招聘简章',
      positions: [
        { position_name: '制剂研发工程师', majors: [], raw_majors: '', cities: ['济南'], education: '硕士', headcount: 5 },
        { position_name: '质量分析研究员', majors: [], raw_majors: '', cities: ['济南'], education: '本科', headcount: 8 },
        { position_name: '注册专员', majors: [], raw_majors: '', cities: ['济南'], education: '本科', headcount: 3 },
      ],
    } as unknown as Job,
  ]);
  assert.equal(roleItems[0].cleanRole, '2027届产品经理');
  assert.equal(roleItems[1].cleanRole, '制剂研发工程师 / 质量分析研究员 等3岗');
  assert.ok(roleItems[1].searchText.includes('注册专员'));
});
