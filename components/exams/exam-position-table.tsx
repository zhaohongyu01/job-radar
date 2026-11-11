'use client';

import { useState } from 'react';
import { ArrowUpDown, CheckCircle2, Star, Target } from 'lucide-react';
import type {
  ExamAnnouncement,
  ExamPersonalRecord,
  ExamPersonalStore,
  ExamPositionRow,
  FlattenedExamPosition,
  PositionEligibilityResult,
} from '@/lib/exams';

export function EligibilityCell({ eligibility }: { eligibility: PositionEligibilityResult }) {
  if (eligibility.status === 'eligible') {
    return (
      <span
        className="exw-elig is-ok"
        title={eligibility.reasons.join('；')}
        aria-label={`可报：${eligibility.reasons.join('；')}`}
      >
        <CheckCircle2 size={12} />
        可报
      </span>
    );
  }
  if (eligibility.status === 'unknown') {
    return (
      <div
        title={eligibility.unknowns.join('；')}
        aria-label={`待核实：${eligibility.unknowns.join('；')}`}
      >
        <span className="exw-elig is-unknown">待核实</span>
        {eligibility.unknowns[0] && (
          <div className="exw-elig-sub">{eligibility.unknowns[0].slice(0, 20)}</div>
        )}
      </div>
    );
  }
  return (
    <div
      title={eligibility.conflicts.join('；')}
      aria-label={`不符：${eligibility.conflicts.join('；')}`}
    >
      <span className="exw-elig is-no">不符</span>
      {eligibility.conflicts[0] && (
        <div className="exw-elig-sub">{eligibility.conflicts[0].slice(0, 20)}</div>
      )}
    </div>
  );
}

export interface WorkspacePositionTableProps {
  variant: 'workspace';
  rows: FlattenedExamPosition[];
  profileActive: boolean;
  personal: ExamPersonalStore;
  onSelectExam: (exam: ExamAnnouncement, focusRowId?: string) => void;
  onToggleCandidate: (examId: string, rowId: string, positionName: string) => void;
}

export interface DrawerPositionTableProps {
  variant: 'drawer';
  rows: { pos: ExamPositionRow; elig: PositionEligibilityResult }[];
  profileActive: boolean;
  personal?: ExamPersonalRecord;
  focusPositionId?: string | null;
  onToggleCandidate: (pos: ExamPositionRow) => void;
  onLockTarget: (pos: ExamPositionRow) => void;
}

export interface CandidateCompareTableProps {
  variant: 'candidates';
  rows: FlattenedExamPosition[];
  staleCount?: number;
  onCleanupStale?: () => void;
  onSelectExam: (exam: ExamAnnouncement, focusRowId?: string) => void;
  onToggleCandidate: (examId: string, rowId: string, positionName: string) => void;
}

export type ExamPositionTableProps =
  | WorkspacePositionTableProps
  | DrawerPositionTableProps
  | CandidateCompareTableProps;

export function ExamPositionTable(props: ExamPositionTableProps) {
  const [sortByRecruit, setSortByRecruit] = useState<'none' | 'desc' | 'asc'>('none');

  if (props.variant === 'candidates') {
    const { rows, staleCount = 0, onCleanupStale, onSelectExam, onToggleCandidate } = props;
    const sortedRows =
      sortByRecruit === 'none'
        ? rows
        : [...rows].sort((a, b) => {
            const ca = a.recruit_count ?? 0;
            const cb = b.recruit_count ?? 0;
            return sortByRecruit === 'desc' ? cb - ca : ca - cb;
          });
    const cycleSort = () => {
      setSortByRecruit((prev) => (prev === 'none' ? 'desc' : prev === 'desc' ? 'asc' : 'none'));
    };

    return (
      <div className="exw-pos-container">
        {staleCount > 0 && (
          <div className="exw-alert" style={{ marginBottom: 12 }}>
            <span>岗位已下线或已更新（{staleCount}）</span>
            {onCleanupStale && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={onCleanupStale}>
                清理
              </button>
            )}
          </div>
        )}
        {sortedRows.length === 0 ? (
          <div className="exw-empty">
            <p>还没有加入候选的岗位</p>
            <span className="exw-muted">在职位库或公告详情中点击星标即可将岗位加入候选对比</span>
          </div>
        ) : (
          <>
            <div className="exw-table-wrap exw-pos-desktop">
              <table className="exw-table">
                <thead>
                  <tr>
                    <th>岗位</th>
                    <th>单位</th>
                    <th className="is-num">
                      <button
                        type="button"
                        className="text-btn"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        onClick={cycleSort}
                      >
                        人数
                        <ArrowUpDown size={12} />
                      </button>
                    </th>
                    <th>学历</th>
                    <th>专业</th>
                    <th>开考比例</th>
                    <th>资格状态</th>
                    <th>所属公告</th>
                    <th aria-label="候选" />
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row) => (
                    <tr key={row.row_id} className={row.eligibility.matched ? 'is-ok' : ''}>
                      <td className="exw-td-main">
                        <button
                          type="button"
                          className="exw-row-title"
                          onClick={() => onSelectExam(row.exam, row.row_id)}
                        >
                          {row.position_name}
                        </button>
                        {row.position_code && <span className="exw-code">{row.position_code}</span>}
                      </td>
                      <td>{row.employer}</td>
                      <td className="is-num">
                        <strong>{row.recruit_count ?? '—'}</strong>
                      </td>
                      <td className="exw-nowrap">{row.education || '见公告'}</td>
                      <td>
                        <div className="exw-row-sub exw-clamp" title={row.major_raw || '见公告'}>
                          {row.major_raw || '见公告'}
                        </div>
                      </td>
                      <td className="exw-nowrap">
                        {row.exam_ratio || row.exam.exam_ratio || '见公告'}
                      </td>
                      <td>
                        <EligibilityCell eligibility={row.eligibility} />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="exw-row-src text-btn"
                          title={row.exam.title}
                          onClick={() => onSelectExam(row.exam)}
                        >
                          {row.exam.title}
                        </button>
                      </td>
                      <td className="is-action">
                        <button
                          type="button"
                          className="exw-icon-btn is-on"
                          aria-pressed={true}
                          aria-label="移出候选"
                          title="移出候选"
                          onClick={() =>
                            onToggleCandidate(row.exam.id, row.row_id, row.position_name)
                          }
                        >
                          <Star size={15} fill="currentColor" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="exw-pos-cards" aria-label="候选岗位卡片列表">
              {sortedRows.map((row) => {
                const loc = row.city || row.exam.cities[0] || row.exam.province;
                return (
                  <article
                    key={row.row_id}
                    className={`exw-pos-card${row.eligibility.matched ? ' is-ok' : ''}`}
                  >
                    <div className="exw-pos-card-head">
                      <div>
                        <button
                          type="button"
                          className="exw-row-title"
                          onClick={() => onSelectExam(row.exam, row.row_id)}
                        >
                          {row.position_name}
                        </button>
                        <p className="exw-row-sub">
                          {row.employer} · {loc} · 招 <strong>{row.recruit_count ?? '—'}</strong> 人
                          {row.exam_ratio || row.exam.exam_ratio
                            ? ` · 比例 ${row.exam_ratio || row.exam.exam_ratio}`
                            : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="exw-icon-btn is-on"
                        aria-pressed={true}
                        aria-label="移出候选"
                        onClick={() =>
                          onToggleCandidate(row.exam.id, row.row_id, row.position_name)
                        }
                      >
                        <Star size={15} fill="currentColor" />
                      </button>
                    </div>
                    <p className="exw-pos-card-req">
                      {row.education || '学历见公告'} · {row.major_raw || '专业见公告'}
                    </p>
                    <div className="exw-pos-card-foot">
                      <span className="exw-row-src">{row.exam.title}</span>
                      <EligibilityCell eligibility={row.eligibility} />
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }
  if (props.variant === 'workspace') {
    const { rows, profileActive, personal, onSelectExam, onToggleCandidate } = props;
    if (rows.length === 0) {
      return (
        <div className="exw-empty">
          <p>没有符合条件的岗位</p>
        </div>
      );
    }
    return (
      <div className="exw-pos-container">
        <div className="exw-table-wrap exw-pos-desktop">
          <table className="exw-table">
            <thead>
              <tr>
                <th>岗位</th>
                <th>地区</th>
                <th className="is-num">人数</th>
                <th>学历 / 专业</th>
                <th>其他条件</th>
                {profileActive && <th>资格</th>}
                <th aria-label="候选" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isCand = personal[row.exam.id]?.savedPositionIds?.includes(row.row_id);
                const extra = [
                  row.political_status && row.political_status !== '不限' ? row.political_status : '',
                  row.fresh_grad_rule && !/^(不限|应往届均可)$/.test(row.fresh_grad_rule)
                    ? row.fresh_grad_rule
                    : '',
                ].filter(Boolean);
                return (
                  <tr
                    key={row.row_id}
                    className={profileActive && row.eligibility.matched ? 'is-ok' : ''}
                  >
                    <td className="exw-td-main">
                      <button
                        type="button"
                        className="exw-row-title"
                        onClick={() => onSelectExam(row.exam, row.row_id)}
                      >
                        {row.position_name}
                      </button>
                      <div className="exw-row-sub">
                        {row.employer}
                        {row.position_code ? (
                          <span className="exw-code">{row.position_code}</span>
                        ) : null}
                      </div>
                      <div className="exw-row-src" title={row.exam.title}>
                        {row.exam.title}
                      </div>
                    </td>
                    <td className="exw-nowrap">
                      {row.city || row.exam.cities[0] || row.exam.province}
                    </td>
                    <td className="is-num">
                      <strong>{row.recruit_count ?? '—'}</strong>
                    </td>
                    <td>
                      <div>{row.education || '见公告'}</div>
                      <div className="exw-row-sub exw-clamp" title={row.major_raw || '见公告'}>
                        {row.major_raw || '见公告'}
                      </div>
                    </td>
                    <td>
                      {extra.length > 0 ? (
                        <div className="exw-row-tags">
                          {extra.map((t) => (
                            <span key={t} className="exw-tag">
                              {t}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="exw-muted">—</span>
                      )}
                    </td>
                    {profileActive && (
                      <td>
                        <EligibilityCell eligibility={row.eligibility} />
                      </td>
                    )}
                    <td className="is-action">
                      <button
                        type="button"
                        className={`exw-icon-btn${isCand ? ' is-on' : ''}`}
                        aria-pressed={Boolean(isCand)}
                        aria-label={isCand ? '移出候选' : '加入候选'}
                        title={isCand ? '移出候选' : '加入候选'}
                        onClick={() => onToggleCandidate(row.exam.id, row.row_id, row.position_name)}
                      >
                        <Star size={15} fill={isCand ? 'currentColor' : 'none'} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="exw-pos-cards" aria-label="岗位卡片列表">
          {rows.map((row) => {
            const isCand = personal[row.exam.id]?.savedPositionIds?.includes(row.row_id);
            const loc = row.city || row.exam.cities[0] || row.exam.province;
            return (
              <article
                key={row.row_id}
                className={`exw-pos-card${profileActive && row.eligibility.matched ? ' is-ok' : ''}`}
              >
                <div className="exw-pos-card-head">
                  <div>
                    <button
                      type="button"
                      className="exw-row-title"
                      onClick={() => onSelectExam(row.exam, row.row_id)}
                    >
                      {row.position_name}
                    </button>
                    <p className="exw-row-sub">
                      {row.employer} · {loc} · 招 <strong>{row.recruit_count ?? '—'}</strong> 人
                    </p>
                  </div>
                  <button
                    type="button"
                    className={`exw-icon-btn${isCand ? ' is-on' : ''}`}
                    aria-pressed={Boolean(isCand)}
                    aria-label={isCand ? '移出候选' : '加入候选'}
                    onClick={() => onToggleCandidate(row.exam.id, row.row_id, row.position_name)}
                  >
                    <Star size={15} fill={isCand ? 'currentColor' : 'none'} />
                  </button>
                </div>
                <p className="exw-pos-card-req">
                  {row.education || '学历见公告'} · {row.major_raw || '专业见公告'}
                </p>
                <div className="exw-pos-card-foot">
                  <span className="exw-row-src">{row.exam.title}</span>
                  {profileActive && <EligibilityCell eligibility={row.eligibility} />}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    );
  }

  const { rows, profileActive, personal, focusPositionId, onToggleCandidate, onLockTarget } = props;
  const savedPosIds = personal?.savedPositionIds || [];

  return (
    <div className="exw-pos-container">
      <div className="exw-table-wrap exw-pos-desktop">
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
              const isLocked = Boolean(personal?.targetRowId && pos.row_id === personal.targetRowId);
              const isFocused = Boolean(focusPositionId && pos.row_id === focusPositionId);
              const extra = [
                pos.political_status && pos.political_status !== '不限' ? pos.political_status : '',
                pos.fresh_grad_rule && !/^(不限|应往届均可)$/.test(pos.fresh_grad_rule)
                  ? pos.fresh_grad_rule
                  : '',
                pos.other_conditions || '',
              ].filter(Boolean);
              return (
                <tr
                  key={pos.row_id}
                  id={`exam-pos-${pos.row_id}`}
                  className={`${profileActive && elig.matched ? 'is-ok' : ''}${isLocked ? ' is-target' : ''}${isFocused ? ' is-focused' : ''}`}
                >
                  <td className="exw-td-main">
                    <strong>{pos.position_name}</strong>
                    <div className="exw-row-sub">
                      {pos.employer}
                      {pos.position_code ? (
                        <span className="exw-code">{pos.position_code}</span>
                      ) : null}
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
                      <EligibilityCell eligibility={elig} />
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
                        onClick={() => onToggleCandidate(pos)}
                      >
                        <Star size={15} fill={isCand ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        type="button"
                        className={`exw-icon-btn${isLocked ? ' is-on' : ''}`}
                        aria-pressed={isLocked}
                        aria-label="设为主报岗位"
                        title="设为主报岗位"
                        onClick={() => onLockTarget(pos)}
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
      </div>

      <div className="exw-pos-cards" aria-label="岗位卡片列表">
        {rows.map(({ pos, elig }) => {
          const isCand = savedPosIds.includes(pos.row_id);
          const isLocked = Boolean(personal?.targetRowId && pos.row_id === personal.targetRowId);
          const isFocused = Boolean(focusPositionId && pos.row_id === focusPositionId);
          return (
            <article
              key={pos.row_id}
              data-pos-id={pos.row_id}
              className={`exw-pos-card${profileActive && elig.matched ? ' is-ok' : ''}${isLocked ? ' is-target' : ''}${isFocused ? ' is-focused' : ''}`}
            >
              <div className="exw-pos-card-head">
                <div>
                  <strong>{pos.position_name}</strong>
                  <p className="exw-row-sub">
                    {pos.employer} · 招 <strong>{pos.recruit_count ?? '—'}</strong> 人
                  </p>
                </div>
                <div className="exw-row-actions">
                  <button
                    type="button"
                    className={`exw-icon-btn${isCand ? ' is-on' : ''}`}
                    aria-pressed={isCand}
                    aria-label={isCand ? '移出候选' : '加入候选'}
                    onClick={() => onToggleCandidate(pos)}
                  >
                    <Star size={15} fill={isCand ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    type="button"
                    className={`exw-icon-btn${isLocked ? ' is-on' : ''}`}
                    aria-pressed={isLocked}
                    aria-label="设为主报岗位"
                    onClick={() => onLockTarget(pos)}
                  >
                    <Target size={15} />
                  </button>
                </div>
              </div>
              <p className="exw-pos-card-req">
                {pos.education || '学历见公告'} · {pos.major_raw || '专业见公告'}
              </p>
              {profileActive && (
                <div className="exw-pos-card-foot">
                  <EligibilityCell eligibility={elig} />
                </div>
              )}
            </article>
          );
        })}
      </div>

      {rows.length === 0 && <p className="exw-empty is-inline">没有符合条件的岗位</p>}
    </div>
  );
}
