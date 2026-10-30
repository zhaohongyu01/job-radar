'use client';
import { useEmployerReputation } from '@/components/employer-workspace';
import { REPUTATION_PROVIDERS } from '@/lib/reputation';

export function ReputationCoverage() {
  const { index, loading, error, now, retry } = useEmployerReputation();
  const rows = index?.entities || [];
  return <section className="employer-section" aria-label="企业评价来源覆盖">
    <h3>企业评价来源</h3>
    {index ? <>
      <p className="small muted">资料索引生成于 {new Date(index.generated_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}；各企业的实际读取时间和原帖日期请在企业面板查看。</p>
      <p>已读取 {rows.length} 份企业来源资料 · 有内容 {rows.filter(row => row.experience_count + row.interview_count + row.question_count + (row.unattributed_count || 0) > 0).length} 份 · 近一年有员工体验 {rows.filter(row => row.recent_experience_count > 0).length} 份 · 当前可用参考分 {rows.filter(row => row.score !== null && Date.parse(row.valid_until) > now).length} 份。</p>
      <p className="small muted">已保留资料中，部分读取 {rows.filter(row => row.status === 'partial').length} 份，更新失败 {rows.filter(row => row.status === 'failed').length} 份。有资料可能只是一个空公开列表；同一企业的不同平台资料分别计数，不等于已覆盖全部企业。面经、求助不计员工体验分，平台原生评分与本站参考分分别显示。</p>
    </> : <p className="small muted">{loading ? '正在读取独立的评价索引…' : '评价索引暂未就绪，岗位仍可正常浏览。'}</p>}
    {Object.entries(REPUTATION_PROVIDERS).map(([id, source]) => <details key={id}><summary>{source.label} · {source.enabled ? '公开页部分接入' : '未启用自动采集'}</summary>
      <p className="small muted">{source.description} 核对日期：{source.checked_at}。</p>
      <a href={source.evidence_url} target="_blank" rel="noopener noreferrer" className="quiet-link">查看来源说明 ↗</a>
    </details>)}
    <output className="small muted">{error}</output>
    <button type="button" className="text-btn" disabled={loading} onClick={retry}>{loading ? '正在更新评价索引…' : '刷新评价来源'}</button>
  </section>;
}
