'use client';

import { useMemo, useState } from 'react';
import {
  Bookmark,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Search,
  Share2,
  Star,
  Target,
  X,
} from 'lucide-react';
import {
  evaluateExamPositionEligibility,
  EXAM_TRACK_STAGES,
  isExamProfileActive,
} from '@/lib/exams';
import type {
  ExamAnnouncement,
  ExamPersonalRecord,
  ExamPositionRow,
  ExamTrackStatus,
  ExamUserProfile,
} from '@/lib/exams';
import { bianzhiLabel, categoryLabel, ExamSheet, formatShortDate, StagePill } from '@/components/exam-ui';

interface ExamDetailDrawerProps {
  exam: ExamAnnouncement | null;
  exams: ExamAnnouncement[];
  profile: ExamUserProfile;
  personal?: ExamPersonalRecord;
  onClose: () => void;
  onSelectExam: (exam: ExamAnnouncement) => void;
  onToggleSave: (examId: string) => void;
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
    <ExamSheet open={Boolean(exam)} onClose={onClose} label="招考公告详情" width={880}>
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
          onUpdatePersonal={onUpdatePersonal}
          onChangeStatus={onChangeStatus}
          onNotify={onNotify}
        />
      )}
    </ExamSheet>
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
  onUpdatePersonal: (examId: string, patch: Partial<ExamPersonalRecord>) => void;
  onChangeStatus: (examId: string, status: ExamTrackStatus) => void;
  onNotify: (msg: string) => void;
}) {
  const prevExam = currentIndex > 0 ? exams[currentIndex - 1] : null;
  const nextExam = currentIndex >= 0 && currentIndex < exams.length - 1 ? exams[currentIndex + 1] : null;
  const isSaved = Boolean(personal?.saved);
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
      if (onlyMatched && !elig.matched) return false;
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
      status: trackStatus === 'none' ? 'comparing' : trackStatus,
    });
    onNotify(exists ? '已移出候选岗位' : `已加入候选：${pos.position_name}`);
  };

  const lockTarget = (pos: ExamPositionRow) => {
    const label = `${pos.employer} · ${pos.position_name}${pos.position_code ? `（${pos.position_code}）` : ''}`;
    onUpdatePersonal(exam.id, {
      saved: true,
      targetPositionCode: label,
      status: trackStatus === 'none' ? 'comparing' : trackStatus,
    });
    onNotify(`已设为主报岗位：${label}`);
  };

  const copyShare = async () => {
    const text = [
      exam.title,
      `${exam.total_positions ?? '—'} 岗 / 招 ${exam.total_headcount ?? '—'} 人 · ${exam.bianzhi_types.join('、')}`,
      `报名：${exam.schedule.reg_start || ''} ~ ${exam.schedule.reg_end || '见公告'}`,
      exam.source_url,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      onNotify('已复制公告摘要与链接');
    } catch {
      onNotify('复制失败，请手动复制');
    }
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

  const facts: [string, string][] = [
    [
      '招录规模',
      exam.total_positions != null || exam.total_headcount != null
        ? `${exam.total_positions ?? '—'} 个岗位 · ${exam.total_headcount ?? '—'} 人`
        : '见公告',
    ],
    ['编制性质', exam.bianzhi_types.map(bianzhiLabel).join('、') || '见公告'],
    ['考试科目', exam.exam_subjects.join(' + ') || '见公告'],
    ['开考比例', exam.exam_ratio || '见公告'],
    ['学历学位', [exam.education_min, exam.degree_summary].filter(Boolean).join(' · ') || '见公告'],
    ['毕业身份', exam.fresh_grad_summary || '见公告'],
    ['政治面貌', exam.political_summary || '见公告'],
    ['年龄', exam.age_limit || '见公告'],
    ['户籍', exam.hukou_summary || '见公告'],
    ['报名方式', exam.registration_method || '见公告'],
    ...(exam.service_years ? ([['服务年限', exam.service_years]] as [string, string][]) : []),
    ...((exam.contact_phones?.length || 0) > 0
      ? ([['咨询电话', exam.contact_phones!.join(' / ')]] as [string, string][])
      : []),
  ];

  const body = (exam.body || exam.excerpt || '').split(/\n+/).filter((line) => line.trim());

  return (
    <>
      <header className="exw-dh">
        <div className="exw-dh-top">
          <div className="exw-card-meta">
            <StagePill stage={exam.stage} />
            <span className="exw-tag">{categoryLabel(exam.exam_category)}</span>
            {exam.bianzhi_types.slice(0, 3).map((bz) => (
              <span key={bz} className="exw-tag is-outline">
                {bianzhiLabel(bz)}
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
            <button type="button" className="exw-icon-btn" aria-label="关闭详情" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        <h2 className="exw-dh-title">{exam.title}</h2>
        <p className="exw-dh-sub">
          {exam.organizer} · {exam.source_name}
          {exam.published_at ? ` · ${formatShortDate(exam.published_at)}发布` : ''}
        </p>

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
          </select>
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
          <button type="button" onClick={() => jump('exw-sec-time')}>
            时间安排
          </button>
          <button type="button" onClick={() => jump('exw-sec-req')}>
            报考要求
          </button>
          {positions.length > 0 && (
            <button type="button" onClick={() => jump('exw-sec-pos')}>
              岗位表 <span>{positions.length}</span>
            </button>
          )}
          <button type="button" onClick={() => jump('exw-sec-note')}>
            我的记录
          </button>
          {attachments.length > 0 && (
            <button type="button" onClick={() => jump('exw-sec-att')}>
              附件 <span>{attachments.length}</span>
            </button>
          )}
          <button type="button" onClick={() => jump('exw-sec-body')}>
            公告原文
          </button>
        </nav>
      </header>

      <div className="exw-db">
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
          <dl className="exw-kv">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        {positions.length > 0 && (
          <section className="exw-ds" id="exw-sec-pos">
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
                    <span>只看可报</span>
                  </label>
                )}
              </div>
            </div>

            <div className="exw-table-wrap">
              <table className="exw-table is-compact">
                <thead>
                  <tr>
                    <th>岗位</th>
                    <th className="is-num">人数</th>
                    <th>学历 / 专业</th>
                    <th>其他条件</th>
                    {profileActive && <th>资格</th>}
                    <th aria-label="操作" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ pos, elig }) => {
                    const isCand = savedPosIds.includes(pos.row_id);
                    const isLocked =
                      Boolean(personal?.targetPositionCode?.includes(pos.position_name)) &&
                      Boolean(personal?.targetPositionCode?.includes(pos.employer));
                    const extra = [
                      pos.political_status && pos.political_status !== '不限' ? pos.political_status : '',
                      pos.fresh_grad_rule && !/^(不限|应往届均可)$/.test(pos.fresh_grad_rule) ? pos.fresh_grad_rule : '',
                      pos.other_conditions || '',
                    ].filter(Boolean);
                    return (
                      <tr
                        key={pos.row_id}
                        className={`${profileActive && elig.matched ? 'is-ok' : ''}${isLocked ? ' is-target' : ''}`}
                      >
                        <td className="exw-td-main">
                          <strong>{pos.position_name}</strong>
                          <div className="exw-row-sub">
                            {pos.employer}
                            {pos.position_code ? <span className="exw-code">{pos.position_code}</span> : null}
                          </div>
                        </td>
                        <td className="is-num">
                          <strong>{pos.recruit_count ?? '—'}</strong>
                        </td>
                        <td>
                          <div>{pos.education || '见公告'}</div>
                          <div className="exw-row-sub exw-clamp" title={pos.major_raw || '见公告'}>
                            {pos.major_raw || '见公告'}
                          </div>
                        </td>
                        <td>
                          {extra.length > 0 ? (
                            <div className="exw-row-sub exw-clamp" title={extra.join('；')}>
                              {extra.join('；')}
                            </div>
                          ) : (
                            <span className="exw-muted">无</span>
                          )}
                        </td>
                        {profileActive && (
                          <td>
                            {elig.matched ? (
                              <span className="exw-elig is-ok">
                                <CheckCircle2 size={12} />
                                可报
                              </span>
                            ) : (
                              <span className="exw-elig is-no" title={elig.conflicts.join('；')}>
                                {elig.conflicts[0]?.slice(0, 10) || '不符'}
                              </span>
                            )}
                          </td>
                        )}
                        <td className="is-action">
                          <div className="exw-row-actions">
                            <button
                              type="button"
                              className={`exw-icon-btn${isCand ? ' is-on' : ''}`}
                              aria-pressed={isCand}
                              aria-label={isCand ? '移出候选' : '加入候选'}
                              title={isCand ? '移出候选' : '加入候选'}
                              onClick={() => toggleCandidate(pos)}
                            >
                              <Star size={15} fill={isCand ? 'currentColor' : 'none'} />
                            </button>
                            <button
                              type="button"
                              className={`exw-icon-btn${isLocked ? ' is-on' : ''}`}
                              aria-pressed={isLocked}
                              aria-label="设为主报岗位"
                              title="设为主报岗位"
                              onClick={() => lockTarget(pos)}
                            >
                              <Target size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length === 0 && <p className="exw-empty is-inline">没有符合条件的岗位</p>}
            </div>
          </section>
        )}

        <section className="exw-ds" id="exw-sec-note">
          <div className="exw-ds-head">
            <h3 className="exw-ds-title">我的记录</h3>
            <span className="exw-muted">仅保存在本机浏览器</span>
          </div>
          <fieldset className="exw-stepper" aria-label="报考进度">
            {EXAM_TRACK_STAGES.map((st, idx) => {
              const currentIdx = EXAM_TRACK_STAGES.findIndex((s) => s.key === trackStatus);
              const state = idx < currentIdx ? ' is-done' : idx === currentIdx ? ' is-current' : '';
              return (
                <button
                  key={st.key}
                  type="button"
                  className={`exw-step${state}`}
                  aria-pressed={idx === currentIdx}
                  title={st.hint}
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

        {attachments.length > 0 && (
          <section className="exw-ds" id="exw-sec-att">
            <h3 className="exw-ds-title">附件</h3>
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
    </>
  );
}
