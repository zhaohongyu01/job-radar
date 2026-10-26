export type CalendarSourceCoverage = {
  id: string; school?: string; status: string;
  last_success_at?: string | null; last_list_read_at?: string | null;
  latest_calendar_date?: string | null; window_complete: boolean;
  pending_details: number; coverage?: string | null; error?: string | null;
};
export type CityCoverage = {
  city: string; local_sources: string[]; calendar_sources: CalendarSourceCoverage[];
  schools: string[]; planned_schools: string[]; unknown_events: number; upcoming_events: number;
};
export type CoverageReport = { schema_version: 1; as_of: string; cities: Record<string, CityCoverage>; schools: string[]; national_sources: string[]; note: string };

export function agendaCoverageMessage(coverage: CityCoverage | undefined, now: number): string {
  if (!coverage) return '尚无该城市的覆盖报告，当前日程可能不完整。';
  if (!coverage.calendar_sources.length) return '尚未接入该城市的本地宣讲日历；全国招聘机会仍可查看。';
  const incomplete = coverage.calendar_sources.filter((source) => source.status !== 'ok' || !source.last_success_at || now - Date.parse(source.last_success_at) > 24 * 3600000);
  const stale = coverage.calendar_sources.some((source) => source.latest_calendar_date && now - Date.parse(`${source.latest_calendar_date}T23:59:00+08:00`) > 30 * 86400000);
  if (incomplete.length) return `${incomplete.length} 个日历渠道尚未成功更新，当前安排可能不全。`;
  if (stale) return '部分日历渠道内容较旧，需核对学校的新入口。';
  if (coverage.unknown_events) return `有 ${coverage.unknown_events} 场举办地点待确认，可切换全部城市并按学校查看。`;
  if (coverage.calendar_sources.some((source) => !source.window_complete)) return '已检查已接学校的最新页，更多安排仍可能在补齐。';
  return '已接学校在本次核验范围内暂未发现其他后续安排。';
}
