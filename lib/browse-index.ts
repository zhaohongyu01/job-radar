import type { Job } from './jobs.ts';
import { duplicateSourceNames, hasLongTermText, hasSelectionNotice, meaningfulChangeDates,
  mergeDuplicateOpportunities, parseSalaryRange, positionChangeDates } from './jobs.ts';
import { extractSalary } from './salary-display.ts';

/** Build with the same domain functions used by legacy browsers. Full records
 * remain canonical; only the optional browsing projection is abbreviated. */
export function projectBrowsingJobs(input: Job[]) {
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
    for (const field of ['body', 'timeline', 'duplicate_sources', 'classification_note'] as const) delete result[field];
    // Only the visual two-line preview is shortened. Search receives the original
    // excerpt, and all detail fields remain in the canonical detail assets.
    result.excerpt = Array.from(job.excerpt || '').slice(0, 120).join('');
    return result;
  });
  return { jobs, excerpts };
}

export function validateBrowsingJob(job: Job): void {
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
