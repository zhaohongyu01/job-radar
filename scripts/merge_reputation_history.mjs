// Publication-only merge. It does not crawl sources or refresh source dates.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { mergeReputationHistory } from '../lib/reputation-history.ts';
import { validateReputationEntity, validateReputationIndex, summarizeReputationEntity, reputationAssetPrefix } from '../lib/reputation.ts';

const [directory, previousDirectory, seedDirectory, blockedFile] = process.argv.slice(2);
if (!blockedFile) throw Error('Usage: merge_reputation_history.mjs incoming previous seed blocked.json');
const readIndex = dir => validateReputationIndex(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')));
const incoming = readIndex(directory), previous = readIndex(previousDirectory), seed = readIndex(seedDirectory);
const blocked = new Set(JSON.parse(readFileSync(blockedFile, 'utf8')));
function readEntity(dir, item) {
  const raw = readFileSync(join(dir, item.file), 'utf8');
  const digest = createHash('sha256').update(raw).digest('hex').slice(0, 20);
  if (!item.file.endsWith(`-${digest}.json`)) throw Error('History checksum mismatch');
  const entity = validateReputationEntity(JSON.parse(raw));
  if (entity.id !== item.id || !item.file.startsWith(reputationAssetPrefix(entity) + '-')) throw Error('History identity mismatch');
  return entity;
}
const merged = new Map();
for (const [dir, index] of [[seedDirectory, seed], [previousDirectory, previous], [directory, incoming]]) {
  for (const item of index.entities) {
    if (blocked.has(item.id)) continue;
    const entity = readEntity(dir, item), old = merged.get(entity.id);
    merged.set(entity.id, old ? mergeReputationHistory(old, entity) : entity);
  }
}
const now = Date.now(), entities = [];
for (const entity of merged.values()) {
  const raw = JSON.stringify(entity), hash = createHash('sha256').update(raw).digest('hex').slice(0, 20);
  const file = `${reputationAssetPrefix(entity)}-${hash}.json`;
  writeFileSync(join(directory, file), raw);
  const { records, ...metadata } = entity;
  entities.push({ ...metadata, ...summarizeReputationEntity(entity, now, records), file });
}
writeFileSync(join(directory, 'index.json'), JSON.stringify(validateReputationIndex({ ...incoming, schema_version: 2,
  generated_at: new Date(now).toISOString(), entities })));
console.log(JSON.stringify({ merged_enterprises: entities.length, protected_unread_history: blocked.size }));
