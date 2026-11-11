'use client';

import { useEffect } from 'react';
import {
  ArrowUpRight,
  Bookmark,
  Briefcase,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Columns2,
  GraduationCap,
  MapPin,
  Maximize2,
  X,
} from 'lucide-react';
import type { Filters, Job, Personal } from '@/lib/jobs';
import {
  cardJobTitle,
  effectiveJobTypes,
  externalUrl,
  formatCompanyDisplay,
  formatEducationDisplay,
  getDeadlineCountdown,
  isExpired,
  locationSummary,
  personalFor,
} from '@/lib/jobs';
import { extractSalary } from '@/lib/salary-display';
import { cardSummaryFor } from '@/lib/card-summary';
import { EmployerEntry } from '@/components/employer-workspace';
import { APPLICATION_STAGES } from '@/lib/personal-records';
import { report } from '@/lib/rum';
import { formatDate } from '@/components/job-card';

export interface JobSplitPreviewProps {
  selected: Job | null;
  fallbackJob: Job | null;
  detailLoading: boolean;
  detailError: string;
  personal: Personal;
  ready: boolean;
  now: number;
  currentIndex: number;
  totalCount: number;
  onSelectJob: (job: Job) => void;
  onNavigate: (delta: -1 | 1) => void;
  onToggle: (job: Job, key: 'saved' | 'applied' | 'hidden') => void;
  onStageChange: (job: Job, stage: NonNullable<Filters['applicationStage']>) => void;
  onRead: (job: Job) => void;
  onExpandFull: (job: Job) => void;
  onCloseSplit: () => void;
}

export function JobSplitPreview({
  selected,
  fallbackJob,
  detailLoading,
  detailError,
  personal,
  ready,
  now,
  currentIndex,
  totalCount,
  onSelectJob,
  onNavigate,
  onToggle,
  onStageChange,
  onRead,
  onExpandFull,
  onCloseSplit,
}: JobSplitPreviewProps) {
  const job = selected ?? fallbackJob;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')))
      ) {
        return;
      }
      if (event.key === 'j' || event.key === 'J') {
        event.preventDefault();
        if (!selected && fallbackJob) {
          onSelectJob(fallbackJob);
        } else {
          onNavigate(1);
        }
      } else if (event.key === 'k' || event.key === 'K') {
        event.preventDefault();
        if (!selected && fallbackJob) {
          onSelectJob(fallbackJob);
        } else {
          onNavigate(-1);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selected, fallbackJob, onSelectJob, onNavigate]);

  if (!job) {
    return (
      <aside className="split-preview" aria-label="分栏速览面板">
        <div className="split-preview-empty">
          <Columns2 size={22} />
          <p>当前筛选暂无可预览机会</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onCloseSplit}>
            退出分栏速览
          </button>
        </div>
      </aside>
    );
  }

  const record = personalFor(job, personal);
  const saved = Boolean(record.saved);
  const applied = Boolean(record.applied);
  const expired = isExpired(job, now);
  const countdown = getDeadlineCountdown(job.deadline, now);
  const { cleanTitle, salary } = extractSalary(job);
  const { displayCompany } = formatCompanyDisplay(job.company, cleanTitle, job.source_id);
  const displayTitle = cardJobTitle(cleanTitle, job.company, displayCompany);
  const displayEducation = formatEducationDisplay(job.education, '学历待核实');
  const displayTypes = effectiveJobTypes(job);
  const applyHref = externalUrl(job.application_url || job.source_url);
  const currentStageKey = record.application_stage || (applied ? 'applied' : 'planned');
  const isHydrating = Boolean(selected && selected.id === job.id && detailLoading && !job.body);
  const bodyParagraphs = (job.body || cardSummaryFor(job).text || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const positions = job.positions || job.position_matches || [];

  return (
    <aside className="split-preview" aria-label="分栏速览详情">
      <header className="split-preview-bar">
        <span className="split-preview-badge">
          <Columns2 size={13} />
          {selected ? '分栏速览' : '首条速览（点击卡片加载全文）'}
        </span>
        <div className="split-preview-nav">
          {selected && totalCount > 1 && currentIndex >= 0 && (
            <>
              <button
                type="button"
                className="icon-btn"
                aria-label="上一条（K）"
                title="上一条（快捷键 K）"
                disabled={currentIndex <= 0}
                onClick={() => onNavigate(-1)}
              >
                <ChevronLeft size={15} />
              </button>
              <span className="split-preview-pos">
                {currentIndex + 1} / {totalCount}
              </span>
              <button
                type="button"
                className="icon-btn"
                aria-label="下一条（J）"
                title="下一条（快捷键 J）"
                disabled={currentIndex >= totalCount - 1}
                onClick={() => onNavigate(1)}
              >
                <ChevronRight size={15} />
              </button>
            </>
          )}
          <button
            type="button"
            className="icon-btn"
            aria-label="展开完整详情抽屉"
            title="展开完整双栏抽屉与跟进笔记"
            onClick={() => onExpandFull(job)}
          >
            <Maximize2 size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="关闭分栏速览"
            title="退出分栏速览，恢复校园日程栏"
            onClick={onCloseSplit}
          >
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="split-preview-scroll">
        <div className="split-preview-head">
          <div className="split-preview-company">
            <EmployerEntry job={job} name={displayCompany} />
            {salary && <span className="opp-salary">{salary}</span>}
          </div>
          <h3 className="split-preview-title">{displayTitle}</h3>

          <ul className="split-preview-facts">
            <li>
              <MapPin size={13} />
              <span>{locationSummary(job)}</span>
            </li>
            <li>
              <GraduationCap size={13} />
              <span>{displayEducation}</span>
            </li>
            <li>
              <Briefcase size={13} />
              <span>
                {displayTypes.join(' / ') || '类型待核实'}
                {job.graduation_years.length > 0 ? ` · ${job.graduation_years.join('/')}届` : ''}
              </span>
            </li>
            <li>
              <Clock3 size={13} />
              <span>
                {job.deadline
                  ? `${expired ? '已截止' : countdown?.text || '公告截止'} · ${formatDate(job.deadline, false)}`
                  : '截止日期待核实'}
              </span>
            </li>
          </ul>

          <div className="split-preview-actions">
            <button
              type="button"
              className={`btn btn-sm ${saved ? 'btn-primary' : 'btn-secondary'}`}
              disabled={!ready}
              onClick={() => onToggle(job, 'saved')}
            >
              <Bookmark size={14} fill={saved ? 'currentColor' : 'none'} />
              <span>{saved ? '已收藏' : '收藏'}</span>
            </button>
            <button
              type="button"
              className={`btn btn-sm ${applied ? 'btn-tonal' : 'btn-secondary'}`}
              disabled={!ready}
              onClick={() => onToggle(job, 'applied')}
            >
              <Check size={14} />
              <span>{applied ? APPLICATION_STAGES[currentStageKey] : '标记已投'}</span>
            </button>
            {applied && (
              <select
                className="field-select split-stage-select"
                aria-label="跟进阶段"
                value={currentStageKey}
                onChange={(e) =>
                  onStageChange(job, e.target.value as NonNullable<Filters['applicationStage']>)
                }
              >
                {Object.entries(APPLICATION_STAGES).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            )}
            {applyHref && (
              <a
                href={applyHref}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary btn-sm split-apply-cta"
                onClick={() => {
                  report('event', 'click_apply');
                  onRead(job);
                }}
              >
                <span>{job.application_url ? '前往投递' : '查看原公告'}</span>
                <ArrowUpRight size={14} />
              </a>
            )}
          </div>
        </div>

        {!selected && (
          <div className="split-preview-load-bar">
            <span>点击左侧任意卡片，或按键盘 J / K 键即可逐条速览完整正文</span>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => onSelectJob(job)}
            >
              加载本条全文
            </button>
          </div>
        )}

        {positions.length > 0 && (
          <section className="split-preview-sec">
            <h4>包含岗位（{positions.length}）</h4>
            <div className="split-pos-list">
              {positions.slice(0, 12).map((pos, idx) => (
                <div key={`${pos.name}-${idx}`} className="split-pos-item">
                  <strong>{pos.name}</strong>
                  <small>
                    {[pos.city, pos.education, (pos.majors || []).slice(0, 3).join('、')]
                      .filter(Boolean)
                      .join(' · ') || '条件见正文'}
                  </small>
                </div>
              ))}
              {positions.length > 12 && (
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => onExpandFull(job)}
                >
                  查看全部 {positions.length} 个岗位明细 →
                </button>
              )}
            </div>
          </section>
        )}

        <section className="split-preview-sec">
          <h4>公告正文</h4>
          {isHydrating ? (
            <div aria-busy="true">
              <div className="opp-skeleton" style={{ height: 16, marginBottom: 8 }} />
              <div className="opp-skeleton" style={{ height: 16, marginBottom: 8, width: '90%' }} />
              <div className="opp-skeleton" style={{ height: 16, width: '75%' }} />
            </div>
          ) : detailError && selected?.id === job.id ? (
            <p className="small text-danger">{detailError}</p>
          ) : bodyParagraphs.length > 0 ? (
            <div className="split-preview-prose">
              {bodyParagraphs.map((p, idx) => (
                <p key={idx}>{p}</p>
              ))}
            </div>
          ) : (
            <p className="small muted">暂无提取正文，请点击上方按钮查看原公告。</p>
          )}
        </section>
      </div>
    </aside>
  );
}
