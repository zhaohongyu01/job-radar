import fs from 'node:fs';
import { filterJobs, defaultFilters } from '../lib/jobs.ts';

const snapshot = JSON.parse(fs.readFileSync(new URL('../public/jobs.json', import.meta.url), 'utf8'));
const now = Date.now();
const countBy = (rows, field) => Object.fromEntries([...new Set(rows.map(row => row[field] || '未标注'))].map(value => [value, rows.filter(row => (row[field] || '未标注') === value).length]));
const local = filterJobs(snapshot.jobs, defaultFilters, {}, null, now);
const campus = filterJobs(snapshot.jobs, {...defaultFilters, type:'校招', includeUncertain:false}, {}, null, now);
const employers = ['同仁堂','喜家德','中建港航','工商银行','工银安盛','德邦证券','希望学','亨通','中国外运','奥太','金雷','中铁装配','美赫','翼菲','山东移动','和谐健康','山推','中信银行','泰豪','华润双鹤'];
const result = {
  generated_at:snapshot.generated_at,
  raw_records:snapshot.raw_records || snapshot.jobs.length,
  displayed_records:snapshot.jobs.length,
  identical_reposts_merged:snapshot.duplicates_merged || 0,
  source_channels:snapshot.sources.length,
  jinan_default:local.length,
  jinan_by_kind:countBy(local,'kind'),
  jinan_by_provenance:countBy(local,'provenance'),
  jinan_explicit_2027_campus:campus.length,
  jinan_finance:filterJobs(snapshot.jobs,{...defaultFilters,direction:'财务 / 经济'}, {}, null, now).length,
  jinan_management:filterJobs(snapshot.jobs,{...defaultFilters,direction:'管理 / 职能'}, {}, null, now).length,
  employer_gap_check:employers.map(name => ({name, all:snapshot.jobs.filter(j => (j.title+' '+j.company).includes(name)).length,
    jinan:local.filter(j => (j.title+' '+j.company).includes(name)).length})),
  sources:snapshot.sources.map(s=>({name:s.name,status:s.status,pages:s.pages,discovered:s.discovered,parsed:s.parsed,cached:s.cached||0,coverage:s.coverage,errors:s.errors.length})),
};
console.log(JSON.stringify(result,null,2));
