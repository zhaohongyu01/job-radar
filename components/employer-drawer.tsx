'use client';

import { useMemo, useState } from 'react';
import { ArrowUpRight, Star } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { employerLabel, employerResearchLinks } from '@/lib/employers';
import type { EmployerProfile } from '@/lib/employers';
import type { EmployerPatch, EmployerRecord } from '@/lib/employer-personal';
import type { Job } from '@/lib/jobs';
import { locationSummary, defaultFilters, isExpired } from '@/lib/jobs';
import { formatUrlQuery } from '@/lib/browsing';
import { employerEvents } from '@/lib/employer-catalog';
import { REPUTATION_PROVIDERS } from '@/lib/reputation';
import { ReputationPanel } from '@/components/reputation-panel';

type Edits = Partial<Record<'rating' | 'notes', { value: string; base: string }>>;
const labels = { rating: '意向评分', notes: '个人备注' };

export default function EmployerDrawer({ profile, job, jobs, now, complete, onDetail, open, onClose, record, ready, error, onSave }: {
  profile: EmployerProfile; job: Job; open: boolean; onClose: () => void;
  jobs: Job[]; now: number; onDetail: (job: Job) => void;
  complete: boolean;
  record?: EmployerRecord; ready: boolean; error: string;
  onSave: (patch: EmployerPatch, expected?: EmployerRecord, overwrite?: boolean) => Promise<{ ok: boolean; message?: string }>;
}) {
  const [keyword, setKeyword] = useState(profile.name);
  const [city, setCity] = useState('全部城市'), [includeUnknown, setIncludeUnknown] = useState(true), [history, setHistory] = useState(false);
  const [limit, setLimit] = useState(20), [shareMessage, setShareMessage] = useState('');
  const [eventLimit, setEventLimit] = useState(20);
  const cities = useMemo(() => [...new Set(jobs.flatMap(row => row.cities))].sort(), [jobs]);
  const opportunities = useMemo(() => jobs.filter(row => (history || !isExpired(row, now)) &&
    (city === '全部城市' || row.cities.includes(city) || includeUnknown && !row.cities.length)), [jobs, history, now, city, includeUnknown]);
  const events = useMemo(() => employerEvents(jobs), [jobs]);
  const upcoming = events.filter(({ event }) => event.status !== 'cancelled' && Date.parse(`${event.date}T${event.end_time || '23:59'}:00+08:00`) >= now);
  const copyCompany = async () => {
    const url = new URL(window.location.href); url.search = formatUrlQuery(defaultFilters, null, profile.id); url.hash = '';
    try { await navigator.clipboard.writeText(url.href); setShareMessage('企业链接已复制，不包含个人意向或备注'); }
    catch { setShareMessage('复制失败，可从浏览器地址栏复制当前企业链接'); }
  };
  const [edits, setEdits] = useState<Edits>({}), [saving, setSaving] = useState(false), [message, setMessage] = useState('');
  const current = { rating: record?.rating == null ? '' : String(record.rating), notes: record?.notes || '' };
  const value = (key: keyof Edits) => edits[key]?.value ?? current[key];
  const conflicts = (Object.keys(edits) as (keyof Edits)[]).filter(key =>
    edits[key]!.base !== current[key] && edits[key]!.value !== current[key]);
  const edit = (key: keyof Edits, input: string) => {
    setMessage(''); setEdits(previous => {
      const next = { ...previous };
      if (input === current[key]) delete next[key];
      else next[key] = { value: input, base: previous[key]?.base ?? current[key] };
      return next;
    });
  };
  const submit = async (overwrite = false) => {
    if (!ready || saving || (conflicts.length && !overwrite)) return;
    const patch: EmployerPatch = {};
    if (edits.rating && value('rating') !== current.rating) patch.rating = value('rating') ? Number(value('rating')) : null;
    if (edits.notes && value('notes') !== current.notes) patch.notes = value('notes');
    if (!Object.keys(patch).length) { setEdits({}); setMessage('没有需要保存的修改'); return; }
    setSaving(true);
    try {
      const result = await onSave(patch, record, overwrite);
      if (result.ok) { setEdits({}); setMessage('企业个人记录已保存'); }
      else setMessage(result.message || '未保存，草稿已保留。');
    } catch { setMessage('未保存，草稿已保留，请稍后重试。'); }
    finally { setSaving(false); }
  };
  const scopeText = profile.scope === 'department'
    ? '本档案仅对应所列品牌下的招聘部门，不代表其他子公司或部门。'
    : profile.scope === 'brand' ? '这是集团品牌参考，不代表某家子公司或某个团队的工作体验。'
      : profile.scope === 'source' ? '企业简称或名称范围尚未明确，本档案仅对应当前招聘来源。'
        : '按招聘中的完整企业名称对应，保留分公司名称；尚未作工商主体核验。';
  return <Sheet open={open} onOpenChange={next => { if (!next && !saving) onClose(); }}>
    <SheetContent className="employer-sheet">
      <SheetHeader><SheetTitle>企业口碑 · {employerLabel(profile)}</SheetTitle>
        <SheetDescription>{scopeText}</SheetDescription></SheetHeader>
      <div className="employer-content">
        <section className="employer-section"><h3>当前招聘机会</h3>
          <p>{job.title}</p><p className="small muted">{locationSummary(job)} · {job.source_name}</p>
          {profile.brand && profile.scope !== 'brand' && <p className="small muted">集团参考：{profile.brand}。集团与本档案的个人评分分别保存。</p>}
        </section>
        <section className="employer-section" aria-label="企业全部机会">
          <div className="employer-section-head"><h3>{complete ? '企业全部机会' : '企业机会预览'}</h3><span className="chip">{complete ? `${jobs.length}条已收录` : '完整索引尚未就绪'}</span>
            <button type="button" className="text-btn" onClick={() => void copyCompany()}>分享企业</button></div>
          <output className="small muted">{shareMessage}</output>
          {!complete && <output className="small muted">当前仅展示已读取的资料；索引可能尚未完成，或该企业已不在当前索引中，不能当作完整统计。</output>}
          <div className="reputation-controls">
            <label>岗位工作城市<select aria-label="企业岗位工作城市" value={city} onChange={event => { setCity(event.target.value); setLimit(20); }}>
              <option>全部城市</option>{cities.map(value => <option key={value}>{value}</option>)}
            </select></label>
            <label className="check-row"><input type="checkbox" checked={history} onChange={event => { setHistory(event.target.checked); setLimit(20); }} />包含已截止与撤回记录</label>
            <label className="check-row"><input type="checkbox" checked={includeUnknown} onChange={event => setIncludeUnknown(event.target.checked)} />保留工作城市未明确的机会</label>
          </div>
          <p className="small muted">当前{opportunities.length}条；按同一企业档案聚合，集团、子公司和分公司分别保留。未标截止不代表已经核验在招。</p>
          <div className="employer-opportunities">{opportunities.slice(0, limit).map(row => <article key={row.id}>
            <button type="button" className="quiet-link" onClick={() => onDetail(row)}>{row.title}</button>
            <p className="small muted">{locationSummary(row)} · {row.source_name} · {row.published_at || '发布日期未明确'}</p>
            <p className="small muted">{row.deadline ? `截止 ${row.deadline.slice(0, 10)}` : '未写明截止日期'}{isExpired(row, now) && ' · 已截止/撤回'}</p>
          </article>)}</div>
          {!opportunities.length && <p className="small muted">当前条件没有已收录机会，可更换城市或查看历史。</p>}
          {opportunities.length > limit && <button type="button" className="text-btn" onClick={() => setLimit(value => value + 20)}>再显示20条机会</button>}
        </section>
        <section className="employer-section" aria-label="企业宣讲安排"><h3>宣讲与校园活动</h3>
          <p className="small muted">{upcoming.length}场后续活动；按举办地点展示，与上方岗位工作城市筛选独立。</p>
          {upcoming.slice(0, eventLimit).map(({ event, job: parent }) => <article key={event.id} className="employer-event">
            <strong>{event.date} {event.start_time || '时间待确认'}</strong>
            <p>{event.city || '城市待确认'} · {event.school} · {event.venue || '场地待确认'}</p>
            <button type="button" className="text-btn" onClick={() => onDetail(parent)}>查看活动与原公告</button>
          </article>)}
          {!upcoming.length && <p className="small muted">暂无已收录的后续活动，不代表该企业没有宣讲安排。</p>}
          {upcoming.length > eventLimit && <button type="button" className="text-btn" onClick={() => setEventLimit(value => value + 20)}>再显示20场活动（还有{upcoming.length - eventLimit}场）</button>}
        </section>
        <section className="employer-section" aria-label="外部口碑">
          <ReputationPanel profile={profile} />
          <details className="employer-provider-status"><summary>各平台接入情况</summary>
            {Object.entries(REPUTATION_PROVIDERS).map(([id, source]) => <p key={id} className="small muted"><strong>{source.label}：</strong>{source.description}（核对 {source.checked_at}）</p>)}
          </details>
          <label className="employer-field">检索企业名称<input value={keyword} maxLength={160} onChange={event => setKeyword(event.target.value)} /></label>
          <div className="employer-source-links">{employerResearchLinks(keyword).map(source =>
            <a key={source.domain} href={source.url} target="_blank" rel="noopener noreferrer">{source.label}<ArrowUpRight size={13} /></a>)}</div>
          <p className="small muted">以上入口通过必应检索对应网站；检索结果尚未收录或核验。修改检索名称不会改变个人评分的归属。</p>
          {profile.brand && profile.brand !== keyword && <button className="text-btn" onClick={() => setKeyword(profile.brand!)}>改用集团名称检索</button>}
        </section>
        <section className="employer-section employer-personal" aria-label="我的企业意向">
          <h3><Star size={16} />我的意向评分</h3>
          <p className="small muted">这是你的投递意愿，仅保存在当前浏览器，不计入企业公众口碑；可随个人备份导出。</p>
          {error && <p role="alert">{error}</p>}
          <label className="employer-field">意向评分<select aria-label="意向评分" disabled={!ready || saving} value={value('rating')} onChange={event => edit('rating', event.target.value)}>
            <option value="">尚未评分</option><option value="1">1分 · 暂不考虑</option><option value="2">2分 · 兴趣较低</option>
            <option value="3">3分 · 了解后决定</option><option value="4">4分 · 愿意投递</option><option value="5">5分 · 优先投递</option>
          </select></label>
          <label className="employer-field">个人备注<textarea aria-label="个人备注" rows={4} maxLength={2000} disabled={!ready || saving} value={value('notes')}
            placeholder="例如：重点确认双休、薪资结构、实际工作部门；也可记录你查到的评价链接。" onChange={event => edit('notes', event.target.value)} /></label>
          {!!conflicts.length && <div role="alert"><p>其他页面更新了{conflicts.map(key => labels[key]).join('、')}，你的草稿已保留。</p>
            <div className="employer-form-actions"><button className="btn btn-outline" disabled={saving} onClick={() => { setEdits({}); setMessage('已读取最新保存内容'); }}>读取已保存内容</button>
              <button className="btn btn-outline" disabled={saving} onClick={() => void submit(true)}>以当前输入覆盖冲突</button></div>
          </div>}
          <div className="employer-form-actions"><button className="btn btn-primary" disabled={!ready || saving || !!conflicts.length} onClick={() => void submit()}>{saving ? '正在保存…' : '保存我的企业评价'}</button>
            <button className="btn btn-outline" disabled={!ready || saving} onClick={() => {
              setEdits({ rating: { value: '', base: current.rating }, notes: { value: '', base: current.notes } });
              setMessage('已清空输入，点击保存后生效');
            }}>清空评分和备注</button></div>
          <output aria-live="polite">{message}</output>
          {record && <p className="small muted">上次保存 {new Date(record.updated_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>}
        </section>
        <section className="employer-section"><h3>投递前可确认</h3><ul className="employer-questions">
          <li>薪资由哪些部分组成，奖金和补贴如何发放？</li><li>实际工作城市、部门，以及合同签署单位是什么？</li>
          <li>休假、加班补偿、培训和晋升安排如何？</li>
        </ul></section>
      </div>
    </SheetContent>
  </Sheet>;
}
