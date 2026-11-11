export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'job-radar-theme-v1';

export function resolveEffectiveTheme(pref: ThemePreference): 'light' | 'dark' {
  if (pref === 'light' || pref === 'dark') return pref;
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

export function readThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system';
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // ignore storage errors
  }
  return 'system';
}

export function applyThemePreference(pref: ThemePreference): 'light' | 'dark' {
  const effective = resolveEffectiveTheme(pref);
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = effective;
    document.documentElement.dataset.themePref = pref;
  }
  return effective;
}

export function writeThemePreference(pref: ThemePreference): 'light' | 'dark' {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, pref);
      window.dispatchEvent(new CustomEvent('job-radar-theme-change', { detail: pref }));
    } catch {
      // ignore storage errors
    }
  }
  return applyThemePreference(pref);
}
