'use client';

import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Job } from '@/lib/jobs';
import { resolveEmployer } from '@/lib/employers';
import type { EmployerProfile } from '@/lib/employers';
import { commitEmployerPatch, EMPLOYER_PERSONAL_STORAGE, readEmployerRecords } from '@/lib/employer-personal';
import type { EmployerPatch, EmployerRecord, EmployerRecords } from '@/lib/employer-personal';
import { withPersonalLock } from '@/lib/personal-store';
import { useReputation } from '@/hooks/use-reputation';
import { currentReputationScore, matchReputation, REPUTATION_PROVIDERS } from '@/lib/reputation';
import { buildEmployerCatalog } from '@/lib/employer-catalog';

const EmployerDrawer = lazy(() => import('./employer-drawer'));
type SaveResult = { ok: boolean; message?: string };
type CatalogRegistration = { jobs: Job[]; onDetail: (job: Job) => void; complete: boolean };
type Workspace = { records: EmployerRecords; open: (job: Job) => void; reputation: ReturnType<typeof useReputation>;
  register: (registration: CatalogRegistration) => void; selectId: (id: string | null) => void; requestedId: string | null; missing: boolean };
const EmployerContext = createContext<Workspace | null>(null);
export function useEmployerRecords() { return useContext(EmployerContext)?.records || {}; }
export function useEmployerReputation() {
  const workspace = useContext(EmployerContext);
  if (!workspace) throw Error('Employer workspace missing');
  return workspace.reputation;
}
export function useEmployerNavigation() {
  const workspace = useContext(EmployerContext);
  if (!workspace) throw Error('Employer workspace missing');
  return { register: workspace.register, selectId: workspace.selectId, requestedId: workspace.requestedId, missing: workspace.missing };
}

export function EmployerWorkspace({ children }: { children: ReactNode }) {
  const reputation = useReputation();
  const enableReputation = reputation.enable;
  const [records, setRecords] = useState<EmployerRecords>({});
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  const [selection, setSelection] = useState<{ profile: EmployerProfile; job: Job } | null>(null);
  const [requestedId, setRequestedId] = useState<string | null>(null);
  const [registration, register] = useState<CatalogRegistration>({ jobs: [], onDetail: () => {}, complete: false });
  const catalog = useMemo(() => buildEmployerCatalog(registration.jobs), [registration.jobs]);
  const selectId = useCallback((id: string | null) => { setRequestedId(id); if (id) enableReputation(); }, [enableReputation]);
  useEffect(() => {
    if (!requestedId || selection?.profile.id === requestedId) return;
    const entry = catalog.get(requestedId);
    if (!entry) return;
    const timer = setTimeout(() => setSelection({ profile: entry.profile, job: entry.jobs[0] }), 0);
    return () => clearTimeout(timer);
  }, [requestedId, catalog, selection?.profile.id]);
  const reload = useCallback(() => {
    try { setRecords(readEmployerRecords(localStorage)); setError(''); }
    catch { setError('企业个人记录暂时无法读取，已保留当前显示；请保留已有备份。'); }
    setReady(true);
  }, []);
  useEffect(() => {
    const timer = setTimeout(reload, 0);
    const changed = (event: StorageEvent) => { if (event.key === EMPLOYER_PERSONAL_STORAGE || event.key === null) reload(); };
    window.addEventListener('storage', changed);
    window.addEventListener('focus', reload);
    window.addEventListener('job-radar-local-workspace-change', reload);
    return () => {
      clearTimeout(timer); window.removeEventListener('storage', changed);
      window.removeEventListener('focus', reload); window.removeEventListener('job-radar-local-workspace-change', reload);
    };
  }, [reload]);
  const show = useCallback((job: Job) => {
    const profile = resolveEmployer(job);
    if (profile) { enableReputation(); setSelection({ profile, job }); setRequestedId(profile.id); }
  }, [enableReputation]);
  const save = async (id: string, patch: EmployerPatch, expected?: EmployerRecord, overwrite = false): Promise<SaveResult> => {
    try {
      await withPersonalLock(() => commitEmployerPatch(localStorage, id, patch, new Date().toISOString(), expected, overwrite));
      reload(); return { ok: true };
    } catch (e) {
      reload(); return { ok: false, message: e instanceof DOMException && e.name === 'QuotaExceededError'
        ? '存储空间不足，未保存；草稿已保留，请先导出备份。' : e instanceof Error ? e.message : '未保存，请保留草稿后重试。' };
    }
  };
  const open = !!requestedId && selection?.profile.id === requestedId;
  return <EmployerContext.Provider value={{ records, open: show, reputation, register, selectId, requestedId,
    missing: !!requestedId && registration.complete && !catalog.has(requestedId) }}>
    {children}
    {selection && <Suspense fallback={open ? <output className="toast">正在打开企业口碑…</output> : null}>
      <EmployerDrawer key={selection.profile.id} profile={selection.profile} job={selection.job} open={open}
        jobs={catalog.get(selection.profile.id)?.jobs || [selection.job]} now={reputation.now} complete={registration.complete && catalog.has(selection.profile.id)}
        onDetail={job => { setRequestedId(null); registration.onDetail(job); }}
        onClose={() => setRequestedId(null)} record={records[selection.profile.id]} ready={ready} error={error}
        onSave={(patch, expected, overwrite) => save(selection.profile.id, patch, expected, overwrite)} />
    </Suspense>}
  </EmployerContext.Provider>;
}

/** Visible cards share one optional reputation index and lazy drawer. */
export function EmployerEntry({ job, name }: { job: Job; name: string }) {
  const workspace = useContext(EmployerContext);
  const profile = resolveEmployer(job);
  if (!workspace || !profile) return <span>{name}</span>;
  const rating = workspace.records[profile.id]?.rating;
  const match = matchReputation(profile, workspace.reputation.index);
  const score = currentReputationScore(match, workspace.reputation.now);
  return <button type="button" className="employer-entry" aria-label={`查看企业口碑：${name}`}
    title="查看评价来源与我的意向评分" onClick={() => workspace.open(job)}>
    <span>{name}</span><span className="employer-entry-hint">口碑</span>
    {rating != null && <span className="employer-rating-pill">我的 {rating}/5</span>}
    {score != null ? <span className="employer-public-pill">{REPUTATION_PROVIDERS[match!.item.provider].label}体验参考 {score}/5</span>
      : match && match.item.experience_count > 0 && <span className="employer-public-pill">{match.reference ? '范围参考 · ' : ''}{match.item.experience_count}条体验</span>}
  </button>;
}
