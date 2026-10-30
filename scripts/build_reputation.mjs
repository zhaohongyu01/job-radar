import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { dedupeEvidence, summarizeReputationEntity, validateReputationEntity, validateReputationIndex, reputationAssetPrefix } from '../lib/reputation.ts';
import policy from '../config/reputation-policy.json' with { type: 'json' };
import sources from '../config/reputation-sources.json' with { type: 'json' };

const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error('Usage: build_reputation.mjs state.json public/reputation');
const state = JSON.parse(readFileSync(input, 'utf8'));
if (state.schema_version !== 1 || !state.enterprises || typeof state.enterprises !== 'object') throw Error('Invalid reputation state');
mkdirSync(resolve(output), { recursive: true });
const now = Date.now(), entities = [];
for (const [id, entry] of Object.entries(state.enterprises)) {
  const channels = Object.values(entry.channels || {});
  if (!channels.length) continue;
  const names = [...new Set(channels.flatMap(channel => channel.names))];
  const aliases = sources.pinned_names[channels[0].name] || [];
  const provider = channels[0].provider || 'nowcoder';
  const identity = id.includes(':') ? id : `${provider}:${id}`;
  const entity = validateReputationEntity({
    id: identity, provider, name: channels[0].name, legal_name: channels[0].legal_name,
    names: [...new Set([...names, ...aliases])], source_url: channels[0].source_url,
    status: entry.status, partial: true, collected_at: channels.map(channel => channel.last_success_at).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1),
    records: dedupeEvidence(channels.flatMap(channel => channel.records).map(row => row.kind === 'experience' && !row.attribution
      ? { ...row, attribution: 'uncertain', signals: [] } : row)),
    ...(entry.platform_score ? { platform_score: entry.platform_score } : {}),
  });
  const raw = JSON.stringify(entity), digest = createHash('sha256').update(raw).digest('hex').slice(0, 20);
  const file = `${reputationAssetPrefix(entity)}-${digest}.json`;
  writeFileSync(join(output, file), raw);
  const { records, ...metadata } = entity;
  entities.push({ ...metadata, ...summarizeReputationEntity(entity, now, records), file });
}
const index = validateReputationIndex({ schema_version: 2, policy_version: policy.version, generated_at: new Date(now).toISOString(), entities });
writeFileSync(join(output, 'index.json'), JSON.stringify(index));
console.log(JSON.stringify({ entities: entities.length, experiences: entities.reduce((sum, row) => sum + row.experience_count, 0),
  recent_experiences: entities.reduce((sum, row) => sum + row.recent_experience_count, 0), interviews: entities.reduce((sum, row) => sum + row.interview_count, 0),
  scored: entities.filter(row => row.score !== null).length, index_bytes: Buffer.byteLength(JSON.stringify(index)) }));
