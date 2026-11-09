'use client';

import { CheckCircle2, Star, Target } from 'lucide-react';
import type {
  ExamAnnouncement,
  ExamPersonalRecord,
  ExamPersonalStore,
  ExamPositionRow,
  FlattenedExamPosition,
  PositionEligibilityResult,
} from '@/lib/exams';

function EligibilityCell({ eligibility }: { eligibility: PositionEligibilityResult }) {
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
  onSelectExam: (exam: ExamAnnouncement) => void;
  onToggleCandidate: (examId: string, rowId: string, positionName: string) => void;
}

export interface DrawerPositionTableProps {
  variant: 'drawer';
  rows: { pos: ExamPositionRow; elig: PositionEligibilityResult }[];
  profileActive: boolean;
  personal?: ExamPersonalRecord;
  onToggleCandidate: (pos: ExamPositionRow) => void;
  onLockTarget: (pos: ExamPositionRow) => void;
}

export type ExamPositionTableProps = WorkspacePositionTableProps | DrawerPositionTableProps;

export function ExamPositionTable(props: ExamPositionTableProps) {
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
      <div className="exw-table-wrap">
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
                      onClick={() => onSelectExam(row.exam)}
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
    );
  }

  const { rows, profileActive, personal, onToggleCandidate, onLockTarget } = props;
  const savedPosIds = personal?.savedPositionIds || [];

  return (
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
              pos.fresh_grad_rule && !/^(不限|应往届均可)$/.test(pos.fresh_grad_rule)
                ? pos.fresh_grad_rule
                : '',
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
      {rows.length === 0 && <p className="exw-empty is-inline">没有符合条件的岗位</p>}
    </div>
  );
}
