'use client';

import { useId, useMemo, useState } from 'react';
import {
  CalendarDays,
  GraduationCap,
  MapPin,
  X,
} from 'lucide-react';
import type { Job, Personal, Filters } from '@/lib/jobs';
import { upcomingTalks } from '@/lib/workspace';

export function ActionRail({
  jobs,
  personal,
  city,
  now,
  onDetail,
}: {
  jobs: Job[];
  personal: Personal;
  city: string;
  now: number;
  ready?: boolean;
  onDetail: (job: Job) => void;
  onView?: (view: Filters['view']) => void;
}) {
  const [allTalks, setAllTalks] = useState(true);
  const [selectedSchool, setSelectedSchool] = useState<string>('');
  const agendaId = useId();

  const talks = useMemo(
    () => upcomingTalks(jobs, personal, city, now),
    [jobs, personal, city, now],
  );

  // 从当前宣讲结果中聚合提取学校及场次，按场次降序、拼音升序排列
  const schoolOptions = useMemo(() => {
    const map = new Map<string, number>();
    for (const { event } of talks) {
      const s = event.school?.trim();
      if (s) {
        map.set(s, (map.get(s) || 0) + 1);
      }
    }
    return Array.from(map.entries())
      .map(([school, count]) => ({ school, count }))
      .sort((a, b) => b.count - a.count || a.school.localeCompare(b.school, 'zh-Hans-CN'));
  }, [talks]);

  // 当当前选择的高校不在当前城市结果中时自动回退为全部，避免使用 effect 触发级联渲染
  const activeSchool = useMemo(() => {
    if (!selectedSchool) return '';
    return schoolOptions.some((opt) => opt.school === selectedSchool)
      ? selectedSchool
      : '';
  }, [schoolOptions, selectedSchool]);

  // 按学校筛选宣讲日程
  const filteredTalks = useMemo(() => {
    if (!activeSchool) return talks;
    return talks.filter(({ event }) => event.school?.trim() === activeSchool);
  }, [talks, activeSchool]);

  const displayTalks = allTalks ? filteredTalks : filteredTalks.slice(0, 4);

  return (
    <aside className="plan-rail" aria-label="宣讲日程安排">
      <section className="plan-card">
        <div className="plan-head">
          <h2>
            <CalendarDays size={16} />
            宣讲日程
          </h2>
          <span className="chip">{city === '全部城市' ? '全部城市' : city}</span>
        </div>

        <p className="plan-caption">
          {activeSchool
            ? `按宣讲地点整理 · 已选 ${activeSchool} · 共 ${filteredTalks.length} 场`
            : `按宣讲地点整理 · 北京时间 · 共 ${talks.length} 场`}
        </p>

        {schoolOptions.length > 0 && (
          <div className="plan-school-filter-wrap">
            <div className="plan-school-select-box">
              <GraduationCap size={14} className="plan-school-icon" />
              <select
                value={activeSchool}
                onChange={(e) => setSelectedSchool(e.target.value)}
                className="plan-school-select"
                aria-label="筛选宣讲学校"
              >
                <option value="">全部高校（共 {talks.length} 场）</option>
                {schoolOptions.map(({ school, count }) => (
                  <option key={school} value={school}>
                    {school} ({count} 场)
                  </option>
                ))}
              </select>
              {activeSchool && (
                <button
                  type="button"
                  className="plan-school-clear"
                  onClick={() => setSelectedSchool('')}
                  title="清除学校筛选，查看全部高校"
                  aria-label="清除学校筛选"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {schoolOptions.length > 1 && (
              <div className="plan-school-chips" aria-label="快捷学校筛选">
                <button
                  type="button"
                  className={`plan-school-chip ${!activeSchool ? 'is-active' : ''}`}
                  onClick={() => setSelectedSchool('')}
                >
                  全部 <span>{talks.length}</span>
                </button>
                {schoolOptions.slice(0, 4).map(({ school, count }) => (
                  <button
                    key={school}
                    type="button"
                    className={`plan-school-chip ${activeSchool === school ? 'is-active' : ''}`}
                    onClick={() => setSelectedSchool(school === activeSchool ? '' : school)}
                    title={`${school}（共 ${count} 场宣讲）`}
                  >
                    {school.replace(/（[^）]+）|\([^)]+\)/g, '')} <span>{count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {talks.length === 0 ? (
          <div className="plan-empty">
            <CalendarDays size={22} />
            <span>
              暂未收录{city === '全部城市' ? '' : city}的后续宣讲。
              <br />
              可切换工作城市查看其他场次。
            </span>
          </div>
        ) : filteredTalks.length === 0 ? (
          <div className="plan-empty">
            <GraduationCap size={22} />
            <span>
              当前学校暂无宣讲日程。
              <br />
              <button
                type="button"
                className="plan-link"
                style={{ marginTop: 6, display: 'inline-flex' }}
                onClick={() => setSelectedSchool('')}
              >
                查看全部 {talks.length} 场宣讲
              </button>
            </span>
          </div>
        ) : (
          <ol id={agendaId} className={`agenda${allTalks ? ' is-expanded' : ''}`}>
            {displayTalks.map(({ job, event }) => (
              <li key={event.id || `${job.id}-${event.date}-${event.venue}`}>
                <div className="agenda-date">
                  <span>{Number(event.date.slice(5, 7))}月</span>
                  <strong>{event.date.slice(8)}</strong>
                </div>
                <button onClick={() => onDetail(job)}>
                  <strong>{job.company || job.title}</strong>
                  <span>
                    {event.start_time || '时间待确认'} · {event.school}
                  </span>
                  <small>
                    <MapPin size={11} />
                    {event.venue || '地点待确认'}
                  </small>
                </button>
              </li>
            ))}
          </ol>
        )}

        {filteredTalks.length > 4 && (
          <button
            className="plan-link"
            aria-expanded={allTalks}
            aria-controls={agendaId}
            onClick={() => setAllTalks((value) => !value)}
          >
            {allTalks
              ? '收起日程（仅显示前 4 场）'
              : `查看全部 ${filteredTalks.length} 场宣讲`}
          </button>
        )}

        <p className="plan-caption">
          宣讲城市不等于工作城市，出发前请核对原公告。
        </p>
      </section>

      <p className="plan-privacy">
        收藏和投递记录仅保存在当前浏览器。
        <br />
        换设备前，可在筛选栏导出备份。
      </p>
    </aside>
  );
}
