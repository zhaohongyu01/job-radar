'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Radar,
  ArrowUpRight,
  Search,
  Bookmark,
  Check,
  MapPin,
  SlidersHorizontal,
  RotateCcw,
  Download,
  Upload,
  Clock3,
  CircleHelp,
  ExternalLink,
  X,
  ChevronRight,
  RefreshCw,
  Bell,
  Database,
} from 'lucide-react';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Empty, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from '@/components/ui/pagination';
import {
  defaultFilters,
  filterJobs,
  isExpired,
  locationMatch,
  validatePersonal,
  externalUrl,
} from '@/lib/jobs';
import type { Job, Snapshot, Personal, Filters } from '@/lib/jobs';
const STORAGE = 'quancheng-personal-v1',
  VISIT = 'quancheng-last-visit-v1';
function date(value: string | null | undefined, time = false) {
  if (!value) return '尚无成功记录';
  return new Date(
    value.length === 10 ? value + 'T00:00:00+08:00' : value,
  ).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...(time ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}
function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="filter-field">
      <span>{label}</span>
      <Select value={value} onValueChange={(v) => onChange(v ?? '全部')}>
        <SelectTrigger className="field-control" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((v) => (
            <SelectItem key={v} value={v}>
              {v}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="check-label">
      <Checkbox checked={checked} onCheckedChange={onChange} />
      <span>{label}</span>
    </label>
  );
}
function OutLink({
  url,
  children,
  primary = false,
}: {
  url: string | null | undefined;
  children: React.ReactNode;
  primary?: boolean;
}) {
  const href = externalUrl(url);
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={primary ? 'primary-link' : 'quiet-link'}
    >
      {children}
      <ArrowUpRight size={15} />
    </a>
  ) : null;
}
export default function Home() {
  const [data, setData] = useState<Snapshot | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(defaultFilters),
    [personal, setPersonal] = useState<Personal>({}),
    [ready, setReady] = useState(false),
    [since, setSince] = useState<string | null>(null);
  const [selected, setSelected] = useState<Job | null>(null),
    [sourceOpen, setSourceOpen] = useState(false),
    [page, setPage] = useState(1),
    [notice, setNotice] = useState(''),
    [now, setNow] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/jobs.json', { cache: 'no-store' });
      if (!r.ok) throw Error('招聘信息暂时无法读取，请稍后重试。');
      const json = (await r.json()) as Snapshot;
      if (
        !json ||
        json.schema_version !== 1 ||
        !Array.isArray(json.jobs) ||
        !Array.isArray(json.sources)
      )
        throw Error('招聘数据格式异常。');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取失败');
    } finally {
      setLoading(false);
    }
  }, []);
  // Browser storage is read after hydration; SSR has no access to this device state.
  useEffect(() => {
    const initialRead = setTimeout(() => {
      void refresh();
      setNow(Date.now());
      try {
        setPersonal(
          validatePersonal(JSON.parse(localStorage.getItem(STORAGE) || '{}')),
        );
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
    };
  }, [refresh]);
  const change = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };
  const save = (next: Personal) => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(next));
      setPersonal(next);
      return true;
    } catch {
      setNotice('保存失败，浏览器存储不可用或已满。请先导出记录。');
      return false;
    }
  };
  const toggle = (job: Job, key: 'saved' | 'applied' | 'hidden') => {
    const next = {
      ...personal,
      [job.id]: { ...personal[job.id], [key]: !personal[job.id]?.[key] },
    };
    save(next);
  };
  const filtered = useMemo(
    () => filterJobs(data?.jobs ?? [], filters, personal, since, now),
    [data, filters, personal, since, now],
  );
  const exactCount = filtered.filter(
    (j) => locationMatch(j, filters.city) === 'exact',
  ).length;
  const pages = Math.max(1, Math.ceil(filtered.length / 12));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * 12, currentPage * 12);
  const newCount = (data?.jobs ?? []).filter(
    (j) =>
      since &&
      (Date.parse(j.first_seen_at) > Date.parse(since) ||
        Date.parse(j.updated_at) > Date.parse(since)),
  ).length;
  const dueCount = (data?.jobs ?? []).filter(
    (j) =>
      personal[j.id]?.saved &&
      j.deadline &&
      !isExpired(j, now) &&
      Date.parse(j.deadline) - now < 7 * 86400000,
  ).length;
  const years = [
    '全部',
    ...Array.from(
      new Set([
        '2027',
        ...(data?.jobs ?? []).flatMap((j) => j.graduation_years),
      ]),
    )
      .sort()
      .reverse(),
  ];
  const stale =
    !!data?.last_success_at &&
    now - Date.parse(data.last_success_at) > 36 * 3600000;
  const exportPersonal = () => {
    const blob = new Blob(
      [JSON.stringify({ version: 1, records: personal }, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '泉城职讯-个人记录.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('个人记录已导出。');
  };
  const importPersonal = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 2000000) throw Error('备份文件不能超过 2 MB');
      const backup = JSON.parse(await file.text());
      if (backup.version !== 1) throw Error('不支持此备份版本');
      const imported = validatePersonal(backup.records);
      if (save({ ...personal, ...imported }))
        setNotice('已合并备份中的个人记录。');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '无法读取备份文件');
    }
    if (fileRef.current) fileRef.current.value = '';
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
      <header className="topbar">
        <div className="brand">
          <Radar className="brand-icon" size={42} />
          <span>
            泉城职讯 <span className="edition">个人版</span>
          </span>
        </div>
        <Button variant="ghost" onClick={() => setSourceOpen(true)}>
          <Database size={16} />
          <span>信息来源</span>
        </Button>
      </header>
      <main className="workspace">
        <div className="intro">
          <div>
            <div className="eyebrow">你的求职信息台</div>
            <h1>找到下一份机会</h1>
            <p className="muted">按自己的条件筛选，把值得投的机会留下来。</p>
          </div>
          <div className="update-block">
            <span className="update-dot" />
            最近采集 {date(data?.last_success_at, true)}
            <button
              onClick={() => void refresh()}
              disabled={loading}
              aria-label="重新读取招聘数据"
            >
              <RefreshCw size={15} className={loading ? 'spinning' : ''} />
            </button>
          </div>
        </div>
        {notice && (
          <output className="notice">
            {notice}
            <button aria-label="关闭提示" onClick={() => setNotice('')}>
              <X size={16} />
            </button>
          </output>
        )}
        {error && (
          <div className="notice warning" role="alert">
            {error}
            {data ? ' 保留上次读取的结果。' : ''}
            <Button variant="outline" onClick={() => void refresh()}>
              重试
            </Button>
          </div>
        )}
        {data && !data.schedule_enabled && (
          <div className="pilot-notice">
            <Clock3 size={16} />
            <span>试用版 · 当前为最近一次采集结果，每日自动更新尚未启用。</span>
            {stale && <strong>信息已超过 36 小时未更新</strong>}
          </div>
        )}
        <div className="layout">
          <aside className="filter-panel">
            <h2>
              <SlidersHorizontal size={17} />
              筛选机会
              <button
                aria-label="重置筛选"
                title="重置筛选"
                onClick={() => {
                  setFilters(defaultFilters);
                  setPage(1);
                }}
              >
                <RotateCcw size={15} />
              </button>
            </h2>
            <Choice
              label="工作城市"
              value={filters.city}
              options={['全部城市', ...(data?.cities ?? ['济南'])]}
              onChange={(v) => change('city', v)}
            />
            <Choice
              label="招聘类型"
              value={filters.type}
              options={['全部', '校招', '社招']}
              onChange={(v) => change('type', v)}
            />
            {filters.type === '校招' && (
              <Choice
                label="毕业届别"
                value={filters.year}
                options={years}
                onChange={(v) => change('year', v)}
              />
            )}
            <Choice
              label="招聘单位"
              value={filters.sector}
              options={[
                '全部',
                '企业 / 其他',
                '银行',
                '国企',
                '事业单位',
                '公务员',
              ]}
              onChange={(v) => change('sector', v)}
            />
            <Choice
              label="岗位方向"
              value={filters.direction}
              options={[
                '全部',
                '财务 / 经济',
                '管理 / 职能',
                '技术 / 研发',
                '市场 / 销售',
              ]}
              onChange={(v) => change('direction', v)}
            />
            <label htmlFor="education" className="filter-field">
              学历关键词
              <Input
                id="education"
                className="field-control"
                value={filters.education}
                onChange={(e) => change('education', e.target.value)}
                placeholder="不限，可输入本科"
              />
            </label>
            <div className="filter-checks">
              <Toggle
                label="保留地点或资格待确认"
                checked={filters.includeUncertain}
                onChange={(v) => change('includeUncertain', v)}
              />
              <Toggle
                label="显示已截止公告"
                checked={filters.showExpired}
                onChange={(v) => change('showExpired', v)}
              />
              <p>
                默认不限专业。可在搜索框输入专业名称；公告未写明的资格需查看原文。
              </p>
            </div>
            <div className="local-records">
              <h3>我的记录</h3>
              <p>仅存当前浏览器，可导出后在其他设备导入。</p>
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportPersonal}
                  disabled={!ready}
                >
                  <Download size={14} />
                  导出
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                  disabled={!ready}
                >
                  <Upload size={14} />
                  导入
                </Button>
                <input
                  type="file"
                  accept="application/json,.json"
                  ref={fileRef}
                  hidden
                  onChange={(e) => void importPersonal(e.target.files?.[0])}
                />
              </div>
            </div>
          </aside>
          <section className="results" aria-label="招聘机会">
            <div className="search-box">
              <Search size={20} />
              <Input
                aria-label="搜索岗位、企业或专业"
                placeholder="搜索岗位、企业或专业，例如：财务、管理、经济学"
                value={filters.query}
                onChange={(e) => change('query', e.target.value)}
              />
              {filters.query && (
                <button
                  aria-label="清空搜索"
                  onClick={() => change('query', '')}
                >
                  <X size={16} />
                </button>
              )}
            </div>
            <div className="results-navigation">
              <Tabs
                value={filters.view}
                onValueChange={(v) => change('view', String(v))}
              >
                <TabsList variant="line" aria-label="个人招聘列表">
                  <TabsTrigger value="all">全部机会</TabsTrigger>
                  <TabsTrigger value="saved">
                    <Bookmark size={15} />
                    已收藏
                  </TabsTrigger>
                  <TabsTrigger value="applied">
                    <Check size={15} />
                    已投递
                  </TabsTrigger>
                  <TabsTrigger value="hidden">不感兴趣</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="result-summary">
              <p>
                <strong>{filtered.length}</strong> 条公告
                {filters.city !== '全部城市' && (
                  <span>
                    {' '}
                    · {exactCount} 条含明确{filters.city}工作地
                  </span>
                )}
              </p>
              <Toggle
                label="只看本次新增 / 变更"
                checked={filters.onlyNew}
                onChange={(v) => change('onlyNew', v)}
              />
            </div>
            {filters.onlyNew && !since && (
              <p className="inline-note">
                这是你首次访问，尚无上次查看时间。关闭此筛选可查看全部收录。
              </p>
            )}
            {since && newCount > 0 && (
              <p className="inline-note">
                全库有 {newCount}{' '}
                条自上次访问以来首次收录或内容变更；首次收录不代表刚发布。
              </p>
            )}
            {dueCount > 0 && (
              <div className="deadline-banner">
                <Bell size={17} />
                你收藏的 {dueCount} 条公告将在 7
                天内截止。请在原公告核对报名要求。
              </div>
            )}
            {loading && !data ? (
              <div className="cards" aria-label="正在读取">
                <Skeleton className="h-48 w-full" />
                <Skeleton className="h-48 w-full" />
              </div>
            ) : (
              <div className="cards">
                {visible.map((job, i) => {
                  const possible =
                    locationMatch(job, filters.city) === 'possible';
                  const saved = personal[job.id]?.saved;
                  const applied = personal[job.id]?.applied;
                  const expired = isExpired(job, now);
                  return (
                    <div key={job.id}>
                      {possible &&
                        (i === 0 ||
                          locationMatch(visible[i - 1], filters.city) !==
                            'possible') && (
                          <div className="supplement-heading">
                            <CircleHelp size={17} />
                            <div>
                              <strong>补充机会 · 地点待确认</strong>
                              <p>
                                正文提及该城市、山东，或未明确工作地点；请核对原公告。
                              </p>
                            </div>
                          </div>
                        )}
                      <article
                        className={'job-card' + (expired ? ' expired' : '')}
                      >
                        <div className="job-top">
                          <div className="tags">
                            <span
                              className={
                                'tag ' +
                                (job.types.includes('校招') ? 'blue' : '')
                              }
                            >
                              {job.types.join(' / ') || '招聘类型待确认'}
                            </span>
                            {job.graduation_years.length > 0 && (
                              <span className="tag">
                                {job.graduation_years.join(' / ')} 届
                              </span>
                            )}
                            <span className="tag">{job.sectors[0]}</span>
                            {since &&
                              Date.parse(job.first_seen_at) >
                                Date.parse(since) && (
                                <span className="tag new">首次收录</span>
                              )}
                            {applied && <span className="tag new">已投递</span>}
                          </div>
                          <button
                            className={
                              'bookmark-button' + (saved ? ' saved' : '')
                            }
                            aria-label={
                              (saved ? '取消收藏：' : '收藏：') + job.title
                            }
                            aria-pressed={!!saved}
                            disabled={!ready}
                            onClick={() => toggle(job, 'saved')}
                          >
                            <Bookmark
                              size={20}
                              fill={saved ? 'currentColor' : 'none'}
                            />
                          </button>
                        </div>
                        <h2>
                          <button
                            className="job-title"
                            onClick={() => setSelected(job)}
                          >
                            {job.title}
                          </button>
                        </h2>
                        {job.company && (
                          <p className="company-name">{job.company}</p>
                        )}
                        <div className="job-meta">
                          <span>
                            <MapPin size={15} />
                            {job.cities.length
                              ? job.cities.slice(0, 5).join(' / ') +
                                (job.cities.length > 5 ? ' 等' : '')
                              : '工作地待确认'}
                          </span>
                          <span>{job.education}</span>
                        </div>
                        <p className="job-excerpt">{job.excerpt}</p>
                        <div className="card-foot">
                          <div>
                            <p
                              className={
                                'deadline ' + (expired ? 'closed' : '')
                              }
                            >
                              {job.deadline ? (
                                <>
                                  <Clock3 size={14} />
                                  {expired ? '已截止' : '公告截止'}{' '}
                                  {date(job.deadline, true)}
                                  {job.deadline_precision === 'day'
                                    ? '（原文仅日期）'
                                    : ''}
                                </>
                              ) : (
                                <>截止时间待核对</>
                              )}
                            </p>
                            <p className="small muted">
                              {job.source_name} · 发布{' '}
                              {job.published_at || '日期未明确'}
                            </p>
                          </div>
                          <div className="card-actions">
                            <Button
                              variant="ghost"
                              onClick={() => setSelected(job)}
                            >
                              详情
                              <ChevronRight size={15} />
                            </Button>
                            <OutLink
                              primary
                              url={job.application_url || job.source_url}
                            >
                              {job.application_url
                                ? '前往投递'
                                : '查看报名说明'}
                            </OutLink>
                          </div>
                        </div>
                      </article>
                    </div>
                  );
                })}
                {!filtered.length && !loading && (
                  <Empty className="empty-state">
                    <Search size={30} />
                    <EmptyTitle className="text-lg">
                      没有符合当前条件的公告
                    </EmptyTitle>
                    <EmptyDescription>
                      已接入来源不代表该城市全部招聘。试试放宽筛选，或保留地点与资格待确认的机会。
                    </EmptyDescription>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setFilters(defaultFilters);
                        setPage(1);
                      }}
                    >
                      恢复默认筛选
                    </Button>
                  </Empty>
                )}
              </div>
            )}
            {pages > 1 && (
              <Pagination className="pagination-row" aria-label="招聘结果分页">
                <PaginationContent>
                  <PaginationItem>
                    <Button
                      variant="outline"
                      disabled={currentPage === 1}
                      onClick={() => setPage(currentPage - 1)}
                    >
                      上一页
                    </Button>
                  </PaginationItem>
                  <PaginationItem>
                    <span className="page-number">
                      {currentPage} / {pages}
                    </span>
                  </PaginationItem>
                  <PaginationItem>
                    <Button
                      variant="outline"
                      disabled={currentPage === pages}
                      onClick={() => setPage(currentPage + 1)}
                    >
                      下一页
                    </Button>
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
            <p className="source-note">
              {data?.sources.length ?? 0} 个来源 ·
              当前按公告聚合，部分公告包含多个岗位。标签由文字提取，未知资格不会当作“不符合”。
              <button
                className="quiet-link"
                onClick={() => setSourceOpen(true)}
              >
                查看覆盖与更新状态
                <ExternalLink size={13} />
              </button>
            </p>
          </section>
        </div>
      </main>
      <Sheet
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent className="detail-sheet">
          {selected && (
            <>
              <SheetHeader className="detail-header">
                <span className="eyebrow">
                  招聘公告 · {selected.source_name}
                </span>
                <SheetTitle className="text-xl leading-relaxed pr-6">
                  {selected.title}
                </SheetTitle>
                <SheetDescription>
                  发布 {selected.published_at || '日期未明确'} · 最近读取{' '}
                  {date(selected.last_verified_at, true)}
                </SheetDescription>
              </SheetHeader>
              <div className="detail-body">
                <div className="detail-actions">
                  <Button
                    variant={
                      personal[selected.id]?.saved ? 'default' : 'outline'
                    }
                    onClick={() => toggle(selected, 'saved')}
                  >
                    <Bookmark size={16} />
                    {personal[selected.id]?.saved ? '已收藏' : '收藏'}
                  </Button>
                  <Button
                    variant={
                      personal[selected.id]?.applied ? 'default' : 'outline'
                    }
                    onClick={() => toggle(selected, 'applied')}
                  >
                    <Check size={16} />
                    {personal[selected.id]?.applied ? '已投递' : '标记已投递'}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => toggle(selected, 'hidden')}
                  >
                    {personal[selected.id]?.hidden ? '恢复显示' : '不感兴趣'}
                  </Button>
                </div>
                <div className="apply-panel">
                  <h3>报名入口</h3>
                  <OutLink
                    primary
                    url={selected.application_url || selected.source_url}
                  >
                    {selected.application_url
                      ? '打开投递页面'
                      : '打开原公告查看报名方式'}
                  </OutLink>
                  {selected.emails.map((email) => (
                    <div className="email-row" key={email}>
                      <code>{email}</code>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(email)
                            .then(() =>
                              setNotice(
                                '报名邮箱已复制，请自行核对材料并发送。',
                              ),
                            )
                            .catch(() =>
                              setNotice('复制失败，请手动选择邮箱地址复制。'),
                            )
                        }
                      >
                        复制邮箱
                      </Button>
                    </div>
                  ))}
                  <p>跳转不会提交简历，也不会自动标记已投递。</p>
                  {selected.deadline_evidence && (
                    <p className="deadline-evidence">
                      {selected.deadline_evidence}
                    </p>
                  )}
                </div>
                <h3>地点与资格</h3>
                <p>
                  {selected.location_evidence.length
                    ? selected.location_evidence.join('；')
                    : '未提取到明确工作地点，请以岗位表为准。'}
                </p>
                <p className="inline-note">
                  自动整理标签可能不完整；应届资格、专业和工作经验要求请核对原文。
                </p>
                {(selected.attachments.length > 0 ||
                  selected.qr_attachment) && (
                  <>
                    <h3>附件</h3>
                    {selected.attachments.map((a, i) => (
                      <div className="attachment" key={i}>
                        <OutLink url={a.url}>{a.title}</OutLink>
                      </div>
                    ))}
                    {selected.qr_attachment && (
                      <p className="inline-note">
                        公告含二维码或扫码说明，未自动解析其中内容，请打开原公告查看。
                      </p>
                    )}
                  </>
                )}
                <h3>公告文字</h3>
                <div className="announcement-text">{selected.body}</div>
                {selected.links.length > 0 && (
                  <>
                    <h3>公告中的其他链接</h3>
                    {selected.links.map((a, i) => (
                      <div className="attachment" key={i}>
                        <OutLink url={a.url}>{a.title}</OutLink>
                      </div>
                    ))}
                  </>
                )}
                <p className="source-note">
                  首次收录 {date(selected.first_seen_at, true)} · 内容版本{' '}
                  {selected.revision}
                  <br />
                  最近内容变化 {date(selected.updated_at, true)}
                </p>
              </div>
            </>
          )}
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
                        : '本次读取失败'}
                  </span>
                </h3>
                <p>
                  读取 {s.pages} 页，解析 {s.parsed} 条 · {s.coverage}
                </p>
                <p>最近完整成功：{date(s.last_success_at, true)}</p>
                <p>最近尝试：{date(s.last_attempt_at, true)}</p>
                {s.errors.length > 0 && (
                  <p className="warning-text">
                    {s.errors.length} 项读取异常，相关旧记录仍保留。
                  </p>
                )}
                <OutLink url={s.url}>访问来源</OutLink>
              </article>
            ))}
            <p className="source-note">
              银行原站、更多高校、事业单位和公务员专栏仍需逐步适配。当前没有结果不代表没有招聘。邮件摘要将在后续接入。
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
