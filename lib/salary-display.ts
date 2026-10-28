import { displayJobTitle } from './jobs.ts';
import type { Job } from './jobs.ts';

export function extractSalary(job: Job): {
  cleanTitle: string;
  salary: string | null;
} {
  if (job.listing_facts?.version === 1) return job.listing_facts.salary_display || { cleanTitle: displayJobTitle(job) || job.title, salary: null };
  let cleanTitle = displayJobTitle(job);
  let salary: string | null = null;
  const titleSalaryRegex =
    /(?:[（(])?(\d+(?:\.\d+)?(?:k|K|万|元)?\s*[-~至–]\s*\d+(?:\.\d+)?(?:k|K|万|元)?(?:·\d+薪)?(?:元|\/月|\/年|\/天)?)(?:[)）])?$/;
  const match = cleanTitle.match(titleSalaryRegex);
  if (match) {
    salary = match[1].trim();
    cleanTitle = cleanTitle.replace(titleSalaryRegex, '').trim();
  } else {
    const excerptMatch = job.excerpt?.match(
      /薪资(?:待遇)?[:：]\s*([^\s,，;；\n*]+)/,
    );
    if (
      excerptMatch &&
      /\d/.test(excerptMatch[1]) &&
      excerptMatch[1].length <= 24
    ) {
      // Keep the numeric pay expression; adjacent benefit prose belongs in
      // the announcement, not the narrow salary badge on a phone.
      salary = excerptMatch[1].match(/^\d+(?:\.\d+)?(?:[kK万wW元])?(?:\s*[-~至–]\s*\d+(?:\.\d+)?(?:[kK万wW元])?)?(?:元)?(?:\/(?:小时|月|年|天|日))?(?:·\d+薪)?/)?.[0] || null;
    }
  }
  return { cleanTitle: cleanTitle || job.title, salary };
}

