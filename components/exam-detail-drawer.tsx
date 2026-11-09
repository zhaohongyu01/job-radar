'use client';

import { useMemo, useState } from 'react';
import {
  Bookmark,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  EyeOff,
  MoreHorizontal,
  Search,
  Share2,
  X,
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  evaluateExamPositionEligibility,
  EXAM_TERMINAL_STAGES,
  EXAM_TRACK_STAGES,
  isExamProfileActive,
  isTerminalTrackStatus,
} from '@/lib/exams';
import type {
  ExamAnnouncement,
  ExamPersonalRecord,
  ExamPositionRow,
  ExamTrackStatus,
  ExamUserProfile,
} from '@/lib/exams';
import { downloadExamCalendar } from '@/lib/exam-calendar';
import { bianzhiLabel, categoryLabel, formatShortDate, StagePill } from '@/components/exam-ui';
import { ExamPositionTable } from '@/components/exams/exam-position-table';

interface ExamDetailDrawerProps {
  exam: ExamAnnouncement | null;
  exams: ExamAnnouncement[];
  profile: ExamUserProfile;
  personal?: ExamPersonalRecord;
  onClose: () => void;
  onSelectExam: (exam: ExamAnnouncement) => void;
  onToggleSave: (examId: string) => void;
  onToggleHide?: (examId: string) => void;
  onUpdatePersonal: (examId: string, patch: Partial<ExamPersonalRecord>) => void;
  onChangeStatus: (examId: string, status: ExamTrackStatus) => void;
  onNotify: (msg: string) => void;
}

export function ExamDetailDrawer({
  exam,
  exams,
  profile,
  personal,
  onClose,
  onSelectExam,
  onToggleSave,
  onToggleHide,
  onUpdatePersonal,
  onChangeStatus,
  onNotify,
}: ExamDetailDrawerProps) {
  const [posQuery, setPosQuery] = useState('');
  const [onlyMatchedPos, setOnlyMatchedPos] = useState(false);

  const currentIndex = useMemo(
    () => (exam ? exams.findIndex((item) => item.id === exam.id) : -1),
    [exam, exams],
  );

  return (
    <Sheet
      open={Boolean(exam)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side="right" showCloseButton={false} className="exw-sheet-content">
        {exam && (
          <DrawerContent
            exam={exam}
            exams={exams}
            currentIndex={currentIndex}
            profile={profile}
            personal={personal}
            posQuery={posQuery}
            setPosQuery={setPosQuery}
            onlyMatchedPos={onlyMatchedPos}
            setOnlyMatchedPos={setOnlyMatchedPos}
            onClose={onClose}
            onSelectExam={onSelectExam}
            onToggleSave={onToggleSave}
            onToggleHide={onToggleHide}
            onUpdatePersonal={onUpdatePersonal}
            onChangeStatus={onChangeStatus}
            onNotify={onNotify}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function DrawerContent({
  exam,
  exams,
  currentIndex,
  profile,
  personal,
  posQuery,
  setPosQuery,
  onlyMatchedPos,
  setOnlyMatchedPos,
  onClose,
  onSelectExam,
  onToggleSave,
  onToggleHide,
  onUpdatePersonal,
  onChangeStatus,
  onNotify,
}: {
  exam: ExamAnnouncement;
  exams: ExamAnnouncement[];
  currentIndex: number;
  profile: ExamUserProfile;
  personal?: ExamPersonalRecord;
  posQuery: string;
  setPosQuery: (v: string) => void;
  onlyMatchedPos: boolean;
  setOnlyMatchedPos: (v: boolean) => void;
  onClose: () => void;
  onSelectExam: (exam: ExamAnnouncement) => void;
  onToggleSave: (examId: string) => void;
  onToggleHide?: (examId: string) => void;
  onUpdatePersonal: (examId: string, patch: Partial<ExamPersonalRecord>) => void;
  onChangeStatus: (examId: string, status: ExamTrackStatus) => void;
  onNotify: (msg: string) => void;
}) {
  const prevExam = currentIndex > 0 ? exams[currentIndex - 1] : null;
  const nextExam = currentIndex >= 0 && currentIndex < exams.length - 1 ? exams[currentIndex + 1] : null;
  const [moreOpen, setMoreOpen] = useState(false);
  const isSaved = Boolean(personal?.saved);
  const isHidden = Boolean(personal?.hidden);
  const trackStatus = personal?.status || 'none';
  const savedPosIds = personal?.savedPositionIds || [];
  const positions = exam.positions || [];
  const profileActive = isExamProfileActive(profile);
  const onlyMatched = onlyMatchedPos || profile.onlyMatchProfile;
  const applyHref = exam.registration_url || exam.source_url;
  const attachments = exam.attachments || [];
  const evidence = exam.schedule.raw_evidence || [];

  const rows = positions
    .map((pos) => ({ pos, elig: evaluateExamPositionEligibility(pos, profile) }))
    .filter(({ pos, elig }) => {
      if (onlyMatched && elig.status === 'ineligible') return false;
      const q = posQuery.trim().toLowerCase();
      if (!q) return true;
      return `${pos.department} ${pos.employer} ${pos.position_name} ${pos.position_code || ''} ${pos.major_raw} ${pos.education}`
        .toLowerCase()
        .includes(q);
    });

  const toggleCandidate = (pos: ExamPositionRow) => {
    const exists = savedPosIds.includes(pos.row_id);
    onUpdatePersonal(exam.id, {
      saved: true,
      savedPositionIds: exists ? savedPosIds.filter((id) => id !== pos.row_id) : [...savedPosIds, pos.row_id],
    });
    onNotify(exists ? '已移出候选岗位' : `已加入候选：${pos.position_name}`);
  };

  const lockTarget = (pos: ExamPositionRow) => {
    const label = `${pos.employer} · ${pos.position_name}${pos.position_code ? `（${pos.position_code}）` : ''}`;
    onUpdatePersonal(exam.id, {
      saved: true,
      targetRowId: pos.row_id,
      targetPositionCode: label,
      status: trackStatus === 'none' ? 'comparing' : trackStatus,
    });
    onNotify(`已设为主报岗位：${label}`);
  };

  const copyShare = async () => {
    const deepLink = `https://sites-project.job-radar.workers.dev/exams?exam=${encodeURIComponent(exam.id)}`;
    const text = [exam.title, deepLink, exam.source_url].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      onNotify('已复制公告摘要与链接');
    } catch {
      onNotify('复制失败，请手动复制');
    }
  };

  const addToCalendar = () => {
    downloadExamCalendar([exam], Date.now());
    onNotify('已导出当前公告考务日历（.ics）');
  };

  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const timeline = [
    {
      label: '网上报名',
      value:
        exam.schedule.reg_start && exam.schedule.reg_end
          ? `${formatShortDate(exam.schedule.reg_start)} – ${formatShortDate(exam.schedule.reg_end)}`
          : exam.schedule.reg_end
            ? `截至 ${formatShortDate(exam.schedule.reg_end)}`
            : '',
    },
    { label: '资格初审', value: exam.schedule.audit_end ? `截至 ${formatShortDate(exam.schedule.audit_end)}` : '' },
    { label: '缴费确认', value: exam.schedule.payment_end ? `截至 ${formatShortDate(exam.schedule.payment_end)}` : '', warn: true },
    { label: '准考证打印', value: formatShortDate(exam.schedule.admit_card_start) },
    { label: '笔试', value: formatShortDate(exam.schedule.written_exam_date) },
  ];

  const rawFacts: [string, string][] = [
    [
      '招录规模',
      exam.total_positions != null || exam.total_headcount != null
        ? `${exam.total_positions ?? '—'} 个岗位 · ${exam.total_headcount ?? '—'} 人`
        : '',
    ],
    ['编制性质', exam.bianzhi_types.map(bianzhiLabel).join('、') || ''],
    ['考试科目', exam.exam_subjects.join(' + ') || ''],
    ['开考比例', exam.exam_ratio || ''],
    ['学历学位', [exam.education_min, exam.degree_summary].filter(Boolean).join(' · ') || ''],
    ['毕业身份', exam.fresh_grad_summary || ''],
    ['政治面貌', exam.political_summary || ''],
    ['年龄', exam.age_limit || ''],
    ['户籍', exam.hukou_summary || ''],
    ['报名方式', exam.registration_method || ''],
    ...(exam.service_years ? ([['服务年限', exam.service_years]] as [string, string][]) : []),
    ...((exam.contact_phones?.length || 0) > 0
      ? ([['咨询电话', exam.contact_phones!.join(' / ')]] as [string, string][])
      : []),
  ];
  const facts = rawFacts.filter(
    ([, val]) => Boolean(val && val.trim() && !/^(见公告|详见公告|见原公告|待定|未明确)$/.test(val.trim())),
  );

  const positionAttachment =
    attachments.find((att) => /岗位|职位|计划|汇总表|一览表/.test(att.title || '')) ||
    attachments[0] ||
    null;
  const showPositionSection =
    positions.length > 0 || (exam.positions_status === 'attachment_only' && Boolean(positionAttachment));
  const relatedNotices = [...(exam.related_notices || [])].sort((a, b) =>
    (a.published_at || '').localeCompare(b.published_at || ''),
  );
  const visibleTrackStages = EXAM_TRACK_STAGES.filter(
    (st) => !(exam.exam_category === '军队文职招考' && st.key === 'audited'),
  );
  const writtenSkippable = exam.notice_role !== '招考简章' || !exam.schedule.written_exam_date;
  const links = exam.links || [];

  const body = (exam.body || exam.excerpt || '').split(/\n+/).filter((line) => line.trim());
  const catText = categoryLabel(exam.exam_category);
  const uniqueBianzhi = Array.from(new Set(exam.bianzhi_types.map(bianzhiLabel))).filter(
    (label) => label && label !== catText,
  );

  return (
    <>
      <header className="exw-dh">
        <div className="exw-dh-top">
          <div className="exw-card-meta">
            <StagePill stage={exam.stage} />
            <span className="exw-tag">{catText}</span>
            {uniqueBianzhi.slice(0, 3).map((label) => (
              <span key={label} className="exw-tag is-outline">
                {label}
              </span>
            ))}
          </div>
          <div className="exw-dh-nav">
            {exams.length > 1 && currentIndex >= 0 && (
              <>
                <button
                  type="button"
                  className="exw-icon-btn"
                  aria-label="上一条"
                  disabled={!prevExam}
                  onClick={() => prevExam && onSelectExam(prevExam)}
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="exw-dh-pos">
                  {currentIndex + 1} / {exams.length}
                </span>
                <button
                  type="button"
                  className="exw-icon-btn"
                  aria-label="下一条"
                  disabled={!nextExam}
                  onClick={() => nextExam && onSelectExam(nextExam)}
                >
                  <ChevronRight size={16} />
                </button>
              </>
            )}
            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
              <PopoverTrigger
                type="button"
                className="exw-icon-btn exw-dh-more-btn"
                aria-label="更多操作"
                title="更多操作"
              >
                <MoreHorizontal size={16} />
              </PopoverTrigger>
              <PopoverContent align="end" sideOffset={6} className="opp-more-menu">
                {exam.registration_url && exam.registration_url !== exam.source_url && (
                  <a
                    href={exam.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="opp-more-item"
                    onClick={() => setMoreOpen(false)}
                  >
                    <ExternalLink size={14} />
                    <span>原公告</span>
                  </a>
                )}
                <button
                  type="button"
                  className="opp-more-item"
                  onClick={() => {
                    addToCalendar();
                    setMoreOpen(false);
                  }}
                >
                  <CalendarPlus size={14} />
                  <span>添加到日历</span>
                </button>
                <button
                  type="button"
                  className="opp-more-item"
                  onClick={() => {
                    void copyShare();
                    setMoreOpen(false);
                  }}
                >
                  <Share2 size={14} />
                  <span>分享</span>
                </button>
                {onToggleHide && (
                  <button
                    type="button"
                    className="opp-more-item is-danger"
                    onClick={() => {
                      onToggleHide(exam.id);
                      setMoreOpen(false);
                    }}
                  >
                    <EyeOff size={14} />
                    <span>{isHidden ? '恢复显示' : '不感兴趣'}</span>
                  </button>
                )}
              </PopoverContent>
            </Popover>
            <button type="button" className="exw-icon-btn" aria-label="关闭详情" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        <SheetTitle className="exw-dh-title">{exam.title}</SheetTitle>
        <SheetDescription className="exw-dh-sub">
          {exam.organizer} · {exam.source_name}
          {exam.published_at ? ` · ${formatShortDate(exam.published_at)}发布` : ''}
        </SheetDescription>

        <div className="exw-dh-actions">
          <button
            type="button"
            className={`btn btn-sm ${isSaved ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => onToggleSave(exam.id)}
          >
            <Bookmark size={14} fill={isSaved ? 'currentColor' : 'none'} />
            {isSaved ? '已收藏' : '收藏'}
          </button>
          <select
            className={`exw-select is-sm${trackStatus !== 'none' ? ' is-on' : ''}`}
            aria-label="报考进度"
            value={trackStatus}
            onChange={(e) => onChangeStatus(exam.id, e.target.value as ExamTrackStatus)}
          >
            <option value="none">报考进度：未跟进</option>
            {EXAM_TRACK_STAGES.map((st) => (
              <option key={st.key} value={st.key}>
                {st.label}
              </option>
            ))}
            {EXAM_TERMINAL_STAGES.map((st) => (
              <option key={st.key} value={st.key}>
                {st.label}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-ghost btn-sm" onClick={addToCalendar}>
            <CalendarPlus size={14} />
            添加到日历
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyShare()}>
            <Share2 size={14} />
            分享
          </button>
          <span className="exw-spacer" />
          {exam.registration_url && exam.registration_url !== exam.source_url && (
            <a className="btn btn-secondary btn-sm" href={exam.source_url} target="_blank" rel="noopener noreferrer">
              原公告
            </a>
          )}
          <a className="btn btn-primary btn-sm" href={applyHref} target="_blank" rel="noopener noreferrer">
            {exam.registration_url ? '前往报名' : '查看原公告'}
            <ExternalLink size={13} />
          </a>
        </div>

        <nav className="exw-dh-tabs" aria-label="章节导航">
          {showPositionSection && (
            <button type="button" onClick={() => jump('exw-sec-pos')}>
              岗位表 {positions.length > 0 ? <span>{positions.length}</span> : null}
            </button>
          )}
          <button type="button" onClick={() => jump('exw-sec-time')}>
            时间安排
          </button>
          <button type="button" onClick={() => jump('exw-sec-req')}>
            报考要求
          </button>
          {relatedNotices.length > 0 && (
            <button type="button" onClick={() => jump('exw-sec-related')}>
              后续通知 <span>{relatedNotices.length}</span>
            </button>
          )}
          <button type="button" onClick={() => jump('exw-sec-note')}>
            我的记录
          </button>
          {(attachments.length > 0 || links.length > 0) && (
            <button type="button" onClick={() => jump('exw-sec-att')}>
              附件与链接 <span>{attachments.length + links.length}</span>
            </button>
          )}
          <button type="button" onClick={() => jump('exw-sec-body')}>
            公告原文
          </button>
        </nav>
      </header>

      <div className="exw-db">
        {showPositionSection && (
          <section className="exw-ds" id="exw-sec-pos">
            {positions.length > 0 ? (
              <>
                <div className="exw-ds-head">
                  <h3 className="exw-ds-title">
                    岗位表 <span className="exw-muted">{rows.length} / {positions.length}</span>
                  </h3>
                  <div className="exw-ds-tools">
                    <div className="exw-search is-sm">
                      <Search size={14} />
                      <input
                        type="search"
                        aria-label="搜索岗位"
                        placeholder="单位、岗位、代码、专业"
                        value={posQuery}
                        onChange={(e) => setPosQuery(e.target.value)}
                      />
                    </div>
                    {profileActive && (
                      <label className="exw-switch">
                        <input
                          type="checkbox"
                          checked={onlyMatched}
                          onChange={(e) => setOnlyMatchedPos(e.target.checked)}
                        />
                        <span className="exw-switch-ui" aria-hidden="true" />
                        <span>隐藏不符合的</span>
                      </label>
                    )}
                  </div>
                </div>

                <ExamPositionTable
                  variant="drawer"
                  rows={rows}
                  profileActive={profileActive}
                  personal={personal}
                  onToggleCandidate={toggleCandidate}
                  onLockTarget={lockTarget}
                />
              </>
            ) : positionAttachment ? (
              <div className="exw-ds-head" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 className="exw-ds-title">岗位表</h3>
                  <p className="exw-muted" style={{ marginTop: 4 }}>
                    本公告岗位明细位于官方附件：{positionAttachment.title || '岗位汇总表'}
                  </p>
                </div>
                <a
                  className="btn btn-primary btn-sm"
                  href={positionAttachment.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download size={14} />
                  下载岗位表
                </a>
              </div>
            ) : null}
          </section>
        )}

        <section className="exw-ds" id="exw-sec-time">
          <h3 className="exw-ds-title">时间安排</h3>
          <ol className="exw-timeline">
            {timeline.map((step) => (
              <li
                key={step.label}
                className={`${step.value ? 'is-set' : ''}${step.warn && step.value ? ' is-warn' : ''}`}
              >
                <span className="exw-tl-dot" aria-hidden="true" />
                <span className="exw-tl-label">{step.label}</span>
                <span className="exw-tl-value">{step.value || '待公布'}</span>
              </li>
            ))}
          </ol>
          {evidence.length > 0 && (
            <details className="exw-evidence">
              <summary>查看公告中的时间原文</summary>
              <ul>
                {evidence.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section className="exw-ds" id="exw-sec-req">
          <h3 className="exw-ds-title">报考要求</h3>
          {facts.length > 0 ? (
            <dl className="exw-kv">
              {facts.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="exw-muted">具体条件见原公告</p>
          )}
        </section>

        {relatedNotices.length > 0 && (
          <section className="exw-ds" id="exw-sec-related">
            <h3 className="exw-ds-title">本次考试后续通知</h3>
            <ol className="exw-timeline">
              {relatedNotices.map((notice) => (
                <li key={notice.id} className="is-set">
                  <span className="exw-tl-dot" aria-hidden="true" />
                  <span className="exw-tl-label">
                    {notice.published_at ? formatShortDate(notice.published_at) : '后续进展'} ·{' '}
                    <span className="exw-tag is-notice">{notice.notice_type}</span>
                  </span>
                  <span className="exw-tl-value">
                    <a href={notice.url} target="_blank" rel="noopener noreferrer" className="text-btn">
                      {notice.title}
                    </a>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="exw-ds" id="exw-sec-note">
          <div className="exw-ds-head">
            <h3 className="exw-ds-title">我的记录</h3>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <select
                className={`exw-select is-sm${isTerminalTrackStatus(trackStatus) ? ' is-on' : ''}`}
                aria-label="结束跟进"
                value={isTerminalTrackStatus(trackStatus) ? trackStatus : ''}
                onChange={(e) => {
                  const val = e.target.value as ExamTrackStatus;
                  if (val) onChangeStatus(exam.id, val);
                }}
              >
                <option value="">结束跟进 ▾</option>
                {EXAM_TERMINAL_STAGES.map((st) => (
                  <option key={st.key} value={st.key}>
                    {st.label}
                  </option>
                ))}
              </select>
              <span className="exw-muted">仅保存在本机浏览器</span>
            </div>
          </div>
          <fieldset className="exw-stepper" aria-label="报考进度">
            {visibleTrackStages.map((st, idx) => {
              const currentIdx = visibleTrackStages.findIndex((s) => s.key === trackStatus);
              const state = idx < currentIdx ? ' is-done' : idx === currentIdx ? ' is-current' : '';
              const isSkippable = writtenSkippable && (st.key === 'paid' || st.key === 'written_done');
              return (
                <button
                  key={st.key}
                  type="button"
                  className={`exw-step${state}${isSkippable ? ' is-skippable' : ''}`}
                  style={isSkippable && state === '' ? { opacity: 0.55 } : undefined}
                  aria-pressed={idx === currentIdx}
                  title={isSkippable ? `${st.hint}（无笔试或非简章可跳过）` : st.hint}
                  onClick={() => onChangeStatus(exam.id, st.key)}
                >
                  <span className="exw-step-num">{idx + 1}</span>
                  <span>{st.shortLabel}</span>
                </button>
              );
            })}
          </fieldset>
          <div className="exw-form-grid">
            <label className="exw-field">
              <span>主报岗位</span>
              <input
                type="text"
                placeholder="单位 · 岗位（代码）"
                value={personal?.targetPositionCode || ''}
                onChange={(e) => onUpdatePersonal(exam.id, { targetPositionCode: e.target.value })}
              />
            </label>
            <label className="exw-field">
              <span>报名序号 / 准考证号</span>
              <input
                type="text"
                value={personal?.regNumber || ''}
                onChange={(e) => onUpdatePersonal(exam.id, { regNumber: e.target.value })}
              />
            </label>
            <label className="exw-field">
              <span>笔试成绩</span>
              <input
                type="text"
                placeholder="如：职测 71.5 + 综应 74"
                value={personal?.writtenScore || ''}
                onChange={(e) => onUpdatePersonal(exam.id, { writtenScore: e.target.value })}
              />
            </label>
            <label className="exw-field">
              <span>备注</span>
              <input
                type="text"
                placeholder="考点、复审材料等"
                value={personal?.notes || ''}
                onChange={(e) => onUpdatePersonal(exam.id, { notes: e.target.value })}
              />
            </label>
          </div>
        </section>

        {(attachments.length > 0 || links.length > 0) && (
          <section className="exw-ds" id="exw-sec-att">
            <h3 className="exw-ds-title">附件与链接</h3>
            <ul className="exw-attach">
              {attachments.map((att, idx) => (
                <li key={`${att.url}-${idx}`}>
                  <a href={att.url} target="_blank" rel="noopener noreferrer">
                    <Download size={14} />
                    <span>{att.title || `附件 ${idx + 1}`}</span>
                    {att.parse_status === 'parsed' && <span className="exw-tag is-brand">已解析</span>}
                  </a>
                </li>
              ))}
              {links.map((lk, idx) => (
                <li key={`link-${lk.url}-${idx}`}>
                  <a href={lk.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLink size={14} />
                    <span>{lk.title || `相关链接 ${idx + 1}`}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="exw-ds" id="exw-sec-body">
          <h3 className="exw-ds-title">公告原文</h3>
          <div className="exw-prose">
            {body.length > 0 ? body.map((para, i) => <p key={i}>{para}</p>) : <p className="exw-muted">暂无正文，请查看原公告。</p>}
          </div>
        </section>
      </div>
      <footer className="exw-mobile-bar" aria-label="详情底部操作栏">
        <button
          type="button"
          className={`btn btn-sm ${isSaved ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => onToggleSave(exam.id)}
        >
          <Bookmark size={14} fill={isSaved ? 'currentColor' : 'none'} />
          {isSaved ? '已收藏' : '收藏'}
        </button>
        <select
          className={`exw-select is-sm${trackStatus !== 'none' ? ' is-on' : ''}`}
          aria-label="报考进度（底部）"
          value={trackStatus}
          onChange={(e) => onChangeStatus(exam.id, e.target.value as ExamTrackStatus)}
        >
          <option value="none">报考进度 ▾</option>
          {EXAM_TRACK_STAGES.map((st) => (
            <option key={st.key} value={st.key}>
              {st.label}
            </option>
          ))}
        </select>
        <a
          className="btn btn-primary btn-sm exw-mobile-apply"
          href={applyHref}
          target="_blank"
          rel="noopener noreferrer"
        >
          {exam.registration_url ? '前往报名' : '查看原公告'}
          <ExternalLink size={13} />
        </a>
      </footer>
    </>
  );
}
