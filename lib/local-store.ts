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
    return true;
  } catch {
    return false;
  }
}

export function subscribeStore(key: string, onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: StorageEvent) => {
    if (event.key === key || event.key === null) {
      onChange();
    }
  };
  window.addEventListener('storage', listener);
  return () => window.removeEventListener('storage', listener);
}
