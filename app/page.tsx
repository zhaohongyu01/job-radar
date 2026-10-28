'use client';
import { loadSnapshotParts, loadIndexSnapshot } from '../lib/snapshot-loader';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Radar,
  Search,
  SlidersHorizontal,
  Clock3,
  ExternalLink,
  X,
  RefreshCw,
  Bell,
  Database,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info,
} from 'lucide-react';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Empty, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from '@/components/ui/pagination';
import {
  defaultFilters,
  filterJobs,
  validatePersonal,
  externalUrl,
  personalFor,
  isUnread,
  locationSummary,
  mergeDuplicateOpportunities,
  selectedWorkCities,
  workCitiesLabel,
  formatCompanyDisplay,
  resolveJobId,
} from '@/lib/jobs';
import type { Job, Snapshot, Personal, Filters, PersonalRecord } from '@/lib/jobs';
import { restoreBrowsing, parseUrlState, formatUrlQuery } from '@/lib/browsing';
import type { ViewMode } from '@/lib/browsing';
import { JobTable } from '@/components/job-table';
import { groupJobs } from '@/lib/grouping';
import type { JobGroup } from '@/lib/grouping';
import { FilterSidebar } from '@/components/filter-sidebar';
import { JobCard, formatDate as date, OutLink, extractSalary } from '@/components/job-card';
import { DetailDrawer } from '@/components/detail-drawer';
import { PersonalRadar } from '@/components/personal-radar';
import { DataHealth } from '@/components/data-health';
import { ActionRail } from '@/components/action-rail';
import { TopActionCard } from '@/components/top-action-card';
import { personalViewFilters, buildActionQueue } from '@/lib/workspace';
import type { CoverageReport } from '@/lib/city-coverage';
import { createBackup, validateBackup, writeBackup } from '@/lib/personal-backup';
import type { PersonalBackup } from '@/lib/personal-backup';
import { personalConflicts, mergePersonalRecords } from '@/lib/personal-records';
import { EVENT_PERSONAL_STORAGE, validateEventPersonal } from '@/lib/agenda';

const BROWSING_STORAGE = 'job-radar-browsing-v1';
const STORAGE = 'quancheng-personal-v1',
  VISIT = 'quancheng-last-visit-v1';
const PAGE_SIZE_STORAGE = 'job-radar-page-size-v1';
const PAGE_SIZES = [20, 50, 100];

function ResultsPagination({
  page, pageSize, total, position, onPageChange, onPageSizeChange, grouped = false,
}: {
  page: number;
  pageSize: number;
  total: number;
  grouped?: boolean;
  position: 'top' | 'bottom';
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const unit = grouped ? '组' : '条';
  return (
    <div className="pager">
      <div className="pager-size">
        <span id={`page-size-label-${position}`}>每页显示</span>
        <Select value={String(pageSize)} onValueChange={(value) => {
          const size = Number(value);
          if (PAGE_SIZES.includes(size)) onPageSizeChange(size);
        }}>
          <SelectTrigger aria-labelledby={`page-size-label-${position}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((size) => <SelectItem key={size} value={String(size)}>{size} {unit}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="pager-range" aria-live="polite">
          {total ? `第 ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} ${unit} / 共 ${total} ${unit}` : `共 0 ${unit}`}
        </span>
      </div>
      {pages > 1 && (
        <Pagination className="pager-nav" aria-label={position === 'top' ? '招聘结果顶部分页' : '招聘结果底部分页'}>
          <PaginationContent>
            <PaginationItem>
              <button className="btn btn-secondary btn-sm" disabled={page === 1} onClick={() => onPageChange(page - 1)}>
                <ChevronLeft size={14} /> 上一页
              </button>
            </PaginationItem>
            <PaginationItem><span className="pager-num">{page} / {pages}</span></PaginationItem>
            <PaginationItem>
              <button className="btn btn-secondary btn-sm" disabled={page === pages} onClick={() => onPageChange(page + 1)}>
                下一页 <ChevronRight size={14} />
              </button>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}

export default function Home() {
  const [data, setData] = useState<Snapshot | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const [previewData, setPreviewData] = useState<Snapshot | null>(null);
  const [linkedJobId, setLinkedJobId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(defaultFilters),
    [personal, setPersonal] = useState<Personal>({}),
    [ready, setReady] = useState(false),
    [since, setSince] = useState<string | null>(null);
  const [selected, setSelected] = useState<Job | null>(null),
    [sourceOpen, setSourceOpen] = useState(false),
    [mobileFilterOpen, setMobileFilterOpen] = useState(false),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(50),
    [viewMode, setViewMode] = useState<ViewMode>('cards'),
    [groupCompanies, setGroupCompanies] = useState(false),
    [notice, setNotice] = useState(''),
    [now, setNow] = useState(0);
  const [detailLoading, setDetailLoading] = useState(false),
    [detailError, setDetailError] = useState('');
  const [dataOrigin, setDataOrigin] = useState('site');
  const [importPreview, setImportPreview] = useState<PersonalBackup | null>(null);
  const [presetRevision, setPresetRevision] = useState(0);
  const [coverageReport, setCoverageReport] = useState<CoverageReport | null>(null);
  const coverage = coverageReport?.as_of === data?.generated_at ? coverageReport : null;
  useEffect(() => {
    const url = data?.coverage_url;
    if (!url || !/^\/job-assets\/coverage-[0-9a-f]{20}\.json$/.test(url)) return;
    const controller = new AbortController();
    void fetch(url, { cache: 'force-cache', signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw Error('Coverage unavailable');
      const report = await response.json() as CoverageReport;
      if (report.schema_version !== 1 || !report.cities || !Array.isArray(report.schools)) throw Error('Coverage format invalid');
      setCoverageReport(report);
    }).catch(() => { /* Coverage failures do not hide a complete jobs index. */ });
    return () => controller.abort();
  }, [data?.coverage_url]);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const discoveryFilters = useRef<Filters>(defaultFilters);
  const resultsTopRef = useRef<HTMLDivElement>(null);
  const personalRef = useRef<Personal>({});
  const preferencesWarning = useRef(false);
  const detailCache = useRef<Record<string, Job>>({});
  const detailRequest = useRef(0);
  const detailsPromise = useRef<Record<string, Promise<Record<string, Job>>>>({});
  const [searchIndex, setSearchIndex] = useState<Record<string, string> | null>(null);
  const [searchError, setSearchError] = useState('');
  const [progressiveProgress, setProgressiveProgress] = useState<{ loaded: number; total: number } | null>(null);
  const dataRef = useRef<Snapshot | null>(null);
  const activeSnapshot = useRef<Snapshot | null>(null);
  const refreshController = useRef<AbortController | null>(null);
  const refreshRequest = useRef(0);
  const missingLink = useRef<string | null>(null);

  const activateSnapshot = useCallback((snapshot: Snapshot | null) => {
    activeSnapshot.current = snapshot;
    detailCache.current = {};
    detailsPromise.current = {};
    ++detailRequest.current;
    setSelected(null);
    setDetailLoading(false);
    setDetailError('');
    setSearchIndex(null);
    setSearchError('');
  }, []);

  const refresh = useCallback(async () => {
    const request = ++refreshRequest.current;
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    const current = () => request === refreshRequest.current && !controller.signal.aborted;
    let previewActivated = false;
    setLoading(true);
    setError('');
    setProgressiveProgress(null);
    setPreviewData(null);
    if (!dataRef.current) activateSnapshot(null);
    try {
      const r = await fetch('/jobs.json', { cache: 'no-store', signal: controller.signal });
      if (!r.ok) throw Error('招聘信息暂时无法读取，请稍后重试。');
      const origin = r.headers.get('x-job-radar-data-origin') || (['localhost', '127.0.0.1'].includes(window.location.hostname) ? 'local' : 'site');
      const json = (await r.json()) as Snapshot;
      if (
        !json ||
        ![1, 2, 3].includes(json.schema_version) ||
        !Array.isArray(json.jobs) ||
        !Array.isArray(json.sources)
      )
        throw Error('招聘数据格式异常。');
      if (json.index_shards?.length || json.browse_index?.version === 1) {
        json.jobs = await loadIndexSnapshot(json, controller.signal, (jobs, total) => {
          if (!current()) return;
          setProgressiveProgress({ loaded: jobs.length, total });
          if (!dataRef.current) {
            if (!previewActivated) {
              activateSnapshot(json);
              previewActivated = true;
            }
            setPreviewData({ ...json, jobs });
          }
        });
      }
      if (!current()) return;
      if (new Set(json.jobs.map((job) => job.id)).size !== json.jobs.length) throw Error('招聘数据包含重复记录。');
      if (!previewActivated) activateSnapshot(json);
      // A cold preview and its completed index share one detail-request generation.
      dataRef.current = json;
      setDataOrigin(origin);
      setData(json);
      setPreviewData(null);
    } catch (e) {
      if (!current()) return;
      setPreviewData(null);
      if (previewActivated) activateSnapshot(null);
      setError(e instanceof Error ? e.message : '读取失败');
    } finally {
      if (current()) {
        setProgressiveProgress(null);
        setLoading(false);
        refreshController.current = null;
      }
    }
  }, [activateSnapshot]);

  const save = useCallback((next: Personal) => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(next));
      personalRef.current = next;
      setPersonal(next);
      return true;
    } catch {
      setNotice('保存失败，浏览器存储不可用或已满。请先导出记录。');
      return false;
    }
  }, []);

  const setRead = useCallback((job: Job, read: boolean) => {
    const current = personalRef.current;
    save({ ...current, [job.id]: { ...personalFor(job, current), readAt: read ? new Date().toISOString() : null } });
  }, [save]);

  const markRead = useCallback((job: Job) => {
    if (isUnread(job, personalRef.current)) setRead(job, true);
  }, [setRead]);

  const openDetail = useCallback(
    async (job: Job, linkId = job.id) => {
      setLinkedJobId(linkId);
      missingLink.current = null;
      const request = ++detailRequest.current;
      setDetailError('');
      setDetailLoading(false);
      const cached = detailCache.current[job.id];
      setSelected(
        cached ? { ...cached, talk_events: job.talk_events ?? cached.talk_events } : {
          ...job,
          body: job.body || '正在读取完整公告…',
          emails: job.emails ?? [],
          attachments: job.attachments ?? [],
          links: job.links ?? [],
        },
      );
      if (cached) { markRead(cached); return; }
      if (job.body) { markRead(job); return; }
      const snapshot = activeSnapshot.current;
      const url = snapshot?.detail_shards?.[job.id.slice(0, 2)] ?? snapshot?.details_url;
      if (!url) { setDetailError('这条公告的详情暂未生成，请打开原公告核对。'); return; }
      const pending = detailsPromise.current;
      setDetailLoading(true);
      try {
        if (!pending[url]) {
          pending[url] = fetch(url, { cache: snapshot?.detail_shards ? 'force-cache' : 'no-store' }).then(
            async (response) => {
              if (!response.ok) throw Error('完整公告暂时无法读取。');
              const payload = (await response.json()) as {
                schema_version?: number;
                jobs?: Record<string, Job>;
              };
              if (
                payload.schema_version !== 1 ||
                !payload.jobs ||
                typeof payload.jobs !== 'object'
              )
                throw Error('完整公告数据格式异常。');
              return payload.jobs;
            },
          );
        }
        const records = await pending[url];
        const full = records[job.id];
        if (!full) throw Error('这条公告的详情暂未生成，请打开原公告核对。');
        if (request === detailRequest.current) {
          detailCache.current = { ...detailCache.current, ...records };
          setSelected({ ...full, talk_events: job.talk_events ?? full.talk_events });
          markRead(full);
        }
      } catch (e) {
        delete pending[url];
        if (request === detailRequest.current) {
          setSelected(job);
          setDetailError(e instanceof Error ? e.message : '完整公告读取失败。');
        }
      } finally {
        if (request === detailRequest.current) setDetailLoading(false);
      }
    },
    [markRead],
  );

  // Browser storage is read after hydration; SSR has no access to this device state.
  useEffect(() => {
    const initialRead = setTimeout(() => {
      void refresh();
      setNow(Date.now());
      try {
        const storedSize = Number(localStorage.getItem(PAGE_SIZE_STORAGE));
        if (PAGE_SIZES.includes(storedSize)) setPageSize(storedSize);
      } catch {
        // A blocked preference store must not prevent browsing or personal-record loading.
      }
      let restored = restoreBrowsing(null);
      try { restored = restoreBrowsing(JSON.parse(localStorage.getItem(BROWSING_STORAGE) || 'null')); }
      catch { /* A shared link still works when preferences cannot be read. */ }
      const urlState = parseUrlState(window.location.search);
      setLinkedJobId(urlState.jobId || null);
      setFilters(urlState.filters ? restoreBrowsing({ filters: urlState.filters }).filters : restored.filters);
      setViewMode(restored.viewMode);
      setGroupCompanies(restored.groupCompanies);
      try {
        const records = validatePersonal(JSON.parse(localStorage.getItem(STORAGE) || '{}'));
        personalRef.current = records;
        setPersonal(records);
        const old = localStorage.getItem(VISIT);
        setSince(old && !Number.isNaN(Date.parse(old)) ? old : null);
        localStorage.setItem(VISIT, new Date().toISOString());
      } catch {
        setNotice('本机记录暂时无法读取；你仍可浏览招聘机会。');
      }
      setReady(true);
    }, 0);
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => {
      clearTimeout(initialRead);
      clearInterval(timer);
      refreshController.current?.abort();
    };
  }, [refresh]);

  useEffect(() => {
    if (!ready || !linkedJobId) return;
    const snapshot = data || previewData;
    const found = snapshot && resolveJobId(snapshot.jobs, linkedJobId);
    if (found && selected?.id !== found.id) {
      const timer = setTimeout(() => void openDetail(found, linkedJobId), 0);
      return () => clearTimeout(timer);
    }
    else if (!found && data && !loading && missingLink.current !== linkedJobId) {
      const timer = setTimeout(() => {
        missingLink.current = linkedJobId;
        setNotice('这条链接对应的机会暂不在当前索引中，请查看原公告或稍后刷新；链接已保留。');
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [ready, linkedJobId, data, previewData, selected?.id, loading, openDetail]);

  useEffect(() => {
    if (!ready || typeof window === 'undefined') return;
    const newQuery = formatUrlQuery(filters, linkedJobId);
    const currentSearch = window.location.search;
    if (currentSearch !== newQuery) {
      const newUrl = `${window.location.pathname}${newQuery}${window.location.hash}`;
      window.history.replaceState({ jobId: linkedJobId }, '', newUrl);
    }
  }, [ready, filters, linkedJobId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPopState = () => {
      const urlState = parseUrlState(window.location.search);
      ++detailRequest.current;
      setSelected(null);
      setDetailLoading(false);
      setLinkedJobId(urlState.jobId || null);
      setFilters(urlState.filters ? restoreBrowsing({ filters: urlState.filters }).filters : { ...defaultFilters });
      setPage(1);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(BROWSING_STORAGE, JSON.stringify({ filters, viewMode, groupCompanies }));
      preferencesWarning.current = false;
    } catch {
      if (!preferencesWarning.current) {
        const timer = setTimeout(() => {
          preferencesWarning.current = true;
          setNotice('筛选已生效，但浏览器不允许保存设置，下次打开将恢复默认条件。');
        }, 0);
        return () => clearTimeout(timer);
      }
    }
  }, [ready, filters, viewMode, groupCompanies]);

  const change = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((f) => {
      if (key === 'city') return { ...f, city: value as string, workCities: undefined };
      if (key === 'workCities') {
        const cities = value as string[];
        return { ...f, workCities: cities, city: cities.length === 1 ? cities[0] : '全部城市' };
      }
      return { ...f, [key]: value };
    });
    setPage(1);
  };

  const resetFilters = useCallback(() => {
    setFilters(defaultFilters);
    setPage(1);
  }, []);

  const toggle = (job: Job, key: 'saved' | 'applied' | 'hidden') => {
    const old = personalFor(job, personalRef.current);
    const record: PersonalRecord = { ...old, [key]: !old[key], personal_updated_at: new Date().toISOString() };
    if (key === 'applied') {
      record.application_stage = record.applied ? 'applied' : 'planned';
      record.applied_at = record.applied ? old.applied_at || new Date().toISOString() : null;
    }
    const next = {
      ...personalRef.current,
      [job.id]: record,
    };
    save(next);
  };

  const openView = (view: Filters['view']) => {
    if (view === filters.view) return;
    if (filters.view === 'all') discoveryFilters.current = filters;
    setFilters(view === 'all' ? { ...discoveryFilters.current, view: 'all' } : personalViewFilters(view));
    setPage(1);
  };

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey &&
        !target.closest('input, textarea, [contenteditable="true"], [role="dialog"]')) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  const allJobs = useMemo(() => mergeDuplicateOpportunities(data?.jobs ?? []), [data]);
  const previewJobs = useMemo(() => !data && filters.view === 'all' && !(filters.query.trim() && previewData?.search_url)
    ? filterJobs(mergeDuplicateOpportunities(previewData?.jobs || []), filters, personal, since, now).slice(0, 10) : [],
    [data, previewData, filters, personal, since, now]);
  const savedCount = allJobs.filter((job) => personalFor(job, personal).saved).length;
  const appliedCount = allJobs.filter((job) => personalFor(job, personal).applied).length;

  const needsSearch = !!filters.query.trim() && !!data?.search_url;
  useEffect(() => {
    if (!needsSearch || !data?.search_url || searchIndex) return;
    const controller = new AbortController();
    const paths = data.browse_index?.version === 1 ? data.browse_index.search_shards : [data.search_url, ...(data.search_shards ?? [])];
    loadSnapshotParts<{ jobs: Record<string, string> }>(paths, 'search', controller.signal)
      .then((parts) => {
        if (parts.some((part) => !part.jobs || Array.isArray(part.jobs) || typeof part.jobs !== 'object'))
          throw Error('全文索引格式异常。');
        const jobs = Object.assign({}, ...parts.map((part) => part.jobs)) as Record<string, string>;
        if (data.jobs.some((j) => typeof jobs[j.id] !== 'string'))
          throw Error('全文索引不完整，请点击刷新重试。');
        if (!controller.signal.aborted && data === dataRef.current) setSearchIndex(jobs);
      }).catch((e) => { if (!controller.signal.aborted && data === dataRef.current) setSearchError(e.message); });
    return () => controller.abort();
  }, [needsSearch, data, searchIndex]);

  const searchPending = needsSearch && !searchIndex;
  const searchableJobs = useMemo(() => {
    if (searchPending) return [];
    const base = allJobs;
    return base.map((j) => (needsSearch ? { ...j, search_text: searchIndex?.[j.id] ?? '' } : j));
  }, [allJobs, needsSearch, searchIndex, searchPending]);

  const filtered = useMemo(
    () => filterJobs(searchableJobs, filters, personal, since, now),
    [searchableJobs, filters, personal, since, now],
  );

  const radarScopeJobs = useMemo(
    () =>
      filters.radarFocus === 'none'
        ? filtered
        : filterJobs(searchableJobs, { ...filters, radarFocus: 'none' }, personal, since, now),
    [searchableJobs, filters, personal, since, now, filtered],
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
    if (filters.sort !== defaultFilters.sort) count++;
    if (filters.changeType !== defaultFilters.changeType) count++;
    if (filters.radarFocus !== defaultFilters.radarFocus) count++;
    return count;
  }, [filters]);

  const locationOptions = (['exact', 'possible', 'unknown'] as const).map(
    (scope) => ({
      scope,
      label:
        scope === 'exact'
          ? `来源标注${workCitiesLabel(filters)}`
          : scope === 'possible'
            ? '全省 / 全国待核实'
            : '地点未明确',
      count: filterJobs(
        searchableJobs,
        { ...filters, locationScope: scope },
        personal,
        since,
        now,
      ).length,
    }),
  );

  const groups = useMemo(() => groupJobs(filtered, groupCompanies), [filtered, groupCompanies]);
  const pages = Math.max(1, Math.ceil(groups.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visibleGroups = groups.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Consecutive single records share one table header; grouped campaigns expand independently.
  const displayBlocks = visibleGroups.reduce<(JobGroup & { grouped: boolean })[]>((blocks, group) => {
    const previous = blocks.at(-1);
    if (viewMode === 'table' && group.jobs.length === 1 && previous && !previous.grouped)
      previous.jobs.push(...group.jobs);
    else blocks.push({ ...group, jobs: [...group.jobs], grouped: group.jobs.length > 1 });
    return blocks;
  }, []);

  const returnToResults = () => {
    resultsTopRef.current?.focus({ preventScroll: true });
    resultsTopRef.current?.scrollIntoView({ block: 'start' });
  };

  const changePage = (next: number) => {
    setPage(Math.max(1, Math.min(next, pages)));
    returnToResults();
  };

  const changePageSize = (next: number) => {
    if (!PAGE_SIZES.includes(next) || next === pageSize) return;
    setPage(Math.floor(((currentPage - 1) * pageSize) / next) + 1);
    setPageSize(next);
    try {
      localStorage.setItem(PAGE_SIZE_STORAGE, String(next));
    } catch {
      setNotice('每页条数已切换；浏览器未允许保存设置，下次打开会恢复默认值。');
    }
    returnToResults();
  };

  const newCount = (data?.jobs ?? []).filter(
    (j) =>
      since &&
      (Date.parse(j.first_seen_at) > Date.parse(since) ||
        Date.parse(j.updated_at) > Date.parse(since)),
  ).length;

  const dueCount = buildActionQueue(allJobs, personal, now).filter(
    (job) => job.deadline && Date.parse(job.deadline) - now < 7 * 86400000,
  ).length;

  const years = [
    '全部',
    ...Array.from(
      new Set([
        '2027',
        ...(data?.jobs ?? []).flatMap((j) => j.graduation_years),
      ]),
    )
      .filter((y) => y >= '2024' && y <= '2030')
      .sort()
      .reverse(),
  ];

  const stale =
    !!data?.last_success_at &&
    now - Date.parse(data.last_success_at) > 36 * 3600000;

  const exportPersonal = () => {
    try {
    const content = JSON.stringify(createBackup(personal, localStorage), null, 2);
    if (new TextEncoder().encode(content).length > 5000000) throw Error('备份超过当前 5 MB 导入上限，请先减少不需要的备注或记录后导出；未截断任何数据。');
    const blob = new Blob(
      [content],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '职讯雷达-个人记录.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('个人记录已导出。');
    } catch (error) { setNotice(error instanceof Error ? error.message : '导出失败'); }
  };

  const importPersonal = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 5000000) throw Error('备份文件不能超过 5 MB');
      const backup = JSON.parse(await file.text());
      setImportPreview(validateBackup(backup));
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '无法读取备份文件');
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const confirmImport = (preferImported: boolean) => {
    if (!importPreview) return;
    try {
      const records = mergePersonalRecords(personalRef.current, importPreview.records, preferImported);
      const currentEvents = validateEventPersonal(JSON.parse(localStorage.getItem(EVENT_PERSONAL_STORAGE) || '{}'));
      const events = { ...currentEvents };
      for (const [id, record] of Object.entries(importPreview.event_records || {})) {
        const old = events[id];
        if (!old || (old.updated_at && record.updated_at ? old.updated_at <= record.updated_at : preferImported)) events[id] = record;
      }
      const validated = validateBackup({ ...importPreview, records, event_records: events });
      writeBackup(validated, localStorage);
      personalRef.current = records; setPersonal(records);
      if (validated.browsing) { setFilters(validated.browsing.filters); setViewMode(validated.browsing.viewMode); setGroupCompanies(validated.browsing.groupCompanies); }
      window.dispatchEvent(new Event('job-radar-local-workspace-change'));
      setPresetRevision((value) => value + 1);
      setImportPreview(null); setNotice('备份已合并；个人记录、活动及设置已保存。');
    } catch (error) { setNotice(error instanceof Error ? error.message : '导入未完成'); }
  };

  const copyJob = (job: Job) => {
    const { cleanTitle, salary } = extractSalary(job);
    const salaryText = salary ? ` (${salary})` : '';
    const comp = formatCompanyDisplay(job.company, job.title, job.source_id).displayCompany;
    const companyText = comp && comp !== '企业名称待核实' ? `\n【企业】${comp}` : '';
    const loc = locationSummary(job);
    const locText = loc ? `\n【地点】${loc}` : '';
    const deadlineText = job.deadline ? `\n【截止】${date(job.deadline, true)}` : '';
    const url = externalUrl(job.application_url || job.source_url) || '';
    const urlText = url ? `\n【来源】${url}` : '';
    const shareUrl = typeof window !== 'undefined'
      ? `${window.location.origin}${window.location.pathname}?job=${job.id}`
      : '';
    const shareText = shareUrl ? `\n【直达链接】${shareUrl}` : '';
    const content = `【岗位】${cleanTitle}${salaryText}${companyText}${locText}${deadlineText}${urlText}${shareText}\n—— 来自职讯雷达`;
    navigator.clipboard.writeText(content).then(() => {
      setNotice(`已复制「${cleanTitle}」的招聘信息与直达链接，可直接粘贴分享！`);
    }).catch(() => {
      setNotice('复制失败，请手动选择复制。');
    });
  };

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
            if (
              !input ||
              typeof input !== 'object' ||
              Object.keys(input).length
            )
              throw Error('Expected an empty object');
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

  return (
    <>
      <a className="skip-to-results" href="#opportunities">跳到招聘结果</a>
      <input type="file" accept="application/json,.json" ref={fileRef} hidden onChange={(e) => void importPersonal(e.target.files?.[0])} />
      <header className="app-bar">
        <div className="app-bar-inner">
          <div className="brand-mark">
            <Radar size={26} />
            <div className="brand-text">
              <strong>职讯雷达</strong>
              <small>求职工作台</small>
            </div>
          </div>
          <nav className="app-nav" aria-label="工作台导航">
            <button className="app-nav-item" aria-current={filters.view === 'all' ? 'page' : undefined} onClick={() => openView('all')}>
              发现机会
            </button>
            <button className="app-nav-item" aria-current={filters.view === 'saved' ? 'page' : undefined} onClick={() => openView('saved')}>
              我的收藏 <span className="app-nav-count">{data ? savedCount : '—'}</span>
            </button>
            <button className="app-nav-item" aria-current={filters.view === 'applied' ? 'page' : undefined} onClick={() => openView('applied')}>
              投递记录 <span className="app-nav-count">{data ? appliedCount : '—'}</span>
            </button>
          </nav>
          <div className="app-bar-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setSourceOpen(true)}>
              <Database size={15} />
              <span>信息来源</span>
            </button>
          </div>
        </div>
      </header>

      <main className="page">
        <div className="page-head">
          <div className="page-head-intro">
            <p className="page-eyebrow">
              {workCitiesLabel(filters)} · {filters.type}
              {filters.type === '校招' && filters.year !== '全部' ? ` · ${filters.year}届` : ''}
            </p>
            <h1 className="page-title">
              {filters.view === 'all' ? '发现机会' : filters.view === 'saved' ? '我的收藏' : '投递记录'}
            </h1>
            <p className="page-lede">
              {filters.view === 'all'
                ? '聚合高校就业网、政务直聘与官方公告，追踪网申截止时间与宣讲日程。'
                : filters.view === 'saved'
                  ? '已收藏的机会按截止时间排列，便于优先投递即将截止的岗位。'
                  : '记录已投递的岗位，本地保存，随时跟踪。'}
            </p>
          </div>

          <div className="page-head-aside">
            <TopActionCard
              jobs={allJobs}
              personal={personal}
              now={now}
              ready={ready && !!data}
              activeView={filters.view}
              onDetail={(job) => void openDetail(job)}
              onView={openView}
            />

            <div className={`freshness ${!data?.last_success_at || stale ? 'is-stale' : ''}`}>
              <span className="freshness-dot" />
              <span>{loading && !data ? '正在读取…' : `最近采集 ${date(data?.last_success_at, true)}`}</span>
              {data && !data.schedule_enabled && <span className="text-muted">（未启用定时）</span>}
              <button
                className="icon-btn"
                onClick={() => void refresh()}
                disabled={loading}
                aria-label="重新读取招聘数据"
                title="重新读取招聘数据"
              >
                <RefreshCw size={14} className={loading ? 'spinning' : ''} />
              </button>
            </div>
          </div>
        </div>

        {notice && (
          <output className="toast">
            <span>{notice}</span>
            <button aria-label="关闭提示" onClick={() => setNotice('')}>
              <X size={15} />
            </button>
          </output>
        )}

        {error && (
          <div className="inline-alert is-danger" role="alert">
            <span>{error} {data ? '（已保留上次完整结果）' : '（未完成的预览已撤下，请重试）'}</span>
            <button className="btn btn-secondary btn-sm" onClick={() => void refresh()}>
              重试
            </button>
          </div>
        )}

        {data && stale && (
          <div className="inline-alert is-warn">
            <Clock3 size={16} />
            <span>信息已超过 36 小时未更新，请在原公告核对是否仍可报名。</span>
          </div>
        )}

        {data && now > 0 && <DataHealth coverage={coverage} data={data} now={now} city={filters.city} visibleJobs={filtered} origin={dataOrigin} onSources={() => setSourceOpen(true)} />}

        <div className="page-grid">
          <FilterSidebar
            className="filters-desktop"
            filters={filters}
            data={data}
            years={years}
            ready={ready}
            onChange={change}
            onReset={resetFilters}
            onExport={exportPersonal}
            onImport={() => fileRef.current?.click()}
          />

          <section className="results-col" id="opportunities" aria-label="招聘机会">
            <details className="plan-mobile">
              <summary>
                <span>我的安排<small>待投递 · 宣讲日程</small></span>
                <ChevronDown size={16} />
              </summary>
              <ActionRail indexReady={!!data} coverage={coverage} jobs={allJobs} personal={personal} city={filters.city} now={now} ready={ready && !!data} onDetail={(job) => void openDetail(job)} onView={openView} />
            </details>

            <div className="search-row">
              <div className="search-field">
                <Search size={18} />
                <input
                  ref={searchRef}
                  aria-label="搜索岗位、企业或专业"
                  placeholder="搜索企业、岗位、专业，找到你的下一站"
                  value={filters.query}
                  onChange={(e) => change('query', e.target.value)}
                />
                {!filters.query && <kbd className="kbd">/</kbd>}
                {filters.query && (
                  <button
                    className="icon-btn"
                    aria-label="清空搜索"
                    onClick={() => change('query', '')}
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
              <button
                type="button"
                className="btn btn-secondary filters-trigger"
                onClick={() => setMobileFilterOpen(true)}
                aria-label="打开筛选面板"
              >
                <SlidersHorizontal size={16} />
                <span>筛选</span>
                {activeFilterCount > 0 && (
                  <span className="filters-trigger-badge">{activeFilterCount}</span>
                )}
              </button>
            </div>

            <div className="search-hints">
              <span>试着搜</span>
              {['财务', '软件工程师', '管培生', '不限专业'].map((term) => (
                <button key={term} type="button" onClick={() => change('query', term)}>{term}</button>
              ))}
              <span className="hint-tail">支持企业、岗位、专业全文搜索</span>
            </div>

            {data && <PersonalRadar
              key={presetRevision}
              now={now}
              currentFilters={filters}
              filteredJobs={radarScopeJobs}
              activeFocus={filters.radarFocus}
              onApplyPreset={(presetFilters) => {
                setFilters(restoreBrowsing({ filters: { ...defaultFilters, ...presetFilters, view: 'all', radarFocus: 'none' } }).filters);
                setPage(1);
              }}
              onQuickFocus={(focus) => {
                if (filters.radarFocus === focus) {
                  setFilters((prev) => ({ ...prev, radarFocus: 'none' }));
                  setNotice('已取消聚焦，恢复全部机会列表');
                } else {
                  setFilters((prev) => ({ ...prev, radarFocus: focus }));
                  const focusLabels: Record<string, string> = {
                    today: '今日新发',
                    supplement: '新开补录',
                    urgent: '3天内截止',
                    change: '近期变更',
                  };
                  setNotice(`已聚焦「${focusLabels[focus]}」机会，再次点击标签可恢复全部`);
                }
                setPage(1);
              }}
            />}

            {filters.view !== 'all' && (
              <p className="note-line">
                <Info size={15} />
                <span>个人列表默认不限城市，并保留已截止记录；返回「发现机会」会恢复之前的筛选。投递后请手动标记状态。</span>
              </p>
            )}

            <div className="result-bar">
              <div className="result-bar-left">
                <div className="result-count" aria-live="polite">
                  {!data ? (
                    <output className={loading ? 'progressive-pill' : undefined}>
                      {loading ? progressiveProgress ? `已加载 ${progressiveProgress.loaded.toLocaleString()} / ${progressiveProgress.total.toLocaleString()} 条，完整结果仍在加载` : '正在加载完整索引…' : '索引未完成，请重试加载'}
                    </output>
                  ) : searchPending ? (
                    <output>{searchError || '正在读取全文索引，完成后显示搜索结果…'}</output>
                  ) : (
                    <>
                      <div className="result-count-main">
                        <span className="result-count-num">{filtered.length}</span>
                        <span className="result-count-unit">条机会</span>
                        {progressiveProgress && (
                          <span className="progressive-pill" title="更新完成前保留上次完整结果">
                            正在更新 {progressiveProgress.loaded.toLocaleString()} / {progressiveProgress.total.toLocaleString()} 条
                          </span>
                        )}
                      </div>
                      <span>（{filtered.filter((j) => j.kind === '具体岗位').length} 岗位 / {filtered.filter((j) => j.kind !== '具体岗位').length} 公告{groupCompanies ? ` · ${groups.length} 组` : ''}）</span>
                      {filters.type === '校招' && filters.year !== '全部' && (
                        <span>
                          明确{filters.year}届 <strong>{filtered.filter((j) => j.graduation_years.includes(filters.year)).length}</strong> 条
                          {filters.includeUncertain && (
                            <span className="text-muted">
                              （{filtered.filter((j) => j.graduation_years.length === 0).length} 未明确）
                            </span>
                          )}
                        </span>
                      )}
                      {filters.salary !== '全部' && (
                        <span className="chip chip-brand">薪资 {filters.salary}</span>
                      )}
                      {filters.radarFocus !== 'none' && (
                        <span className="focus-chip">
                          <span>
                            {filters.radarFocus === 'today' && '今日新发'}
                            {filters.radarFocus === 'supplement' && '新开补录'}
                            {filters.radarFocus === 'urgent' && '3天内截止'}
                            {filters.radarFocus === 'change' && '近期变更'}
                          </span>
                          <button
                            type="button"
                            onClick={() => change('radarFocus', 'none')}
                            title="点击取消聚焦，查看全部"
                            aria-label="取消聚焦"
                          >
                            <X size={12} />
                          </button>
                        </span>
                      )}
                    </>
                  )}
                </div>

                <div className="result-toggles">
                  <button
                    type="button"
                    className="toggle-chip toggle-chip-sm"
                    aria-pressed={filters.onlyUnread}
                    onClick={() => change('onlyUnread', !filters.onlyUnread)}
                  >
                    只看未读
                  </button>
                  <button
                    type="button"
                    className="toggle-chip toggle-chip-sm"
                    aria-pressed={filters.onlyNew}
                    onClick={() => change('onlyNew', !filters.onlyNew)}
                  >
                    新收录 / 变更
                  </button>
                  <button
                    type="button"
                    className="toggle-chip toggle-chip-sm"
                    aria-pressed={groupCompanies}
                    onClick={() => { setGroupCompanies(!groupCompanies); setPage(1); }}
                  >
                    合并同企业
                  </button>
                  <button
                    type="button"
                    className="toggle-chip toggle-chip-sm"
                    aria-pressed={filters.view === 'hidden'}
                    onClick={() => openView(filters.view === 'hidden' ? 'all' : 'hidden')}
                  >
                    {filters.view === 'hidden' ? '返回全部机会' : '不感兴趣'}
                  </button>
                </div>
              </div>

              <div className="result-tools">
                <Select value={filters.sort} onValueChange={(v) => change('sort', v as Filters['sort'])}>
                  <SelectTrigger className="sort-trigger" aria-label="排序方式">
                    <SelectValue>{filters.sort === 'deadline_asc' ? '即将截止优先' : filters.sort === 'salary_desc' ? '薪资从高到低' : '最新发布'}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">最新发布</SelectItem>
                    <SelectItem value="deadline_asc">即将截止优先</SelectItem>
                    <SelectItem value="salary_desc">薪资从高到低</SelectItem>
                  </SelectContent>
                </Select>

                <fieldset className="seg" aria-label="招聘信息显示方式">
                  <button
                    type="button"
                    aria-pressed={viewMode === 'cards'}
                    onClick={() => setViewMode('cards')}
                  >
                    卡片
                  </button>
                  <button
                    type="button"
                    aria-pressed={viewMode === 'table'}
                    onClick={() => setViewMode('table')}
                  >
                    表格
                  </button>
                </fieldset>

                {pages > 1 && !searchPending && (
                  <div className="pager-mini">
                    <button
                      className="icon-btn"
                      disabled={currentPage === 1}
                      onClick={() => changePage(currentPage - 1)}
                      aria-label="上一页"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <span>{currentPage} / {pages}</span>
                    <button
                      className="icon-btn"
                      disabled={currentPage === pages}
                      onClick={() => changePage(currentPage + 1)}
                      aria-label="下一页"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="result-subbar">
              {selectedWorkCities(filters).length > 0 ? (
                <div className="scope-bar">
                  <fieldset
                    className="seg"
                    aria-label="工作地点匹配范围"
                  >
                    {locationOptions.map((option) => (
                      <button
                        key={option.scope}
                        type="button"
                        aria-pressed={filters.locationScope === option.scope}
                        onClick={() => change('locationScope', option.scope)}
                      >
                        {option.label}
                        <span className="seg-count">{data ? option.count : '…'}</span>
                      </button>
                    ))}
                  </fieldset>
                </div>
              ) : <div />}

              <div className="filter-chips" aria-label="已选筛选条件">
                <span>当前筛选</span>
                {filters.workCities && filters.workCities.length > 0 ? (
                  filters.workCities.map((c) => (
                    <button
                      key={`workCity-${c}`}
                      className="filter-chip"
                      onClick={() => {
                        const nextCities = (filters.workCities || []).filter((item) => item !== c);
                        const nextCity = nextCities.length === 1 ? nextCities[0] : '全部城市';
                        setFilters({ ...filters, city: nextCity, workCities: nextCities });
                        setPage(1);
                      }}
                      aria-label={`移除城市：${c}`}
                    >
                      {c}
                      <X size={12} />
                    </button>
                  ))
                ) : filters.city !== '全部城市' ? (
                  <button
                    key="city"
                    className="filter-chip"
                    onClick={() => change('city', '全部城市')}
                    aria-label={`移除城市：${filters.city}`}
                  >
                    {filters.city}
                    <X size={12} />
                  </button>
                ) : null}
                {([
                  ['type', filters.type, '全部'],
                  ...(filters.type === '校招' ? [['year', filters.year === '全部' ? '全部' : `${filters.year}届`, '全部']] : []),
                  ['sector', filters.sector, '全部'], ['direction', filters.direction, '全部'],
                  ['salary', filters.salary, '全部'], ['education', filters.education, ''],
                  ['provenance', filters.provenance, '全部'], ['kind', filters.kind, '全部'],
                  ['changeType', filters.changeType, '全部'],
                ] as [keyof Filters, string, string][]).filter(([, value, empty]) => value !== empty).map(([key, value, empty]) => (
                  <button key={key} className="filter-chip" onClick={() => change(key, empty)} aria-label={`移除筛选：${value}`}>
                    {value}
                    <X size={12} />
                  </button>
                ))}
                <button className="text-btn" onClick={resetFilters}>恢复默认</button>
              </div>
            </div>

            {filters.onlyNew && !since && (
              <p className="note-line">
                这是你首次访问，尚无上次查看时间。关闭此筛选可查看全部收录。
              </p>
            )}

            {since && newCount > 0 && (
              <p className="note-line">
                全库有 {newCount}{' '}
                条自上次访问以来首次收录或内容变更；首次收录不代表刚发布。
              </p>
            )}

            {dueCount > 0 && (
              <div className="due-banner">
                <Bell size={16} />
                <span>你收藏的 {dueCount} 条公告将在 7 天内截止。请在原公告核对报名要求。</span>
              </div>
            )}

            {loading && !data ? (
              <div className="opp-list" aria-label="首批预览" aria-busy="true">
                <output className="plan-caption">首批卡片预览；计数、收藏列表和日程会在完整索引就绪后显示。</output>
                {previewJobs.map((job) => <JobCard key={job.id} job={job} filters={filters} personal={personal} ready={ready} now={now} since={since}
                  onDetail={(candidate) => void openDetail(candidate)} onRead={markRead} onReadChange={setRead} onToggle={toggle} onCopy={copyJob} />)}
                {!previewJobs.length && <><div className="opp-skeleton" /><div className="opp-skeleton" /></>}
              </div>
            ) : (
              <>
                <div ref={resultsTopRef} tabIndex={-1} />
                <div className="opp-list">
                  {displayBlocks.map((group) => {
                    const content = viewMode === 'table' ? (
                      <JobTable
                        jobs={group.jobs}
                        city={filters.city}
                        personal={personal}
                        ready={ready}
                        now={now}
                        onDetail={(job) => void openDetail(job)}
                        onRead={markRead}
                        onReadChange={setRead}
                        onToggle={toggle}
                      />
                    ) : (
                      group.jobs.map((job) => (
                        <JobCard
                          key={job.id}
                          job={job}
                          filters={filters}
                          personal={personal}
                          ready={ready}
                          now={now}
                          since={since}
                          onDetail={(j) => void openDetail(j)}
                          onRead={markRead}
                          onReadChange={setRead}
                          onToggle={toggle}
                          onCopy={copyJob}
                        />
                      ))
                    );
                    return group.grouped ? (
                      <details className="opp-group" key={group.id} open>
                        <summary>
                          <div className="opp-group-title">
                            <strong>{group.company}</strong>
                            <span>
                              {group.label} · 最新 {group.jobs[0].published_at || '日期未明确'}
                            </span>
                          </div>
                          <div className="opp-group-count">
                            <span>{group.jobs.length} 条信息</span>
                            <ChevronDown size={14} />
                          </div>
                        </summary>
                        <div className="opp-group-members">{content}</div>
                      </details>
                    ) : (
                      <div key={group.id}>{content}</div>
                    );
                  })}
                  {data && !filtered.length && !loading && !searchPending && !error && (
                    <Empty className="empty-state">
                      <Search size={30} />
                      <EmptyTitle className="text-lg">
                        没有符合当前条件的公告
                      </EmptyTitle>
                      <EmptyDescription>
                        当前来源尚未收录符合这些条件的公告，不代表没有招聘。可切换地点范围，或清除岗位方向、学历和关键词限制。
                      </EmptyDescription>
                      {selectedWorkCities(filters).length > 0 && locationOptions
                        .filter((option) => option.scope !== filters.locationScope && option.count > 0)
                        .map((option) => (
                          <Button key={option.scope} variant="outline"
                            onClick={() => { setFilters({ ...filters, locationScope: option.scope }); setPage(1); }}>
                            另有 {option.count} 条匹配信息：{option.label}，点击查看
                          </Button>
                        ))}
                      <Button
                        variant="outline"
                        onClick={() => {
                          setFilters({
                            ...defaultFilters,
                            city: filters.city,
                            workCities: filters.workCities,
                            includeRelatedTalks: filters.includeRelatedTalks,
                            view: filters.view,
                            locationScope: filters.locationScope,
                            type: '全部',
                            sector: '全部',
                            direction: '全部',
                            education: '',
                            query: '',
                            onlyNew: false,
                            onlyUnread: false,
                            includeUncertain: true,
                            salary: '全部',
                            sort: 'newest',
                          });
                          setPage(1);
                        }}
                      >
                        放宽条件，保留当前城市
                      </Button>
                    </Empty>
                  )}
                </div>
              </>
            )}

            {visibleGroups.length > 0 && !searchPending && (
              <ResultsPagination page={currentPage} pageSize={pageSize} total={groups.length} grouped={groupCompanies} position="bottom" onPageChange={changePage} onPageSizeChange={changePageSize} />
            )}

            <details className="help-fold">
              <summary>
                <Info size={14} />
                <span>筛选与阅读说明</span>
                <ChevronDown size={14} />
              </summary>
              <div className="help-fold-body">
                <p>按来源发布 / 收录时间从新到旧排列，日期不明确的排在最后。查看详情或投递入口后标为已读，内容更新后重新提示未读。表格可左右滑动。</p>
                <p>合并仅折叠同名企业、同届校招的信息，提前批、春招、秋招等明确批次分开展示；所有岗位和来源均保留。每组按最新一条排序，展开后逐条投递或收藏。未明确企业或届别的单独展示。</p>
              </div>
            </details>

            <p className="foot-note">
              {data ? `${data.sources.length} 个来源 ·` : '完整索引尚未就绪 ·'}
              当前按公告聚合，部分公告包含多个岗位。标签由文字提取，未知资格不会当作“不符合”。
              <button
                className="text-btn"
                onClick={() => setSourceOpen(true)}
              >
                查看覆盖与更新状态
                <ExternalLink size={13} />
              </button>
            </p>
          </section>
          <div className="plan-desktop"><ActionRail indexReady={!!data} coverage={coverage} jobs={allJobs} personal={personal} city={filters.city} now={now} ready={ready && !!data} onDetail={(job) => void openDetail(job)} onView={openView} /></div>
        </div>
      </main>


      <Sheet open={mobileFilterOpen} onOpenChange={setMobileFilterOpen}>
        <SheetContent side="left" className="mobile-filter-sheet">
          <SheetHeader className="detail-header">
            <SheetTitle>筛选条件</SheetTitle>
            <SheetDescription>
              调整筛选后立即生效，关闭即可浏览岗位
            </SheetDescription>
          </SheetHeader>
          <div className="mobile-filter-scroll">
            <FilterSidebar
              className="mobile-filter-panel"
              filters={filters}
              data={data}
              years={years}
              ready={ready}
              onChange={change}
              onReset={resetFilters}
              onExport={exportPersonal}
              onImport={() => fileRef.current?.click()}
            />
          </div>
        </SheetContent>
      </Sheet>

      <DetailDrawer
        selected={selected}
        city={filters.city}
        now={now}
        personal={personal}
        ready={ready}
        detailLoading={detailLoading}
        detailError={detailError}
        onClose={() => {
          ++detailRequest.current;
          setLinkedJobId(null);
          setSelected(null);
          setDetailLoading(false);
        }}
        onRead={markRead}
        onReadChange={setRead}
        onToggle={toggle}
        onCopy={copyJob}
        setNotice={setNotice}
        onPersonalSave={(job, record) => save({ ...personalRef.current, [job.id]: record })}
      />

      <Sheet open={!!importPreview} onOpenChange={(open) => { if (!open) setImportPreview(null); }}>
        <SheetContent className="backup-import-sheet">
          <SheetHeader><SheetTitle>确认合并个人备份</SheetTitle><SheetDescription>验证完成后统一保存；可在合并前先导出当前浏览器备份。</SheetDescription></SheetHeader>
          {importPreview && <div className="application-tracker">
            <p>岗位记录 {Object.keys(importPreview.records).length} 条，活动记录 {Object.keys(importPreview.event_records || {}).length} 条。</p>
            <p>有 {personalConflicts(personal, importPreview.records).length} 条备注或投递阶段缺少可比较的更新时间；请选择冲突处理方式。已有明确时间的内容采用较新记录。</p>
            {personalConflicts(personal, importPreview.records).slice(0, 20).map((id) => <details key={id}><summary>{allJobs.find((job) => job.id === id || job.duplicate_ids?.includes(id))?.title || id}</summary>
              <p>本机：{personal[id].application_stage || '阶段未填写'} · {personal[id].notes || personal[id].next_action_note || '无备注'}</p>
              <p>备份：{importPreview.records[id].application_stage || '阶段未填写'} · {importPreview.records[id].notes || importPreview.records[id].next_action_note || '无备注'}</p>
            </details>)}
            <button className="btn btn-outline" onClick={exportPersonal}>先导出本机备份</button>
            <button className="btn btn-primary" onClick={() => confirmImport(false)}>合并，保留本机冲突备注</button>
            <button className="btn btn-outline" onClick={() => confirmImport(true)}>合并，冲突以备份为准</button>
          </div>}
        </SheetContent>
      </Sheet>

      <Sheet open={sourceOpen} onOpenChange={setSourceOpen}>
        <SheetContent className="detail-sheet">
          <SheetHeader className="detail-header">
            <SheetTitle>来源与更新状态</SheetTitle>
            <SheetDescription>
              城市可选范围不等于已完整覆盖的城市。
            </SheetDescription>
          </SheetHeader>
          <div className="detail-body">
            <div className="apply-panel">
              <h3>
                {data?.schedule_enabled
                  ? '每日更新已启用'
                  : '每日自动更新尚未启用'}
              </h3>
              <p>
                本页展示最近一次采集结果。首次收录、原站发布和内容变化分别记录；采集失败不会把旧公告下架。
              </p>
            </div>
            {data?.sources.map((s) => (
              <article className="source-card" key={s.id}>
                <h3>
                  {s.name}
                  <span className={'tag ' + (s.status === 'ok' ? 'new' : '')}>
                    {s.status === 'ok'
                      ? '本次读取成功'
                      : s.status === 'partial'
                        ? '部分失败'
                        : s.status === 'deferred'
                          ? '按需联动'
                          : s.status === 'blocked'
                            ? '临时冷却'
                            : '本次读取失败'}
                  </span>
                </h3>
                {(s.scope || s.recruitment_types?.length || s.sectors?.length || s.trust) && (
                  <div className="tags" aria-label="来源范围与类型">
                    {s.scope && <span className="tag">范围：{s.scope}</span>}
                    {s.recruitment_types?.map((type) => (
                      <span className="tag blue" key={`${s.id}-${type}`}>
                        {type}
                      </span>
                    ))}
                    {s.sectors?.map((sector) => (
                      <span className="tag" key={`${s.id}-${sector}`}>
                        {sector}
                      </span>
                    ))}
                    {s.trust && <span className="tag">{s.trust}</span>}
                  </div>
                )}
                <p>
                  读取 {s.pages ?? 0} 页，发现 {s.discovered ?? 0} 条、详情解析 {s.parsed ?? 0}{' '}
                  条{s.cached ? `、复用近期已核实 ${s.cached} 条` : ''} · {s.coverage || '按规则运行'}
                </p>
                <p>最近列表巡检：{date(s.last_list_read_at || s.head_scan_at || ((s.pages ?? 0) > 0 ? s.last_attempt_at : null), true)}</p>
                <p>最近完整成功：{date(s.last_success_at, true)} · 待补详情 {s.pending_details ?? 0} 条</p>
                <p>最近尝试：{date(s.last_attempt_at, true)}</p>
                {Boolean(s.errors && s.errors.length > 0) && (
                  <p className="warning-text">
                    {s.errors?.length} 项读取异常，相关旧记录仍保留。
                  </p>
                )}
                <OutLink url={s.url}>访问来源</OutLink>
              </article>
            ))}
            <p className="source-note">
              当前已接入山东省平台招聘速递、中国银行和邮储银行官方招聘公告；更多银行、企业官网、事业单位和公务员专栏仍会按来源健康度逐步适配。当前没有结果不代表没有招聘。
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
