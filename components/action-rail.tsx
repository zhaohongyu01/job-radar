'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { CalendarDays, MapPin, Bookmark, Download } from 'lucide-react';
import type { Job, Personal, Filters, TalkEvent } from '@/lib/jobs';
import { externalUrl } from '@/lib/jobs';
import { ALL_CITIES } from '@/lib/cities';
import { AGENDA_STORAGE, EVENT_PERSONAL_STORAGE, EVENT_TYPES, agendaEntries, defaultAgenda, restoreAgenda, validateEventPersonal, eventChanged } from '@/lib/agenda';
import type { AgendaFilters, EventPersonal } from '@/lib/agenda';
import { downloadCalendar } from '@/lib/calendar-export';
import { agendaCoverageMessage } from '@/lib/city-coverage';
import type { CoverageReport } from '@/lib/city-coverage';

const SYNC = 'job-radar-local-workspace-change';

export function ActionRail({ jobs, personal, city, now, ready, onDetail, coverage }: {
  jobs: Job[]; personal: Personal; city: string; now: number; ready?: boolean;
  onDetail: (job: Job) => void; onView?: (view: Filters['view']) => void; coverage?: CoverageReport | null;
}) {
  const [filters, setFilters] = useState<AgendaFilters>(() => defaultAgenda(city));
  const [saved, setSaved] = useState<EventPersonal>({});
  const [onlySaved, setOnlySaved] = useState(false);
  const [allTalks, setAllTalks] = useState(true);
  const [notice, setNotice] = useState('');
  const agendaId = useId();
  const cityId = useId();
  useEffect(() => {
    if (!ready) return;
    const load = () => {
      try {
        const agenda = localStorage.getItem(AGENDA_STORAGE);
        const restored = restoreAgenda(agenda ? JSON.parse(agenda) : null, city);
        if (!agenda) localStorage.setItem(AGENDA_STORAGE, JSON.stringify(restored));
        setFilters(restored);
        setSaved(validateEventPersonal(JSON.parse(localStorage.getItem(EVENT_PERSONAL_STORAGE) || '{}')));
      } catch { setNotice('安排设置暂未读取，仍可浏览；请先导出已有个人备份。'); }
    };
    load();
    window.addEventListener(SYNC, load);
    window.addEventListener('storage', load);
    return () => { window.removeEventListener(SYNC, load); window.removeEventListener('storage', load); };
    // A persisted agenda remains independent when the work-city prop changes.
  }, [ready, city]);

  const update = <K extends keyof AgendaFilters>(key: K, value: AgendaFilters[K]) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    try { localStorage.setItem(AGENDA_STORAGE, JSON.stringify(next)); window.dispatchEvent(new Event(SYNC)); }
    catch { setNotice('本次筛选已生效，但浏览器未能保存安排设置。'); }
  };
  const toggleSaved = (event: TalkEvent) => {
    const next = { ...saved, [event.id]: { saved: !saved[event.id]?.saved,
      observed: { date: event.date, start_time: event.start_time, venue: event.venue, status: event.status || 'scheduled' }, updated_at: new Date().toISOString() } };
    setSaved(next);
    try { localStorage.setItem(EVENT_PERSONAL_STORAGE, JSON.stringify(next)); window.dispatchEvent(new Event(SYNC)); }
    catch { setNotice('活动收藏未持久保存，请导出备份。'); }
  };
  const talks = useMemo(() => agendaEntries(jobs, personal, filters, now, saved, onlySaved), [jobs, personal, filters, now, saved, onlySaved]);
  const schools = useMemo(() => [...new Set([...(coverage?.schools || []), ...jobs.flatMap((job) => (job.talk_events ?? (job.talk_event ? [job.talk_event] : [])).map((event) => event.school)), filters.school].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')), [jobs, coverage, filters.school]);
  const displayed = allTalks ? talks : talks.slice(0, 4);
  const changes = talks.filter(({ event }) => saved[event.id]?.saved && eventChanged(event, saved[event.id]));
  const cityOptions = [...new Set(['全部城市', filters.city, ...ALL_CITIES])];
  const exportSelected = () => {
    try { downloadCalendar(talks.map(({ job, event }) => ({ event, title: job.company || job.title })), now); }
    catch (error) { setNotice(error instanceof Error ? error.message : '日历导出失败'); }
  };
  return (
    <aside className="plan-rail" aria-label="宣讲日程安排">
      <section className="plan-card">
        <div className="plan-head"><h2><CalendarDays size={16} />校园日程</h2><span className="chip">{talks.length} 场</span></div>
        <p className="plan-caption">按举办地点 · 北京时间；与工作城市独立设置</p>
        <div className="agenda-controls">
          <label>参加活动城市
            <input list={`${cityId}-options`} aria-label="参加活动城市" value={filters.city} onChange={(event) => update('city', event.target.value)} />
            <datalist id={`${cityId}-options`}>{cityOptions.map((value) => <option key={value} value={value}>{value}</option>)}</datalist>
          </label>
          <label>学校<select aria-label="筛选宣讲学校" value={filters.school} onChange={(event) => update('school', event.target.value)}>
            <option value="">全部高校（含地点待确认）</option>{schools.map((school) => <option key={school} value={school}>{school}</option>)}
          </select></label>
          <label>日期<select value={filters.range} onChange={(event) => update('range', event.target.value as AgendaFilters['range'])}>
            <option value="all">全部后续日程</option><option value="today">今天</option><option value="week">未来 7 天</option><option value="custom">自选日期</option>
          </select></label>
          {filters.range === 'custom' && <div className="agenda-dates"><input type="date" aria-label="活动开始日期" value={filters.dateFrom} onChange={(event) => update('dateFrom', event.target.value)} /><input type="date" aria-label="活动结束日期" value={filters.dateTo} onChange={(event) => update('dateTo', event.target.value)} /></div>}
          <div className="agenda-dates"><label>形式<select value={filters.mode} onChange={(event) => update('mode', event.target.value as AgendaFilters['mode'])}>
            <option value="all">全部形式</option><option value="offline">线下</option><option value="online">线上</option><option value="hybrid">线上＋线下</option><option value="unknown">待核实</option>
          </select></label><label>类型<select value={filters.eventType} onChange={(event) => update('eventType', event.target.value as AgendaFilters['eventType'])}>
            {Object.entries(EVENT_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label></div>
          <label className="check-row"><input type="checkbox" checked={filters.includeOnline} onChange={(event) => update('includeOnline', event.target.checked)} />包含不限城市的线上活动</label>
          <label className="check-row"><input type="checkbox" checked={onlySaved} onChange={(event) => setOnlySaved(event.target.checked)} />我的日程（含已结束 / 取消）</label>
        </div>
        {!!changes.length && <output className="plan-caption">已收藏的 {changes.length} 场活动发生改期、换地点或取消，请核对。</output>}
        {notice && <output className="plan-caption">{notice}</output>}
        <p className="plan-caption">{filters.city === '全部城市' ? '全部城市包含地点待确认活动；可按学校筛选。' : agendaCoverageMessage(coverage?.cities[filters.city], now)}</p>
        {!talks.length ? <div className="plan-empty"><CalendarDays size={22} /><span>当前条件下暂无已收录日程。地点待确认场次可切换“全部城市”并按学校找。</span></div> :
          <ol id={agendaId} className={`agenda${allTalks ? ' is-expanded' : ''}`}>
            {displayed.map(({ job, event }) => <li key={event.id}>
              <div className="agenda-date"><span>{Number(event.date.slice(5, 7))}月</span><strong>{event.date.slice(8)}</strong></div>
              <div className="agenda-event">
                <button onClick={() => onDetail(job)}><strong>{job.company || job.title}</strong><span>{event.start_time || '时间待确认'} · {event.school}</span><small><MapPin size={11} />{event.venue || '地点待核实'}</small></button>
                <small>{EVENT_TYPES[event.event_type || 'unknown']} · {event.status === 'cancelled' ? '已取消' : event.mode === 'online' ? '线上' : event.mode === 'offline' ? '线下' : '形式待核实'}</small>
                <small>入场：{event.access_policy || '原文未说明，请向学校核对'}</small>
                {eventChanged(event, saved[event.id]) && <small className="agenda-changed">安排有变化，请重新核对来源</small>}
                <div className="agenda-event-actions">
                  <button type="button" aria-label={saved[event.id]?.saved ? '取消收藏活动' : '收藏活动'} onClick={() => toggleSaved(event)}><Bookmark size={12} />{saved[event.id]?.saved ? '已收藏' : '收藏场次'}</button>
                  <a href={externalUrl(event.url)} target="_blank" rel="noreferrer">官方日程 ↗</a>
                  {event.registration_url && <a href={externalUrl(event.registration_url)} target="_blank" rel="noreferrer">报名 ↗</a>}
                </div>
              </div>
            </li>)}
          </ol>}
        {talks.length > 4 && <button className="plan-link" aria-expanded={allTalks} aria-controls={agendaId} onClick={() => setAllTalks(!allTalks)}>{allTalks ? '收起（前 4 场）' : `查看全部 ${talks.length} 场`}</button>}
        <button className="plan-link" disabled={!talks.length} onClick={exportSelected}><Download size={14} />导出当前日程到日历</button>
        <p className="plan-caption">文件导入后不会自动同步改期。宣讲城市不等于工作城市，出发前核对原公告。</p>
      </section>
      <p className="plan-privacy">收藏和投递记录保存在当前浏览器；换设备前请导出备份。</p>
    </aside>
  );
}
