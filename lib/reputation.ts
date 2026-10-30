import policy from '../config/reputation-policy.json' with { type: 'json' };
import providerConfig from '../config/reputation-providers.json' with { type: 'json' };
import type { EmployerProfile } from './employers.ts';
import type { Job, Filters } from './jobs.ts';
import { resolveEmployer } from './employers.ts';
import type { EmployerRecords } from './employer-personal.ts';

export type Dimension = keyof typeof policy.dimensions;
export const REPUTATION_DIMENSIONS = policy.dimensions;
export const REPUTATION_PROVIDERS = providerConfig.providers;
export type ReputationProvider = keyof typeof REPUTATION_PROVIDERS;
export const REPUTATION_ASSET_PATTERN = '^entity-(?:(?:nowcoder|kanzhun|maimai)-)?[A-Za-z0-9_-]{1,80}-[a-f0-9]{20}\\.json$';
export const reputationAssetPrefix = (entity: Pick<ReputationEntity, 'id' | 'provider'>) => {
  const identifier = entity.id.slice(entity.provider.length + 1);
  return entity.provider === 'nowcoder' && /^\d+$/.test(identifier) ? `entity-${identifier}` : `entity-${entity.provider}-${identifier}`;
};
export type PlatformScore = { value: number; scale: number; samples: number | null; checked_at: string; url: string };
export type Evidence = {
  id: string; provider: ReputationProvider; url: string; title: string; excerpt: string;
  attribution?: 'target' | 'uncertain';
  kind: 'experience' | 'interview' | 'question'; published_at: string | null; collected_at: string;
  city: string | null; role: string | null; department: string | null; contributor: string | null;
  fingerprint: string; signals: { dimension: Dimension; polarity: 1 | -1; quote: string }[];
};
export type ReputationEntity = {
  id: string; provider: ReputationProvider; name: string; legal_name: string; names: string[];
  source_url: string; collected_at: string; status: 'ok' | 'partial' | 'failed'; partial: true;
  records: Evidence[];
  platform_score?: PlatformScore;
};
export type DimensionScore = { score: number | null; contributors: number; positive: number; negative: number };
export type ReputationSummary = {
  unattributed_count?: number;
  score: number | null; valid_until: string; experience_count: number; recent_experience_count: number;
  interview_count: number; question_count: number; latest_experience_at: string | null;
  dimensions: Record<Dimension, DimensionScore>;
};
export type ReputationItem = Omit<ReputationEntity, 'records'> & ReputationSummary & { file: string };
export type ReputationIndex = { schema_version: 1 | 2; generated_at: string; policy_version: number; entities: ReputationItem[] };
export type ReputationMatch = { item: ReputationItem; items: ReputationItem[]; reference: boolean };
const validDate = (value: unknown): value is string => typeof value === 'string' && /^20\d\d-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
const canonical = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ');
const dimensions = Object.keys(policy.dimensions) as Dimension[];

export function publicReputationUrl(value: unknown, provider?: ReputationProvider): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.origin === 'https://www.nowcoder.com') return (!provider || provider === 'nowcoder') && !url.search &&
      /^\/(?:enterprise\/\d+\/(?:discussion|interview)|feed\/main\/detail\/[a-f0-9]{32}|discuss\/\d+)$/.test(url.pathname);
    if (url.origin === 'https://www.kanzhun.com') return (!provider || provider === 'kanzhun') && !url.search &&
      /^\/firm\/(?:review\/|interview\/|salary\/)?[A-Za-z0-9_~.-]+\.html$/.test(url.pathname);
    if (url.origin === 'https://maimai.cn') return (!provider || provider === 'maimai') &&
      /^\/(?:company|community\/(?:feed-detail|gossip-detail)\/[A-Za-z0-9_-]+\/?|article\/detail)$/.test(url.pathname) &&
      [...url.searchParams.keys()].every(key => ['id', 'cid', 'fid', 'efid', 'company'].includes(key));
    return false;
  } catch { return false; }
}

/** Deduplicate URL mirrors, copy/pastes and source IDs before counting samples. */
export function dedupeEvidence(records: Evidence[]): Evidence[] {
  const urls = new Set<string>(), fingerprints = new Set<string>(), ids = new Set<string>();
  return [...records].sort((a, b) => Date.parse(b.collected_at) - Date.parse(a.collected_at)).filter(row => {
    if (urls.has(row.url) || fingerprints.has(row.fingerprint) || ids.has(row.id)) return false;
    urls.add(row.url); fingerprints.add(row.fingerprint); ids.add(row.id); return true;
  }).sort((a, b) => Date.parse(b.published_at || '1970-01-01') - Date.parse(a.published_at || '1970-01-01'));
}

/** These are rule-based opinion tendencies, never source platform scores or
 * verified facts. Missing evidence stays null, not zero or a default 3/5. */
export function summarizeReputation(records: Evidence[], now: number): ReputationSummary {
  const unique = dedupeEvidence(records);
  const experiences = unique.filter(row => row.kind === 'experience' && row.attribution !== 'uncertain');
  const recent = experiences.filter(row => row.published_at && Date.parse(row.published_at) <= now &&
    now - Date.parse(row.published_at) <= policy.recent_days * 86400000);
  // A successful interview read must not renew old experience-page evidence.
  const eligible = recent.filter(row => Date.parse(row.collected_at) <= now + 300000 &&
    Date.parse(row.collected_at) + policy.max_source_age_days * 86400000 > now);
  const results = Object.fromEntries(dimensions.map(key => {
    const contributors = new Map<string, number[]>();
    for (const row of eligible) {
      if (!row.contributor) continue;
      const observations = row.signals.filter(signal => signal.dimension === key).map(signal => signal.polarity);
      if (observations.length) contributors.set(row.contributor, [...(contributors.get(row.contributor) || []), ...observations]);
    }
    const opinions = [...contributors.values()].map(list => list.reduce((sum, value) => sum + value, 0) / list.length);
    const n = opinions.length, mean = n ? opinions.reduce((sum, value) => sum + (value + 1) * 2 + 1, 0) / n : 0;
    const score = n >= policy.minimum_contributors
      ? Math.round((mean * n + policy.prior_weight * policy.prior_score) / (n + policy.prior_weight) * 10) / 10 : null;
    return [key, { score, contributors: n, positive: opinions.filter(value => value > 0).length, negative: opinions.filter(value => value < 0).length }];
  })) as Record<Dimension, DimensionScore>;
  const available = dimensions.filter(key => results[key].score !== null);
  const weighted = available.reduce((sum, key) => sum + results[key].score! * policy.dimensions[key].weight, 0);
  const weight = available.reduce((sum, key) => sum + policy.dimensions[key].weight, 0);
  const expiry = Math.min(now + 86400000, ...eligible.flatMap(row => [
    Date.parse(row.published_at!) + policy.recent_days * 86400000,
    Date.parse(row.collected_at) + policy.max_source_age_days * 86400000,
  ]));
  return { score: available.length >= policy.minimum_scored_dimensions ? Math.round(weighted / weight * 10) / 10 : null,
    valid_until: new Date(expiry).toISOString(), dimensions: results,
    unattributed_count: unique.filter(row => row.attribution === 'uncertain').length,
    experience_count: experiences.length, recent_experience_count: recent.length,
    interview_count: unique.filter(row => row.kind === 'interview').length,
    question_count: unique.filter(row => row.kind === 'question').length,
    latest_experience_at: experiences.flatMap(row => row.published_at ? [row.published_at] : []).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) || null };
}

/** A new export must not make stale source readings eligible again. */
export function summarizeReputationEntity(entity: ReputationEntity, now: number, records = entity.records): ReputationSummary {
  const summary = summarizeReputation(records, now);
  const sourceExpiry = Date.parse(entity.collected_at) + policy.max_source_age_days * 86400000;
  summary.valid_until = new Date(Math.min(Date.parse(summary.valid_until), sourceExpiry)).toISOString();
  if (sourceExpiry <= now || Date.parse(entity.collected_at) > now + 300000) {
    summary.score = null;
    for (const dimension of Object.values(summary.dimensions)) dimension.score = null;
  }
  return summary;
}

export function validateReputationEntity(input: unknown): ReputationEntity {
  if (!input || typeof input !== 'object') throw Error('口碑数据格式不正确');
  const value = input as ReputationEntity;
  if (!Object.hasOwn(REPUTATION_PROVIDERS, value.provider) || !new RegExp(`^${value.provider}:[A-Za-z0-9_-]{1,80}$`).test(value.id) ||
      value.provider === 'nowcoder' && !/^nowcoder:\d+$/.test(value.id) ||
      typeof value.name !== 'string' || !value.name || value.name.length > 160 || typeof value.legal_name !== 'string' || value.legal_name.length > 160 ||
      !Array.isArray(value.names) || !value.names.length || value.names.length > 10 || value.names.some(name => typeof name !== 'string' || !name || name.length > 160) ||
      !publicReputationUrl(value.source_url, value.provider) || value.provider === 'nowcoder' && !value.source_url.includes(`/enterprise/${value.id.split(':')[1]}/`) ||
      !validDate(value.collected_at) || !['ok', 'partial', 'failed'].includes(value.status) || value.partial !== true ||
      !Array.isArray(value.records) || value.records.length > 300) throw Error('口碑企业或来源不正确');
  for (const row of value.records) {
    if (!row || !new RegExp(`^${value.provider}:[A-Za-z0-9_-]{1,100}$`).test(row.id) || row.provider !== value.provider ||
        !publicReputationUrl(row.url, row.provider) || row.url.includes('/enterprise/') ||
        typeof row.title !== 'string' || row.title.length > 100 || typeof row.excerpt !== 'string' || row.excerpt.length > 100 ||
        (row.attribution !== undefined && !['target', 'uncertain'].includes(row.attribution)) ||
        !['experience', 'interview', 'question'].includes(row.kind) || (row.published_at !== null && !validDate(row.published_at)) || !validDate(row.collected_at) ||
        ![row.city, row.role, row.department].every(field => field === null || typeof field === 'string' && field.length <= 80) ||
        !(row.contributor === null || /^[a-f0-9]{24}$/.test(row.contributor)) || !/^[a-f0-9]{64}$/.test(row.fingerprint) ||
        !Array.isArray(row.signals) || row.signals.length > 4 || row.signals.some(signal =>
          !dimensions.includes(signal.dimension) || ![1, -1].includes(signal.polarity) || typeof signal.quote !== 'string' || signal.quote.length > 80) ||
        (row.kind !== 'experience' && row.signals.length)) throw Error('口碑条目或摘句不正确');
  }
  const native = value.platform_score;
  if (native !== undefined && (!Number.isFinite(native.value) || !Number.isFinite(native.scale) || native.scale <= 0 || native.scale > 100 ||
      native.value < 0 || native.value > native.scale || !(native.samples === null || Number.isSafeInteger(native.samples) && native.samples >= 0) ||
      !validDate(native.checked_at) || !publicReputationUrl(native.url, value.provider))) throw Error('平台原生评分格式不正确');
  return { ...value, records: dedupeEvidence(value.records) };
}

export function validateReputationIndex(input: unknown): ReputationIndex {
  if (!input || typeof input !== 'object') throw Error('口碑索引格式不正确');
  const value = input as ReputationIndex;
  if (![1, 2].includes(value.schema_version) || value.policy_version !== policy.version || !validDate(value.generated_at) ||
      !Array.isArray(value.entities) || value.entities.length > 10000) throw Error('口碑索引版本不正确');
  const ids = new Set<string>();
  for (const item of value.entities) {
    validateReputationEntity({ ...item, records: [] });
    if (ids.has(item.id) || !new RegExp(`^${reputationAssetPrefix(item)}-[a-f0-9]{20}\\.json$`).test(item.file) ||
        !(item.score === null || Number.isFinite(item.score) && item.score >= 1 && item.score <= 5) || !validDate(item.valid_until) ||
        Date.parse(item.valid_until) > Date.parse(value.generated_at) + 86400000 ||
        ![item.experience_count, item.recent_experience_count, item.interview_count, item.question_count].every(count => Number.isSafeInteger(count) && count >= 0) ||
        (item.unattributed_count !== undefined && (!Number.isSafeInteger(item.unattributed_count) || item.unattributed_count < 0)) ||
        item.recent_experience_count > item.experience_count ||
        (item.latest_experience_at !== null && !validDate(item.latest_experience_at)) || !item.dimensions ||
        dimensions.some(key => !item.dimensions[key] ||
          !(item.dimensions[key].score === null || Number.isFinite(item.dimensions[key].score) && item.dimensions[key].score! >= 1 && item.dimensions[key].score! <= 5) ||
          ![item.dimensions[key].contributors, item.dimensions[key].positive, item.dimensions[key].negative].every(count => Number.isSafeInteger(count) && count >= 0) ||
          item.dimensions[key].positive + item.dimensions[key].negative > item.dimensions[key].contributors ||
          item.dimensions[key].score !== null && item.dimensions[key].contributors < policy.minimum_contributors) ||
        (item.score !== null && dimensions.filter(key => item.dimensions[key].score !== null).length < policy.minimum_scored_dimensions)) throw Error('口碑索引计数或评分不正确');
    ids.add(item.id);
  }
  return value;
}

const aliases = new WeakMap<ReputationIndex, Map<string, ReputationItem[]>>();
function resolveMatches(items: ReputationItem[], profile: EmployerProfile): ReputationMatch | null {
  if (!items.length || new Set(items.map(item => item.provider)).size !== items.length ||
      new Set(items.map(item => canonical(item.legal_name))).size > 1) return null;
  // Prefer the established source for the listing reference score; other
  // platforms stay independently selectable, never averaged across scales.
  const ordered = [...items].sort((a, b) => Object.keys(REPUTATION_PROVIDERS).indexOf(a.provider) - Object.keys(REPUTATION_PROVIDERS).indexOf(b.provider));
  return { item: ordered[0], items: ordered, reference: profile.scope !== 'name' || canonical(ordered[0].legal_name) !== canonical(profile.name) };
}
export function matchReputation(profile: EmployerProfile | null, index: ReputationIndex | null): ReputationMatch | null {
  if (!profile || !index) return null;
  if (!aliases.has(index)) {
    const names = new Map<string, ReputationItem[]>();
    for (const item of index.entities) for (const name of new Set(item.names.map(canonical))) names.set(name, [...(names.get(name) || []), item]);
    aliases.set(index, names);
  }
  const names = aliases.get(index)!;
  const candidates = names.get(canonical(profile.name)) || [];
  if (candidates.length) return resolveMatches(candidates, profile);
  if (profile.brand) {
    const brands = names.get(canonical(profile.brand)) || [];
    if (brands.length) { const match = resolveMatches(brands, profile); return match ? { ...match, reference: true } : null; }
  }
  return null;
}

export function mergeReputationIndexes(current: ReputationIndex | null, incoming: ReputationIndex): ReputationIndex {
  if (!current) return incoming;
  const newer = Date.parse(incoming.generated_at) >= Date.parse(current.generated_at);
  const rows = new Map(current.entities.map(row => [row.id, row]));
  for (const row of incoming.entities) {
    const old = rows.get(row.id);
    if (!old || Date.parse(row.collected_at) > Date.parse(old.collected_at) || Date.parse(row.collected_at) === Date.parse(old.collected_at) && newer) rows.set(row.id, row);
  }
  return { ...(newer ? incoming : current), schema_version: Math.max(current.schema_version, incoming.schema_version) as 1 | 2, entities: [...rows.values()] };
}

export function currentReputationScore(match: ReputationMatch | null, now: number): number | null {
  return match && !match.reference && Date.parse(match.item.valid_until) > now ? match.item.score : null;
}

export function filterByReputation(jobs: Job[], filters: Filters, index: ReputationIndex | null, personal: EmployerRecords, now: number): Job[] {
  const minimum = filters.reputationMin === '3' || filters.reputationMin === '4' ? Number(filters.reputationMin) : 0;
  const publicSort = filters.sort === 'reputation_desc', personalSort = filters.sort === 'employer_intent_desc';
  if (!minimum && !publicSort && !personalSort) return jobs;
  // Optional reputation data failure never removes the underlying jobs.
  if ((minimum || publicSort) && !index && !personalSort) return jobs;
  const ranked = jobs.map((job, order) => {
    const profile = resolveEmployer(job);
    return { job, order, score: currentReputationScore(matchReputation(profile, index), now), intent: profile ? personal[profile.id]?.rating ?? null : null };
  }).filter(row => !minimum || !index || (row.score === null ? filters.includeUnrated !== false : row.score >= minimum));
  if (publicSort || personalSort) ranked.sort((a, b) => {
    const left = personalSort ? a.intent : a.score, right = personalSort ? b.intent : b.score;
    return (right ?? -1) - (left ?? -1) || a.order - b.order;
  });
  return ranked.map(row => row.job);
}
