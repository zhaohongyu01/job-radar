import { dedupeEvidence, validateReputationEntity } from './reputation.ts';
import type { ReputationEntity } from './reputation.ts';

/** Partial source pages cannot erase previously attributed evidence. */
export function mergeReputationHistory(previous: ReputationEntity, incoming: ReputationEntity): ReputationEntity {
  if (previous.id !== incoming.id || previous.provider !== incoming.provider || previous.legal_name !== incoming.legal_name)
    throw Error('口碑企业身份变化，不能合并历史');
  const latest = Date.parse(incoming.collected_at) >= Date.parse(previous.collected_at) ? incoming : previous;
  const records = dedupeEvidence([...previous.records, ...incoming.records].map(row =>
    row.kind === 'experience' && !row.attribution ? { ...row, attribution: 'uncertain' as const, signals: [] } : row)).slice(0, 300);
  // Unseen records keep their own publication/reading dates. Never renew an
  // old employee opinion with today's successful interview-page timestamp.
  return validateReputationEntity({ ...latest, records });
}
