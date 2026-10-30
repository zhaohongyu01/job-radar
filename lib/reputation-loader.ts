import { validateReputationEntity, validateReputationIndex, REPUTATION_ASSET_PATTERN, reputationAssetPrefix } from './reputation.ts';
import type { ReputationEntity, ReputationIndex } from './reputation.ts';

const entityPath = new RegExp(REPUTATION_ASSET_PATTERN);
export const validReputationFile = (file: string) => file === 'index.json' || entityPath.test(file);

export async function loadReputationFile(file: string, remote: boolean, signal?: AbortSignal): Promise<ReputationIndex | ReputationEntity> {
  if (!validReputationFile(file)) throw Error('口碑数据地址不正确');
  const response = await fetch(remote ? `/api/reputation?file=${encodeURIComponent(file)}` : `/reputation/${file}`,
    { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
      cache: file === 'index.json' ? 'no-cache' : 'force-cache' });
  if (!response.ok) throw Error('口碑数据暂时无法读取');
  const raw = await response.text();
  if (raw.length > 2000000) throw Error('口碑数据超过大小限制');
  if (entityPath.test(file)) {
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))))
      .map(value => value.toString(16).padStart(2, '0')).join('');
    if (!file.endsWith(`-${digest.slice(0, 20)}.json`)) throw Error('口碑数据校验失败');
    const entity = validateReputationEntity(JSON.parse(raw));
    if (!file.startsWith(`${reputationAssetPrefix(entity)}-`)) throw Error('口碑企业标识不一致');
    return entity;
  }
  return validateReputationIndex(JSON.parse(raw));
}
