import config from '../config/employer-public-references.json' with { type: 'json' };
import { publicReputationUrl } from './reputation.ts';
import type { EmployerProfile } from './employers.ts';

export type PublicEmployerReference = {
  provider: 'maimai'; subject: string; names: string[]; kind: 'interview';
  title: string; excerpt: string; url: string; published_on: string; checked_on: string;
  method: 'manual_public_read';
};
const canonical = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ');
export function validatePublicEmployerReference(input: unknown): PublicEmployerReference {
  const row = input as PublicEmployerReference;
  const date = (value: unknown) => typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!row || row.provider !== 'maimai' || row.kind !== 'interview' || row.method !== 'manual_public_read' ||
      typeof row.subject !== 'string' || !row.subject || row.subject.length > 160 || !Array.isArray(row.names) ||
      !row.names.includes(row.subject) || row.names.some(name => typeof name !== 'string' || !name || name.length > 160) ||
      !publicReputationUrl(row.url, row.provider) || new URL(row.url).pathname !== '/article/detail' || !/^\d+$/.test(new URL(row.url).searchParams.get('fid') || '') ||
      typeof row.title !== 'string' || !row.title || row.title.length > 100 ||
      typeof row.excerpt !== 'string' || !row.excerpt || row.excerpt.length > 80 ||
      !date(row.published_on) || !date(row.checked_on) || row.checked_on < row.published_on ||
      'score' in row || 'signals' in row || 'contributor' in row)
    throw Error('公开面经参考格式异常');
  return row;
}
const references = config.references.map(validatePublicEmployerReference);
/** Read-only curated pointers. Never inserted into scoring/matching entities,
 * counted as employees, automatically fetched or inherited by an unnamed child. */
export function employerPublicReferences(profile: EmployerProfile) {
  return references.filter(row => row.names.some(name => canonical(name) === canonical(profile.name) ||
    profile.brand && canonical(name) === canonical(profile.brand)));
}
