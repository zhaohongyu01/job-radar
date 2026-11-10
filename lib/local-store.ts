export const LOCAL_STORE_EVENT = 'job-radar-local-store-change';
export const WORKSPACE_BACKUP_EVENT = 'job-radar-local-workspace-change';

export function readStore<T>(key: string, validate: (v: unknown) => T, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return validate(JSON.parse(raw));
  } catch {
    return fallback;
  }
}

export function writeStore(key: string, value: unknown): boolean {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent(LOCAL_STORE_EVENT, { detail: { key } }));
    return true;
  } catch {
    return false;
  }
}

export function subscribeStore(key: string, onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) {
      onChange();
    }
  };
  const onCustom = (event: Event) => {
    const targetKey = (event as CustomEvent<{ key?: string }>)?.detail?.key;
    if (!targetKey || targetKey === key) {
      onChange();
    }
  };
  const onWorkspaceSync = () => onChange();
  window.addEventListener('storage', onStorage);
  window.addEventListener(LOCAL_STORE_EVENT, onCustom);
  window.addEventListener(WORKSPACE_BACKUP_EVENT, onWorkspaceSync);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(LOCAL_STORE_EVENT, onCustom);
    window.removeEventListener(WORKSPACE_BACKUP_EVENT, onWorkspaceSync);
  };
}
