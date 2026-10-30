'use client';
import { useEffect, useMemo, useState } from 'react';
import { useEmployerReputation } from '@/components/employer-workspace';
import { matchReputation, REPUTATION_DIMENSIONS, REPUTATION_PROVIDERS, summarizeReputation, summarizeReputationEntity } from '@/lib/reputation';
import type { ReputationEntity } from '@/lib/reputation';
import type { EmployerProfile } from '@/lib/employers';

const day = (value: string | null) => value ? new Date(value).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }) : '日期未明确';
const kindLabels = { experience: '员工体验', interview: '面经', question: '求助讨论' };
export function ReputationPanel({ profile }: { profile: EmployerProfile }) {
  const reputation = useEmployerReputation();
  const { details, now } = reputation;
  const match = matchReputation(profile, reputation.index);
  const [sourceId, setSourceId] = useState('');
  const item = match?.items.find(row => row.id === sourceId) || match?.item;
  const file = item?.file;
  const [loaded, setLoaded] = useState<{ file: string; entity?: ReputationEntity; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [kind, setKind] = useState('auto'), [range, setRange] = useState('auto');
  const [city, setCity] = useState('全部城市'), [role, setRole] = useState(''), [department, setDepartment] = useState('');
  const [includeUnknown, setIncludeUnknown] = useState(true);
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void details(file).then(entity => { if (!cancelled) setLoaded({ file, entity }); })
        .catch(() => { if (!cancelled) setLoaded({ file, error: '评价详情读取失败，岗位与个人记录不受影响。' }); });
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [file, details, attempt]);
  const entity = loaded && loaded.file === file ? loaded.entity : undefined;
  const error = loaded && loaded.file === file ? loaded.error : '';
  const recent = (row: ReputationEntity['records'][number]) => !!row.published_at && Date.parse(row.published_at) <= now && now - Date.parse(row.published_at) <= 365 * 86400000;
  const confirmed = (row: ReputationEntity['records'][number]) => row.attribution !== 'uncertain';
  const pool = entity?.records.filter(row => kind === 'auto' || kind === 'all' || (kind === 'unconfirmed' ? row.attribution === 'uncertain' : row.kind === kind && confirmed(row))) || [];
  const automatic = pool.find(row => recent(row) && confirmed(row) && row.kind === 'experience')
    || pool.find(row => recent(row) && confirmed(row) && row.kind === 'interview')
    || pool.find(row => recent(row) && confirmed(row))
    || pool.find(confirmed) || pool[0];
  const activeKind = kind === 'auto' ? automatic?.attribution === 'uncertain' ? 'unconfirmed' : automatic?.kind || 'experience' : kind;
  const activeRange = range === 'auto' ? automatic && !recent(automatic) ? 'all' : 'recent' : range;
  const filtered = useMemo(() => (entity?.records || []).filter(row => {
    if (activeKind === 'unconfirmed' ? row.attribution !== 'uncertain' : row.attribution === 'uncertain' && activeKind !== 'all' || activeKind !== 'all' && row.kind !== activeKind) return false;
    if (activeRange === 'recent' && (!row.published_at || Date.parse(row.published_at) > now || now - Date.parse(row.published_at) > 365 * 86400000)) return false;
    if (city !== '全部城市' && (row.city ? row.city !== city : !includeUnknown)) return false;
    if (role && (row.role ? !row.role.toLowerCase().includes(role.toLowerCase()) : !includeUnknown)) return false;
    if (department && (row.department ? !row.department.includes(department) : !includeUnknown)) return false;
    return true;
  }), [entity, activeKind, activeRange, city, role, department, includeUnknown, now]);
  const summary = useMemo(() => entity ? summarizeReputationEntity(entity, now, filtered) : summarizeReputation([], now), [entity, filtered, now]);
  const cities = [...new Set(entity?.records.flatMap(row => row.city ? [row.city] : []) || [])].sort();
  if (!match || !item) return <div className="reputation-panel">
    <div className="employer-section-head"><h3>外部口碑</h3><span className="employer-neutral">评价不足 · 暂无综合分</span></div>
    <p>{reputation.loading ? '正在读取独立更新的口碑索引…' : '暂未匹配到已收录的公开评价，可继续使用下方原文检索。'}</p>
    {reputation.error && <output>{reputation.error}<button className="text-btn" onClick={reputation.retry}>重试口碑</button></output>}
  </div>;
  return <div className="reputation-panel">
    <div className="employer-section-head"><h3>公开评价与面经</h3><span className="employer-neutral">{REPUTATION_PROVIDERS[item.provider].label} · 公开页部分收录</span></div>
    {match.items.length > 1 && <label className="employer-field">评价来源<select aria-label="选择评价来源" value={item.id} onChange={event => setSourceId(event.target.value)}>
      {match.items.map(row => <option value={row.id} key={row.id}>{REPUTATION_PROVIDERS[row.provider].label} · {row.name}</option>)}
    </select></label>}
    <p className="small muted">当前来源已收录员工体验 {item.experience_count} 条，面经 {item.interview_count} 条，求助 {item.question_count} 条，企业归属待核对 {item.unattributed_count || 0} 条。网友内容尚未经本站事实核验。</p>
    {item.platform_score && <p className="small muted">{REPUTATION_PROVIDERS[item.provider].label}平台原生评分：{item.platform_score.value}/{item.platform_score.scale} · {item.platform_score.samples === null ? '平台未提供样本数' : `${item.platform_score.samples}份平台评分`} · 读取 {day(item.platform_score.checked_at)}。与下方文字倾向参考分分别显示。</p>}
    {match.reference && <p className="reputation-reference">以下对应“{item.name}”范围，仅供品牌或同名参考，不直接计入当前岗位的口碑筛选。</p>}
    <p className="small muted">最近体验发布：{day(item.latest_experience_at)} · 最近成功读取：{day(item.collected_at)}</p>
    <output className="small muted">{reputation.error}<button type="button" className="text-btn" disabled={reputation.loading} onClick={reputation.retry}>
      {reputation.loading ? '正在更新口碑…' : reputation.error ? '重试口碑' : '更新口碑'}
    </button></output>
    {item.status !== 'ok' && <p className="small muted">部分来源页暂未更新，已保留成功收录的资料。</p>}
    {error ? <p role="alert">{error} <button className="text-btn" onClick={() => setAttempt(value => value + 1)}>重试评价详情</button></p>
      : !entity ? <output>正在读取原评价摘句…</output> : <>
        <div className="reputation-controls">
          <label>内容类型<select aria-label="口碑内容类型" value={kind} onChange={event => setKind(event.target.value)}>
            <option value="auto">自动选择有内容的栏目</option><option value="unconfirmed">归属待核对</option><option value="experience">员工体验</option><option value="interview">面经</option><option value="question">求助讨论</option><option value="all">全部内容</option>
          </select></label>
          <label>发表时间<select aria-label="口碑发表时间" value={range} onChange={event => setRange(event.target.value)}>
            <option value="auto">自动选择（显示实际范围）</option><option value="recent">近一年</option><option value="all">全部历史</option>
          </select></label>
        </div>
        <details className="reputation-more"><summary>筛选工作城市、岗位或部门</summary><div className="reputation-controls">
          <label>工作城市<select aria-label="评价工作城市" value={city} onChange={event => setCity(event.target.value)}>
            <option>全部城市</option>{cities.map(value => <option key={value}>{value}</option>)}
          </select></label>
          <label>岗位关键词<input aria-label="评价岗位关键词" value={role} maxLength={40} onChange={event => setRole(event.target.value)} /></label>
          <label>部门关键词<input aria-label="评价部门关键词" value={department} maxLength={40} onChange={event => setDepartment(event.target.value)} /></label>
          <label className="check-row"><input type="checkbox" checked={includeUnknown} onChange={event => setIncludeUnknown(event.target.checked)} />保留未写明地点、岗位或部门的内容</label>
        </div></details>
        <p className="small muted">{activeRange === 'all' ? '当前展示全部历史，旧内容不计近期评分。' : '当前展示近一年。'} {activeKind === 'unconfirmed' ? '企业归属待核对，以下内容不作为本企业员工评价或评分依据。' : ''}当前 {filtered.length} 条；地点来自原文工作地点，未使用作者IP所在地或企业总部推断。</p>
        <div className="reputation-score">
          <strong>{summary.score == null ? '评价不足 · 暂无综合分' : `体验倾向参考 ${summary.score}/5`}</strong>
          <div className="reputation-dimensions">{Object.entries(REPUTATION_DIMENSIONS).map(([key, dimension]) => {
            const score = summary.dimensions[key as keyof typeof summary.dimensions];
            return <span key={key}>{dimension.label}：{score.score == null ? '样本不足' : `${score.score}/5`} <small>({score.contributors}个账号)</small></span>;
          })}</div>
          <details><summary>参考分如何计算</summary><p>仅采用近一年员工体验中的明确正向或顾虑表述；面经、求助、传闻和推广不打工作体验分。每个维度至少10个去重账号，至少3个维度有分才生成综合参考，缺失不记零分。</p>
            <p>规则把正向/顾虑映射为5/1分，混合意见取均值，并以5份中性先验平滑小样本。维度权重为薪酬30%、工时30%、成长25%、管理15%；可评分维度重新归一。来源超过7天未成功读取会停用分数。它不是平台官方评分，也不是企业信用结论。</p></details>
        </div>
        {filtered.some(row => row.attribution !== 'uncertain' && row.signals.length) && <div className="reputation-themes" aria-label="原文体验主题归纳"><strong>原文主题归纳</strong>
          <p className="small muted">以下按当前筛选归纳原帖提及，不代表本站核验结论；可点击原文查看上下文。</p>
          {Object.entries(REPUTATION_DIMENSIONS).map(([key, dimension]) => {
            const positives = filtered.filter(row => row.kind === 'experience' && row.attribution !== 'uncertain' && row.signals.some(signal => signal.dimension === key && signal.polarity > 0));
            const concerns = filtered.filter(row => row.kind === 'experience' && row.attribution !== 'uncertain' && row.signals.some(signal => signal.dimension === key && signal.polarity < 0));
            if (!positives.length && !concerns.length) return null;
            return <p key={key}>{dimension.label}：{positives.length > 0 && <a href={positives[0].url} target="_blank" rel="noopener noreferrer">{positives.length}条正向提及 ↗</a>}
              {positives.length > 0 && concerns.length > 0 && ' · '}{concerns.length > 0 && <a href={concerns[0].url} target="_blank" rel="noopener noreferrer">{concerns.length}条顾虑提及 ↗</a>}</p>;
          })}
        </div>}
        {!filtered.length && <p>当前条件没有内容。{range === 'recent' && <button className="text-btn" onClick={() => setRange('all')}>查看全部历史内容</button>}</p>}
        <div className="reputation-evidence">{filtered.slice(0, 40).map(row => <article key={row.id}>
          <div className="employer-section-head"><strong>{row.attribution === 'uncertain' ? '企业归属待核对' : kindLabels[row.kind]}</strong><time>{day(row.published_at)}</time></div>
          <a href={row.url} target="_blank" rel="noopener noreferrer">{row.title} ↗</a>
          <p>{row.excerpt}</p>
          <p className="small muted">{row.city || '工作城市未写明'}{row.role && ` · ${row.role}`}{row.department && ` · ${row.department}`}</p>
          {(row.attribution === 'uncertain' ? [] : row.signals).map((signal, i) => <p className={`reputation-signal ${signal.polarity > 0 ? 'is-positive' : 'is-concern'}`} key={i}>
            {signal.polarity > 0 ? '正向提及' : '顾虑提及'} · {REPUTATION_DIMENSIONS[signal.dimension].label}：“{signal.quote}”</p>)}
        </article>)}</div>
        {filtered.length > 40 && <p className="small muted">已显示前40条，可缩小筛选或查看来源。</p>}
      </>}
    <a className="quiet-link" href={item.source_url} target="_blank" rel="noopener noreferrer">查看{REPUTATION_PROVIDERS[item.provider].label}企业原页 ↗</a>
  </div>;
}
