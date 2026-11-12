import type { Job } from './jobs.ts';
import { duplicateSourceNames, hasLongTermText, hasSelectionNotice, meaningfulChangeDates,
  mergeDuplicateOpportunities, parseSalaryRange, positionChangeDates } from './jobs.ts';
import { extractSalary } from './salary-display.ts';
import { buildCardSummaries, extractCardSummary, validateCardSummary } from './card-summary.ts';
import { extractProseMajorsFromText, extractProseSamplePositions } from './job-major-matcher.ts';

export const BROWSE_EXCERPT_LIMIT = 90;

function trimBrowseExcerpt(value: string): string {
  const chars = Array.from(value || '');
  return chars.length <= BROWSE_EXCERPT_LIMIT
    ? value || ''
    : chars.slice(0, BROWSE_EXCERPT_LIMIT - 1).join('').trimEnd() + '…';
}

/** Build with the same domain functions used by legacy browsers. Full records
 * remain canonical; only the optional browsing projection is abbreviated. */
export function projectBrowsingJobs(input: Job[], fullText: Readonly<Record<string, string>> = {}) {
  const summaries = buildCardSummaries(input, fullText);
  const merged = mergeDuplicateOpportunities(structuredClone(input));
  const excerpts: Record<string, string> = {};
  const jobs = merged.map((job): Job => {
    if (job.listing_facts) throw Error('Browsing projection requires canonical records');
    const salary = parseSalaryRange(job);
    // Version 1 defaults: absent flags=false, dates/sources=[], salary=unknown.
    // This keeps negative evidence explicit in the versioned contract without
    // repeating long empty field names for every opportunity.
    const listing_facts: NonNullable<Job['listing_facts']> = { version: 1 };
    if (salary) listing_facts.salary = { ...salary, max: Number.isFinite(salary.max) ? salary.max : null };
    const display = extractSalary(job);
    if (display.salary) listing_facts.salary_display = display;
    if (hasSelectionNotice(job)) listing_facts.selection_notice = true;
    if (hasLongTermText(job)) listing_facts.long_term = true;
    const dates = meaningfulChangeDates(job), positions = positionChangeDates(job), sources = duplicateSourceNames(job);
    if (dates.length) listing_facts.change_dates = dates;
    if (positions.length) listing_facts.position_change_dates = positions;
    if (sources.length) listing_facts.source_names = sources;
    if (job.classification_note?.startsWith('仅核实')) listing_facts.detail_pending = true;
    excerpts[job.id] = job.excerpt || '';
    const result = { ...job, listing_facts };
    if (!result.majors?.length || (!result.sample_positions?.length && !result.positions?.length && !result.position_matches?.length)) {
      const sourceProse = [
        job.body || '',
        job.excerpt || '',
        ...[job.id, ...(job.duplicate_ids ?? [])].map((id) => fullText[id] || ''),
      ]
        .filter(Boolean)
        .join('\n');
      if (sourceProse) {
        if (!result.majors?.length) {
          const proseMajors = extractProseMajorsFromText(sourceProse);
          if (proseMajors.length) result.majors = proseMajors;
        }
        if (!result.sample_positions?.length && !result.positions?.length && !result.position_matches?.length) {
          const prosePositions = extractProseSamplePositions(sourceProse);
          if (prosePositions.length) result.sample_positions = prosePositions;
        }
      }
    }
    for (const field of ['body', 'timeline', 'duplicate_sources', 'classification_note'] as const) delete result[field];
    // Version 2 keeps one display string, avoiding a second copy of the source
    // preview in every row. Original excerpts stay in canonical assets/search;
    // salary/stage/change facts above always use the original source record.
    result.excerpt = trimBrowseExcerpt(job.excerpt || '');
    const summary = summaries.get(job.id) || extractCardSummary(job);
    if (summary.kind !== 'notice') {
      const { text, ...metadata } = summary;
      result.excerpt = trimBrowseExcerpt(text);
      result.card_summary = metadata;
    }
    return result;
  });
  return { jobs, excerpts };
}

export function validateBrowsingJob(job: Job): void {
  if (job.card_summary !== undefined) validateCardSummary({ ...job.card_summary, text: job.excerpt });
  const f = job.listing_facts;
  const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');
  if (!f || f.version !== 1 || !['selection_notice', 'long_term', 'detail_pending'].every((key) => f[key as keyof typeof f] === undefined || typeof f[key as keyof typeof f] === 'boolean') ||
      ![f.change_dates, f.position_change_dates, f.source_names].every((value) => value === undefined || strings(value)) ||
      (f.salary_display !== undefined && (!f.salary_display || typeof f.salary_display.cleanTitle !== 'string' ||
        !(f.salary_display.salary === null || typeof f.salary_display.salary === 'string'))) ||
      (f.salary !== undefined && !(f.salary && Number.isFinite(f.salary.min) &&
        (f.salary.max === null || Number.isFinite(f.salary.max)) && typeof f.salary.raw === 'string')))
    throw Error('精简列表筛选依据不完整，请刷新重试。');
}
