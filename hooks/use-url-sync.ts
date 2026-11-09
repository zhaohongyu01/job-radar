'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { defaultFilters, selectedWorkCities, validatePersonal } from '@/lib/jobs';
import type { Filters, Job, Personal } from '@/lib/jobs';
import {
  formatUrlQuery,
  parseUrlState,
  restoreBrowsing,
  restoreCardDensity,
} from '@/lib/browsing';
import type { CardDensity, ViewMode } from '@/lib/browsing';
import { personalViewFilters } from '@/lib/workspace';

export const BROWSING_STORAGE = 'job-radar-browsing-v1';
export const CARD_DENSITY_STORAGE = 'job-radar-card-density-v1';
export const STORAGE = 'quancheng-personal-v1';
export const VISIT = 'quancheng-last-visit-v1';
export const PAGE_SIZE_STORAGE = 'job-radar-page-size-v1';
export const PAGE_SIZES = [20, 50, 100];

export interface UseUrlSyncOptions {
  ready: boolean;
  setReady: Dispatch<SetStateAction<boolean>>;
  refresh: () => Promise<void>;
  selectEmployerId: (id: string | null) => void;
  requestedEmployerId: string | null;
  linkedJobId: string | null;
  setLinkedJobId: Dispatch<SetStateAction<string | null>>;
  resetDetailOnPopState: (jobId: string | null) => void;
  setPersonal: Dispatch<SetStateAction<Personal>>;
  onNotice: (message: string) => void;
}

export function useUrlSync({
  ready,
  setReady,
  refresh,
  selectEmployerId,
  requestedEmployerId,
  linkedJobId,
  setLinkedJobId,
  resetDetailOnPopState,
  setPersonal,
  onNotice,
}: UseUrlSyncOptions) {
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [since, setSince] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [cardDensity, setCardDensity] = useState<CardDensity>('standard');
  const [groupCompanies, setGroupCompanies] = useState(false);
  const [now, setNow] = useState(0);

  const discoveryFilters = useRef<Filters>(defaultFilters);
  const preferencesWarning = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [showBackTop, setShowBackTop] = useState(false);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        event.key === '/' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !target.closest('input, textarea, [contenteditable="true"], [role="dialog"]')
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  useEffect(() => {
    const onScroll = () => {
      const scrolled = window.scrollY > 600;
      setShowBackTop((prev) => (prev === scrolled ? prev : scrolled));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Browser storage is read after hydration; SSR has no access to this device state.
  useEffect(() => {
    const initialRead = setTimeout(() => {
      const searchParams = new URLSearchParams(window.location.search);
      if (searchParams.get('workspace') === 'exams' || searchParams.get('mode') === 'exams') {
        window.location.replace('/exams');
        return;
      }
      void refresh();
      setNow(Date.now());
      try {
        const storedSize = Number(localStorage.getItem(PAGE_SIZE_STORAGE));
        if (PAGE_SIZES.includes(storedSize)) setPageSize(storedSize);
        setCardDensity(restoreCardDensity(localStorage.getItem(CARD_DENSITY_STORAGE)));
      } catch {
        // A blocked preference store must not prevent browsing or personal-record loading.
      }
      let restored = restoreBrowsing(null);
      try {
        restored = restoreBrowsing(JSON.parse(localStorage.getItem(BROWSING_STORAGE) || 'null'));
      } catch {
        /* A shared link still works when preferences cannot be read. */
      }
      const urlState = parseUrlState(window.location.search);
      selectEmployerId(urlState.employerId || null);
      setLinkedJobId(urlState.jobId || null);
      setFilters(
        urlState.filters
          ? restoreBrowsing({ filters: urlState.filters }).filters
          : restored.filters,
      );
      if (urlState.page) setPage(urlState.page);
      setViewMode(restored.viewMode);
      setGroupCompanies(restored.groupCompanies);
      try {
        const records = validatePersonal(JSON.parse(localStorage.getItem(STORAGE) || '{}'));
        setPersonal(records);
        const old = localStorage.getItem(VISIT);
        setSince(old && !Number.isNaN(Date.parse(old)) ? old : null);
        localStorage.setItem(VISIT, new Date().toISOString());
      } catch {
        onNotice('本机记录暂时无法读取；你仍可浏览招聘机会。');
      }
      setReady(true);
    }, 0);
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => {
      clearTimeout(initialRead);
      clearInterval(timer);
    };
  }, [refresh, selectEmployerId, setPersonal, setLinkedJobId, setReady, onNotice]);

  useEffect(() => {
    if (!ready || typeof window === 'undefined') return;
    const newQuery = formatUrlQuery(filters, linkedJobId, requestedEmployerId, page);
    const currentSearch = window.location.search;
    if (currentSearch !== newQuery) {
      const newUrl = `${window.location.pathname}${newQuery}${window.location.hash}`;
      window.history.replaceState({ jobId: linkedJobId }, '', newUrl);
    }
  }, [ready, filters, linkedJobId, requestedEmployerId, page]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPopState = () => {
      const urlState = parseUrlState(window.location.search);
      selectEmployerId(urlState.employerId || null);
      resetDetailOnPopState(urlState.jobId || null);
      setFilters(
        urlState.filters
          ? restoreBrowsing({ filters: urlState.filters }).filters
          : { ...defaultFilters },
      );
      setPage(urlState.page || 1);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [selectEmployerId, resetDetailOnPopState]);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(
        BROWSING_STORAGE,
        JSON.stringify({ filters, viewMode, groupCompanies }),
      );
      preferencesWarning.current = false;
    } catch {
      if (!preferencesWarning.current) {
        const timer = setTimeout(() => {
          preferencesWarning.current = true;
          onNotice('筛选已生效，但浏览器不允许保存设置，下次打开将恢复默认条件。');
        }, 0);
        return () => clearTimeout(timer);
      }
    }
  }, [ready, filters, viewMode, groupCompanies, onNotice]);

  const change = useCallback(<K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((f) => {
      if (key === 'city') return { ...f, city: value as string, workCities: undefined };
      if (key === 'workCities') {
        const cities = value as string[];
        return { ...f, workCities: cities, city: cities.length === 1 ? cities[0] : '全部城市' };
      }
      return { ...f, [key]: value };
    });
    setPage(1);
  }, []);

  // The search box updates instantly; the expensive filtering, URL and
  // localStorage writes follow 250 ms after typing pauses (Enter commits now).
  // External changes (presets, reset, history) replace the draft.
  const [queryDraft, setQueryDraft] = useState(filters.query);
  const [queryBase, setQueryBase] = useState(filters.query);
  if (queryBase !== filters.query) {
    setQueryBase(filters.query);
    setQueryDraft(filters.query);
  }
  const queryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const updateQuery = useCallback(
    (value: string, immediate = false) => {
      setQueryDraft(value);
      clearTimeout(queryTimer.current);
      if (immediate) change('query', value);
      else queryTimer.current = setTimeout(() => change('query', value), 250);
    },
    [change],
  );
  useEffect(() => () => clearTimeout(queryTimer.current), []);

  // Reset conditions but keep the user's chosen work cities and current list.
  const resetFilters = useCallback(() => {
    setFilters((f) => ({
      ...defaultFilters,
      city: f.city,
      workCities: f.workCities,
      view: f.view,
    }));
    setPage(1);
  }, []);

  const changeCardDensity = useCallback((next: CardDensity) => {
    setCardDensity(next);
    try {
      localStorage.setItem(CARD_DENSITY_STORAGE, next);
    } catch {
      // Ignore storage write error when blocked
    }
  }, []);

  const openView = useCallback(
    (view: Filters['view']) => {
      if (view === filters.view && view === 'all') return;
      if (filters.view === 'all') discoveryFilters.current = filters;
      setFilters(
        view === 'all' ? { ...discoveryFilters.current, view: 'all' } : personalViewFilters(view),
      );
      setPage(1);
    },
    [filters],
  );

  const handleApplyBrowsing = useCallback(
    (browsing: { filters: Filters; viewMode: ViewMode; groupCompanies: boolean }) => {
      setFilters(browsing.filters);
      setViewMode(browsing.viewMode);
      setGroupCompanies(browsing.groupCompanies);
    },
    [],
  );

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedWorkCities(filters).join('|') !== selectedWorkCities(defaultFilters).join('|')) count++;
    if (filters.employmentType !== defaultFilters.employmentType) count++;
    if (filters.validity !== defaultFilters.validity) count++;
    if (filters.major !== defaultFilters.major) count++;
    if (filters.includeRelatedTalks !== defaultFilters.includeRelatedTalks) count++;
    if (filters.type !== defaultFilters.type) count++;
    if (filters.year !== defaultFilters.year) count++;
    if (filters.sector !== defaultFilters.sector) count++;
    if (filters.direction !== defaultFilters.direction) count++;
    if (filters.education !== defaultFilters.education) count++;
    if (filters.provenance !== defaultFilters.provenance) count++;
    if (filters.kind !== defaultFilters.kind) count++;
    if (filters.locationScope !== defaultFilters.locationScope) count++;
    if (filters.onlyNew !== defaultFilters.onlyNew) count++;
    if (filters.onlyUnread !== defaultFilters.onlyUnread) count++;
    if (filters.includeUncertain !== defaultFilters.includeUncertain) count++;
    if (filters.showExpired !== defaultFilters.showExpired) count++;
    if (filters.salary !== defaultFilters.salary) count++;
    if (filters.reputationMin !== defaultFilters.reputationMin) count++;
    if (filters.includeUnrated !== defaultFilters.includeUnrated) count++;
    if (filters.changeType !== defaultFilters.changeType) count++;
    if (filters.radarFocus !== defaultFilters.radarFocus) count++;
    return count;
  }, [filters]);

  return {
    filters,
    setFilters,
    since,
    page,
    setPage,
    pageSize,
    setPageSize,
    viewMode,
    setViewMode,
    cardDensity,
    changeCardDensity,
    groupCompanies,
    setGroupCompanies,
    now,
    queryDraft,
    updateQuery,
    change,
    resetFilters,
    openView,
    handleApplyBrowsing,
    activeFilterCount,
    searchRef,
    showBackTop,
  };
}

export function useVisibleOpportunitiesTool(filtered: Job[]): void {
  useEffect(() => {
    const context = (
      document as unknown as {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => Promise<void> | void;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const controller = new AbortController();
    Promise.resolve(
      context.registerTool(
        {
          name: 'list_visible_opportunities',
          description: '读取当前筛选结果及原始公告地址；不会提交申请。',
          inputSchema: {
            type: 'object',
            properties: {},
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute: (input: unknown) => {
            if (!input || typeof input !== 'object' || Object.keys(input).length) {
              throw Error('Expected an empty object');
            }
            return {
              count: filtered.length,
              jobs: filtered.slice(0, 50).map((j) => ({
                id: j.id,
                title: j.title,
                url: j.source_url,
                application_url: j.application_url,
              })),
            };
          },
        },
        { signal: controller.signal },
      ),
    ).catch(() => {});
    return () => controller.abort();
  }, [filtered]);
}
