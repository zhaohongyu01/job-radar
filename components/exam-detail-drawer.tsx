'use client';

import { useMemo, useState } from 'react';
import {
  Bookmark,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Phone,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
  Target,
  X,
} from 'lucide-react';
import {
  computeExamStageLabel,
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

interface ExamDetailDrawerProps {
  exam: ExamAnnouncement | null;
  exams: ExamAnnouncement[];
  profile: ExamUserProfile;
  personal?: ExamPersonalRecord;
  onClose: () => void;
  onSelectExam: (exam: ExamAnnouncement) => void;
  onToggleSave: (examId: string) => void;
  onUpdatePersonal: (examId: string, patch: Partial<ExamPersonalRecord>) => void;
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
  onNotify,
}: ExamDetailDrawerProps) {
  const [posQuery, setPosQuery] = useState('');
  const [onlyMatchedPos, setOnlyMatchedPos] = useState(false);

  const currentIndex = useMemo(() => {
    if (!exam) return -1;
    return exams.findIndex((item) => item.id === exam.id);
  }, [exam, exams]);

  const prevExam = currentIndex > 0 ? exams[currentIndex - 1] : null;
  const nextExam = currentIndex >= 0 && currentIndex < exams.length - 1 ? exams[currentIndex + 1] : null;

  if (!exam) return null;

  const stageMeta = computeExamStageLabel(exam.stage);
  const isSaved = Boolean(personal?.saved);
  const trackStatus = personal?.status || 'none';
  const savedPosIds = personal?.savedPositionIds || [];
  const positions = exam.positions || [];
  const profileActive = isExamProfileActive(profile);

  const filteredPositions = positions.filter((pos) => {
    const elig = evaluateExamPositionEligibility(pos, profile);
    if ((onlyMatchedPos || profile.onlyMatchProfile) && !elig.matched) return false;
    if (posQuery.trim()) {
      const q = posQuery.trim().toLowerCase();
      const hay = `${pos.department} ${pos.employer} ${pos.position_name} ${pos.position_code || ''} ${pos.major_raw} ${pos.education} ${pos.political_status} ${pos.fresh_grad_rule} ${pos.other_conditions || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const toggleCandidatePos = (pos: ExamPositionRow) => {
    const exists = savedPosIds.includes(pos.row_id);
    const nextIds = exists
      ? savedPosIds.filter((id) => id !== pos.row_id)
      : [...savedPosIds, pos.row_id];
    onUpdatePersonal(exam.id, {
      saved: true,
      savedPositionIds: nextIds,
      status: trackStatus === 'none' ? 'comparing' : trackStatus,
    });
    onNotify(exists ? '已从候选岗位移除' : `已将「${pos.position_name}」加入候选对比`);
  };

  const lockTargetPos = (pos: ExamPositionRow) => {
    const label = `${pos.employer} · ${pos.position_name}${pos.position_code ? ` (${pos.position_code})` : ''}`;
    onUpdatePersonal(exam.id, {
      saved: true,
      targetPositionCode: label,
      status: trackStatus === 'none' ? 'comparing' : trackStatus,
    });
    onNotify(`已锁定主报岗位：${label}`);
  };

  const copyShare = async () => {
    const text = [
      `【${exam.exam_category}】${exam.title}`,
      `编制类型：${exam.bianzhi_types.join(' / ')} | 规模：${exam.total_positions}岗 / 招${exam.total_headcount}人`,
      `笔试科目：${exam.exam_subjects.join(' + ')} | 学历要求：${exam.education_min}`,
      `报名时间：${exam.schedule.reg_start || ''} ~ ${exam.schedule.reg_end || '见公告'}`,
      `原公告：${exam.source_url}`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      onNotify('招考简章摘要与链接已复制');
    } catch {
      onNotify('复制失败，请手动复制地址栏链接');
    }
  };

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const applyHref = exam.registration_url || exam.source_url;

  return (
    <div className="drawer-backdrop">
      <button
        type="button"
        className="drawer-backdrop-close"
        aria-label="关闭简章详情弹窗"
        onClick={onClose}
      />
      <aside
        className="drawer exam-drawer"
        aria-label="招考简章详情"
      >
        <header className="drawer-head">
          <div className="drawer-head-main">
            <div className="exam-card-badges">
              <span className="exam-badge is-category">{exam.exam_category}</span>
              {exam.bianzhi_types.map((bz) => (
                <span key={bz} className="exam-badge is-bianzhi">
                  <ShieldCheck size={12} /> {bz}
                </span>
              ))}
              <span className={`exam-stage-pill is-${stageMeta.tone}`}>{stageMeta.label}</span>
            </div>
            <h2>{exam.title}</h2>
            <p className="drawer-meta">
              <span>主管机关：{exam.organizer}</span>
              <span>·</span>
              <span>来源：{exam.source_name}</span>
              {exam.published_at && (
                <>
                  <span>·</span>
                  <span>发布：{exam.published_at}</span>
                </>
              )}
            </p>
          </div>
          <button type="button" className="icon-btn" aria-label="关闭详情" onClick={onClose}>
            <X size={20} />
          </button>
        </header>

        <div className="drawer-body">
          <div className="detail-sticky-bar">
            <div className="detail-actions">
              <button
                type="button"
                className={`btn btn-sm ${isSaved ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => onToggleSave(exam.id)}
              >
                <Bookmark size={14} />
                {isSaved ? '已收藏简章' : '收藏简章'}
              </button>

              <select
                className={`exam-status-select ${trackStatus !== 'none' ? 'is-active' : ''}`}
                aria-label="选择报考阶段"
                value={trackStatus}
                onChange={(e) =>
                  onUpdatePersonal(exam.id, { status: e.target.value as ExamTrackStatus, saved: true })
                }
              >
                <option value="none">报考进度：未标记</option>
                {EXAM_TRACK_STAGES.map((st) => (
                  <option key={st.key} value={st.key}>
                    阶段：{st.label}
                  </option>
                ))}
              </select>

              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copyShare()}>
                <Share2 size={14} /> 复制分享
              </button>

              <div className="detail-sticky-cta">
                {exam.registration_url && exam.registration_url !== exam.source_url && (
                  <a
                    className="btn btn-secondary btn-sm detail-sticky-source"
                    href={exam.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    原公告 <ExternalLink size={13} />
                  </a>
                )}
                <a
                  className="btn btn-primary btn-sm detail-sticky-apply"
                  href={applyHref}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {exam.registration_url ? '前往报名系统' : '查看官方原公告'} <ExternalLink size={14} />
                </a>
              </div>
            </div>

            <div className="detail-subbar">
              {exams.length > 1 && (
                <div className="detail-nav-group">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={!prevExam}
                    onClick={() => prevExam && onSelectExam(prevExam)}
                  >
                    <ChevronLeft size={15} /> 上一条
                  </button>
                  <span className="detail-nav-pos">
                    {currentIndex + 1} / {exams.length}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={!nextExam}
                    onClick={() => nextExam && onSelectExam(nextExam)}
                  >
                    下一条 <ChevronRight size={15} />
                  </button>
                </div>
              )}
              <nav className="detail-jump-nav" aria-label="简章章节导航">
                <button type="button" onClick={() => scrollToSection('exam-sec-overview')}>
                  考务要素
                </button>
                {positions.length > 0 && (
                  <button type="button" onClick={() => scrollToSection('exam-sec-positions')}>
                    岗位汇总表 ({positions.length})
                  </button>
                )}
                <button type="button" onClick={() => scrollToSection('exam-sec-tracker')}>
                  报考备忘
                </button>
                <button type="button" onClick={() => scrollToSection('exam-sec-body')}>
                  简章正文
                </button>
                {(exam.attachments?.length || 0) > 0 && (
                  <button type="button" onClick={() => scrollToSection('exam-sec-attachments')}>
                    官方附件 ({exam.attachments?.length})
                  </button>
                )}
              </nav>
            </div>
          </div>

          {/* Section 1: 考务全要素与时间节点 */}
          <section className="detail-section" id="exam-sec-overview">
            <div className="section-title-row">
              <h3>考务核心要素与时间轴</h3>
              <span className="text-muted">报名前请仔细核对年龄、应届界定与专业目录</span>
            </div>

            <div className="exam-schedule-strip is-detail">
              <div className={`exam-schedule-node ${exam.schedule.reg_end ? 'is-set' : ''}`}>
                <span className="node-k"><Calendar size={13} /> 网上报名时间</span>
                <span className="node-v">
                  {exam.schedule.reg_start && exam.schedule.reg_end
                    ? `${exam.schedule.reg_start} 至 ${exam.schedule.reg_end}`
                    : exam.schedule.reg_end || '详见下方正文'}
                </span>
              </div>
              <div className={`exam-schedule-node ${exam.schedule.audit_end ? 'is-set' : ''}`}>
                <span className="node-k">资格初审查询</span>
                <span className="node-v">{exam.schedule.audit_end || '报名期间同步初审'}</span>
              </div>
              <div className={`exam-schedule-node ${exam.schedule.payment_end ? 'is-set is-warn' : ''}`}>
                <span className="node-k">网上缴费确认</span>
                <span className="node-v">{exam.schedule.payment_end || '初审通过后按规定时间缴费'}</span>
              </div>
              <div className={`exam-schedule-node ${exam.schedule.written_exam_date ? 'is-set' : ''}`}>
                <span className="node-k">笔试时间</span>
                <span className="node-v">{exam.schedule.written_exam_date || '详见笔试通知'}</span>
              </div>
            </div>

            {(exam.schedule.raw_evidence?.length || 0) > 0 && (
              <div className="exam-evidence-box">
                <strong>考务时间原文条款：</strong>
                <ul>
                  {exam.schedule.raw_evidence!.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
            )}

            <dl className="detail-facts exam-detail-facts">
              <div>
                <dt>招录规模</dt>
                <dd>{exam.total_positions} 个岗位 / 计划招录 {exam.total_headcount} 人</dd>
              </div>
              <div>
                <dt>编制与管理性质</dt>
                <dd>{exam.bianzhi_types.join('、')}</dd>
              </div>
              <div>
                <dt>笔试/考核科目</dt>
                <dd>{exam.exam_subjects.join(' + ')}</dd>
              </div>
              <div>
                <dt>开考比例</dt>
                <dd>{exam.exam_ratio || '1:3'}</dd>
              </div>
              <div>
                <dt>学历与学位起点</dt>
                <dd>{exam.education_min} · {exam.degree_summary}</dd>
              </div>
              <div>
                <dt>应届与人员范围</dt>
                <dd>{exam.fresh_grad_summary}</dd>
              </div>
              <div>
                <dt>政治面貌要求</dt>
                <dd>{exam.political_summary}</dd>
              </div>
              <div>
                <dt>年龄与户籍限制</dt>
                <dd>{exam.age_limit || '35周岁以下'} · {exam.hukou_summary}</dd>
              </div>
              <div>
                <dt>报名方式</dt>
                <dd>
                  {exam.registration_method}
                  {exam.service_years ? `（${exam.service_years}）` : ''}
                </dd>
              </div>
              {(exam.contact_phones?.length || 0) > 0 && (
                <div>
                  <dt>政策咨询电话</dt>
                  <dd>
                    <Phone size={12} style={{ display: 'inline', marginRight: 4 }} />
                    {exam.contact_phones!.join(' / ')}
                  </dd>
                </div>
              )}
            </dl>
          </section>

          {/* Section 2: 结构化岗位汇总表 */}
          {positions.length > 0 && (
            <section className="detail-section" id="exam-sec-positions">
              <div className="section-title-row">
                <h3>
                  <FileSpreadsheet size={16} style={{ display: 'inline', marginRight: 6 }} />
                  结构化招聘岗位汇总表（共 {positions.length} 个岗位）
                </h3>
                <div className="exam-pos-toolbar">
                  <div className="exam-pos-search">
                    <Search size={14} />
                    <input
                      type="text"
                      placeholder="搜单位、岗位名、代码、专业..."
                      value={posQuery}
                      onChange={(e) => setPosQuery(e.target.value)}
                    />
                  </div>
                  <label className="exam-pos-toggle">
                    <input
                      type="checkbox"
                      checked={onlyMatchedPos || profile.onlyMatchProfile}
                      onChange={(e) => setOnlyMatchedPos(e.target.checked)}
                    />
                    <Sparkles size={13} />
                    <span>仅看我可报岗位</span>
                  </label>
                </div>
              </div>

              <div className="exam-positions-table-wrap">
                <table className="exam-positions-table">
                  <thead>
                    <tr>
                      <th>用人单位 / 主管部门</th>
                      <th>岗位名称 & 代码</th>
                      <th>招录数</th>
                      <th>学历 / 学位</th>
                      <th>专业要求</th>
                      <th>政治面貌 / 应届 / 其他限制</th>
                      <th>条件核验 & 选岗</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPositions.map((pos) => {
                      const elig = evaluateExamPositionEligibility(pos, profile);
                      const isCand = savedPosIds.includes(pos.row_id);
                      const isLocked =
                        personal?.targetPositionCode?.includes(pos.position_name) &&
                        personal?.targetPositionCode?.includes(pos.employer);

                      return (
                        <tr
                          key={pos.row_id}
                          className={`${elig.matched && profileActive ? 'is-eligible' : ''} ${isLocked ? 'is-locked-target' : ''}`}
                        >
                          <td>
                            <strong>{pos.employer}</strong>
                            {pos.department && pos.department !== pos.employer && (
                              <div className="text-muted text-xs">{pos.department}</div>
                            )}
                            {pos.city && <div className="text-muted text-xs">📍 {pos.city}</div>}
                          </td>
                          <td>
                            <strong>{pos.position_name}</strong>
                            {pos.position_code && (
                              <div className="exam-code-tag">代码：{pos.position_code}</div>
                            )}
                            <div className="text-muted text-xs">{pos.bianzhi}</div>
                          </td>
                          <td>
                            <strong className="exam-hc-badge">{pos.recruit_count} 人</strong>
                            {pos.exam_ratio && <div className="text-muted text-xs">比例 {pos.exam_ratio}</div>}
                          </td>
                          <td>
                            <div>{pos.education}</div>
                            {pos.degree && <div className="text-muted text-xs">{pos.degree}</div>}
                          </td>
                          <td className="exam-major-cell">{pos.major_raw}</td>
                          <td>
                            <div className="text-xs">政治面貌：{pos.political_status || '不限'}</div>
                            <div className="text-xs">范围：{pos.fresh_grad_rule || '不限'}</div>
                            {pos.other_conditions && (
                              <div className="text-muted text-xs">{pos.other_conditions}</div>
                            )}
                          </td>
                          <td>
                            {elig.matched ? (
                              <span className="elig-badge is-ok">
                                <CheckCircle2 size={12} /> 符合条件
                              </span>
                            ) : (
                              <span className="elig-badge is-conflict" title={elig.conflicts.join('；')}>
                                {elig.conflicts[0]}
                              </span>
                            )}
                            <div className="exam-pos-row-actions">
                              <button
                                type="button"
                                className={`btn btn-sm ${isCand ? 'btn-primary' : 'btn-secondary'}`}
                                onClick={() => toggleCandidatePos(pos)}
                              >
                                {isCand ? '★ 已候选' : '☆ 候选'}
                              </button>
                              <button
                                type="button"
                                className={`btn btn-sm ${isLocked ? 'btn-primary' : 'btn-ghost'}`}
                                onClick={() => lockTargetPos(pos)}
                                title="设为本次招考主报岗位"
                              >
                                <Target size={12} /> {isLocked ? '主报岗' : '锁定'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredPositions.length === 0 && (
                  <p className="text-muted" style={{ padding: '16px', textAlign: 'center' }}>
                    没有匹配当前筛选条件的岗位行，请放宽搜索词或取消「仅看我可报岗位」。
                  </p>
                )}
              </div>
            </section>
          )}

          {/* Section 3: 个人报考跟进与备忘 */}
          <section className="detail-section" id="exam-sec-tracker">
            <div className="section-title-row">
              <h3>个人报考跟进与准考证备忘</h3>
              <span className="text-muted">仅保存在当前浏览器本地</span>
            </div>

            <div className="exam-tracker-panel">
              <div className="exam-stage-buttons">
                {EXAM_TRACK_STAGES.map((st) => (
                  <button
                    key={st.key}
                    type="button"
                    className={`btn btn-sm ${trackStatus === st.key ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => onUpdatePersonal(exam.id, { status: st.key, saved: true })}
                  >
                    {st.label}
                  </button>
                ))}
              </div>

              <div className="exam-tracker-grid">
                <label>
                  <span>锁定主报岗位（单位 + 岗位名 + 代码）</span>
                  <input
                    type="text"
                    placeholder="如：济南市财政局 · 综合文字岗 (002)"
                    value={personal?.targetPositionCode || ''}
                    onChange={(e) =>
                      onUpdatePersonal(exam.id, { targetPositionCode: e.target.value })
                    }
                  />
                </label>
                <label>
                  <span>报名序号 / 准考证号</span>
                  <input
                    type="text"
                    placeholder="记录报名确认号或准考证号，防遗忘"
                    value={personal?.regNumber || ''}
                    onChange={(e) => onUpdatePersonal(exam.id, { regNumber: e.target.value })}
                  />
                </label>
                <label>
                  <span>笔试成绩 / 进面分数线记录</span>
                  <input
                    type="text"
                    placeholder="如：行测71.5 + 申论74.0 = 145.5（进面线141.0）"
                    value={personal?.writtenScore || ''}
                    onChange={(e) => onUpdatePersonal(exam.id, { writtenScore: e.target.value })}
                  />
                </label>
                <label>
                  <span>考点地址 / 资格复审材料备忘</span>
                  <input
                    type="text"
                    placeholder="记录考点学校、缴费提醒或复审所需盖章材料..."
                    value={personal?.notes || ''}
                    onChange={(e) => onUpdatePersonal(exam.id, { notes: e.target.value })}
                  />
                </label>
              </div>
            </div>
          </section>

          {/* Section 4: 附件下载 */}
          {(exam.attachments?.length || 0) > 0 && (
            <section className="detail-section" id="exam-sec-attachments">
              <h3>官方岗位表与报名附件下载 ({exam.attachments!.length})</h3>
              <ul className="attachment-list">
                {exam.attachments!.map((att, idx) => (
                  <li key={idx}>
                    <a href={att.url} target="_blank" rel="noopener noreferrer">
                      <Download size={14} />
                      <span>{att.title || `官方附件 ${idx + 1}`}</span>
                      {att.parse_status === 'parsed' && (
                        <span className="exam-parsed-tag">已自动解析岗位表</span>
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Section 5: 简章正文 */}
          <section className="detail-section" id="exam-sec-body">
            <h3>
              <FileText size={16} style={{ display: 'inline', marginRight: 6 }} />
              招考简章正文
            </h3>
            <div className="detail-body-text">
              {(exam.body || exam.excerpt)
                .split(/\n+/)
                .filter((line) => line.trim())
                .map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
