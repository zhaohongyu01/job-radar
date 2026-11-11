import type { Job, Snapshot } from './jobs.ts';

const DB_NAME = 'job-radar-snapshot-v1';
const STORE_NAME = 'snapshots';
const ENTRY_KEY = 'latest';

interface CachedSnapshotPayload {
  signature: string;
  savedAt: number;
  jobs: Job[];
}

export function buildSnapshotCacheSignature(snapshot: Snapshot): string {
  const browse = snapshot.browse_index;
  const shards = browse?.shards?.length
    ? `b${browse.version}:${browse.count}:${browse.shards.join(',')}`
    : snapshot.index_shards?.length
      ? `i:${snapshot.index_count ?? 0}:${snapshot.index_shards.join(',')}`
      : `inline:${snapshot.jobs.length}`;
  return `${snapshot.schema_version}|${snapshot.generated_at}|${shards}`;
}

function openSnapshotDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

export async function readCachedSnapshotJobs(signature: string): Promise<Job[] | null> {
  try {
    const db = await openSnapshotDb();
    try {
      const entry = await new Promise<CachedSnapshotPayload | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const getReq = store.get(ENTRY_KEY);
        getReq.onsuccess = () => resolve(getReq.result as CachedSnapshotPayload | undefined);
        getReq.onerror = () => reject(getReq.error);
      });
      if (
        entry &&
        entry.signature === signature &&
        Array.isArray(entry.jobs) &&
        entry.jobs.length > 0
      ) {
        return entry.jobs;
      }
      return null;
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function writeCachedSnapshotJobs(signature: string, jobs: Job[]): Promise<void> {
  if (!signature || !Array.isArray(jobs) || jobs.length === 0) return;
  try {
    const db = await openSnapshotDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const payload: CachedSnapshotPayload = {
          signature,
          savedAt: Date.now(),
          jobs,
        };
        store.put(payload, ENTRY_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // Quota or private-browsing IndexedDB restrictions degrade silently to network shards.
  }
}
