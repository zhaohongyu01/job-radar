'use client';

import { useState } from 'react';
import { ChevronDown, UserCheck } from 'lucide-react';
import { isExamProfileActive, SHANDONG_16 } from '@/lib/exams';
import type { ExamUserProfile } from '@/lib/exams';

export interface ExamProfilePanelProps {
  profile: ExamUserProfile;
  onUpdateProfile: (patch: Partial<ExamUserProfile>) => void;
  onClearProfile: () => void;
}

export function ExamProfilePanel({
  profile,
  onUpdateProfile,
  onClearProfile,
}: ExamProfilePanelProps) {
  const [profileOpen, setProfileOpen] = useState(false);
  const profileActive = isExamProfileActive(profile);
  const profileSummary = [
    profile.education !== '全部' ? profile.education : '',
    profile.majorQuery.trim() ? profile.majorQuery.trim() : '',
    profile.politicalStatus !== '不限' ? profile.politicalStatus : '',
    profile.gradIdentity !== '不限' ? profile.gradIdentity : '',
    profile.hukouCity !== '全部' ? `${profile.hukouCity}户籍` : '',
    profile.birthYear !== null ? `${profile.birthYear}年生` : '',
    profile.grassrootsYears > 0 ? `基层 ${profile.grassrootsYears} 年` : '',
  ].filter(Boolean);

  return (
    <section
      className={`exw-profile${profile.onlyMatchProfile ? ' is-on' : ''}`}
      aria-label="我的报考条件"
    >
      <div className="exw-profile-row">
        <span className="exw-profile-icon" aria-hidden="true">
          <UserCheck size={18} />
        </span>
        <div className="exw-profile-text">
          <strong>我的报考条件</strong>
          {profileSummary.length > 0 ? (
            <span className="exw-profile-summary">
              {profileSummary.map((s) => (
                <span key={s} className="exw-pill">
                  {s}
                </span>
              ))}
            </span>
          ) : (
            <span className="exw-muted">填写学历、专业等条件，自动标出你能报的岗位</span>
          )}
        </div>
        <label className="exw-switch">
          <input
            type="checkbox"
            checked={profile.onlyMatchProfile}
            onChange={(e) => onUpdateProfile({ onlyMatchProfile: e.target.checked })}
          />
          <span className="exw-switch-ui" aria-hidden="true" />
          <span>隐藏不符合的</span>
        </label>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          aria-expanded={profileOpen}
          onClick={() => setProfileOpen((v) => !v)}
        >
          {profileOpen ? '收起' : profileActive ? '修改' : '填写条件'}
          <ChevronDown size={14} className={profileOpen ? 'exw-rot' : ''} />
        </button>
      </div>

      {profileOpen && (
        <div className="exw-profile-form">
          <label className="exw-field">
            <span>最高学历</span>
            <select
              value={profile.education}
              onChange={(e) =>
                onUpdateProfile({ education: e.target.value as ExamUserProfile['education'] })
              }
            >
              <option value="全部">不限</option>
              <option value="专科">专科</option>
              <option value="本科">本科</option>
              <option value="硕士研究生">硕士研究生</option>
              <option value="博士研究生">博士研究生</option>
            </select>
          </label>
          <label className="exw-field">
            <span>学位</span>
            <select
              value={profile.hasDegree ? 'yes' : 'no'}
              onChange={(e) => onUpdateProfile({ hasDegree: e.target.value === 'yes' })}
            >
              <option value="yes">已取得相应学位</option>
              <option value="no">无学位</option>
            </select>
          </label>
          <label className="exw-field is-wide">
            <span>专业关键词</span>
            <input
              type="text"
              placeholder="如：计算机 法学 会计（空格分隔多个）"
              value={profile.majorQuery}
              onChange={(e) => onUpdateProfile({ majorQuery: e.target.value })}
            />
          </label>
          <label className="exw-field">
            <span>政治面貌</span>
            <select
              value={profile.politicalStatus}
              onChange={(e) =>
                onUpdateProfile({
                  politicalStatus: e.target.value as ExamUserProfile['politicalStatus'],
                })
              }
            >
              <option value="不限">不限</option>
              <option value="中共党员">中共党员（含预备）</option>
              <option value="共青团员">共青团员</option>
              <option value="群众">群众</option>
            </select>
          </label>
          <label className="exw-field">
            <span>毕业身份</span>
            <select
              value={profile.gradIdentity}
              onChange={(e) =>
                onUpdateProfile({ gradIdentity: e.target.value as ExamUserProfile['gradIdentity'] })
              }
            >
              <option value="不限">不限</option>
              <option value="当年应届">当年应届生</option>
              <option value="择业期应届">择业期内毕业生</option>
              <option value="在职/社会人员">在职 / 社会人员</option>
            </select>
          </label>
          <label className="exw-field">
            <span>户籍 / 生源地</span>
            <select
              value={profile.hukouCity}
              onChange={(e) => onUpdateProfile({ hukouCity: e.target.value })}
            >
              <option value="全部">不限</option>
              {SHANDONG_16.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value="省外">省外</option>
            </select>
          </label>
          <label className="exw-field">
            <span>出生年份</span>
            <select
              value={profile.birthYear ?? ''}
              onChange={(e) =>
                onUpdateProfile({ birthYear: e.target.value ? Number(e.target.value) : null })
              }
            >
              <option value="">不填</option>
              {Array.from({ length: 28 }, (_, i) => new Date().getFullYear() - 18 - i).map((yr) => (
                <option key={yr} value={yr}>
                  {yr} 年
                </option>
              ))}
            </select>
          </label>
          <label className="exw-field">
            <span>基层工作经历</span>
            <select
              value={profile.grassrootsYears}
              onChange={(e) => onUpdateProfile({ grassrootsYears: Number(e.target.value) })}
            >
              <option value={0}>无</option>
              <option value={1}>1 年</option>
              <option value={2}>2 年</option>
              <option value={3}>3 年</option>
              <option value={5}>5 年及以上</option>
            </select>
          </label>
          {profileActive && (
            <button
              type="button"
              className="text-btn exw-profile-clear"
              onClick={onClearProfile}
            >
              清空条件
            </button>
          )}
        </div>
      )}
    </section>
  );
}
