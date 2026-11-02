import type { Job } from './jobs.ts';
import { resolveEmployer } from './employers.ts';

export type CardSummary = {
  version: 1;
  kind: 'company' | 'responsibilities' | 'notice';
  text: string;
  source_url?: string;
  source_published_at?: string | null;
};
export type CardSummaryMeta = Omit<CardSummary, 'text'>;
export const CARD_SUMMARY_LIMIT = 200;
const companyHeading = '单位介绍|单位简介|公司介绍|公司简介|企业介绍|企业简介|集团简介|企业概况|公司概况|关于我们';
const roleHeading = '岗位职责|工作职责|职位职责|岗位描述|职位描述|工作内容|工作任务';
const endHeading = `${companyHeading}|${roleHeading}|招聘岗位|需求岗位|招聘对象|招聘条件|任职要求|任职条件|岗位要求|应聘条件|薪资待遇|福利待遇|招聘流程|投递方式|报名方式|联系方式|联系人|单位地址|公司地址|报名截止`;
const headingPrefix = '(?:^|\\n|[ \t])(?:[一二三四五六七八九十\\d]+[、.．]\\s*)?[【（(\\[]?';
const headingSuffix = '(?:[】）)\\]][ \t]*[:：]?[ \t]*|[ \t]*[:：][ \t]*|[ \t]*\\n|[ \t]+)';
const metadata = /^(?:单位名称|公司名称|企业名称|招聘单位|企业|公司|职位名称|职位类别|学历要求|专业要求|薪资状况|工作性质|工作地点|招聘类型|招聘批次|招聘职位|毕业届别与学历|招聘人数|联系人|联系电话|年龄要求|外语要求|工作经验|报名截止|报备截止|职位投递网址链接)[ \t]*[:：]/;

function plainText(value: string): string {
  return value.slice(0, 40000).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<(?:br\b|\/(?:p|div|li|h[1-6]|tr)\b)[^>]*>/gi, '\n')
    .replace(/<[/a-z!][^>]*>/gi, ' ')
    .replace(/&(?:nbsp|amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, entity => {
      const named: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
      if (named[entity.toLowerCase()] !== undefined) return named[entity.toLowerCase()];
      const hex = entity.toLowerCase().startsWith('&#x');
      const code = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    }).replace(/\r\n?/g, '\n').replace(/[ \t\u00a0]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
}

function shorten(value: string): string {
  const text = value.replace(/^[\s:：*•·]+/, '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(text);
  return chars.length <= CARD_SUMMARY_LIMIT ? text : chars.slice(0, CARD_SUMMARY_LIMIT - 1).join('').trimEnd() + '…';
}

function section(text: string, headings: string): string {
  for (const start of text.matchAll(new RegExp(`${headingPrefix}(?:${headings})${headingSuffix}`, 'g'))) {
    const rest = text.slice(start.index + start[0].length);
    const end = new RegExp(`${headingPrefix}(?:${endHeading})[】）)\\]]?[ \t]*(?=[:：]|\\n|$)`).exec(rest);
    const content = (end ? rest.slice(0, end.index) : rest).trim();
    if (Array.from(content).length >= 20) return content;
  }
  return '';
}

/** Extract source text only. No generated claims, remote requests or keyword
 * inference of company size, ownership, industry or employer reputation. */
export function extractCardSummary(job: Job, fullText?: string): CardSummary {
  const text = plainText(fullText || job.body || job.excerpt || '');
  let intro = section(text, companyHeading);
  if (Array.from(intro).length < 24) {
    // Unlabelled introductions must explicitly name this employer. A general
    // sentence such as "是一家知名企业" cannot identify a different company.
    intro = text.split('\n').find(line => job.company.length >= 4 && line.includes(job.company) &&
      /成立于|始建于|创立于|是一家|主要从事|专注于|主营业务/.test(line) && !metadata.test(line)) || '';
    intro = shorten(intro);
  }
  if (Array.from(intro).length >= 24) {
    // An employer's own announcement may introduce its group first. Prefer
    // the paragraph about this unit when it is explicitly present there.
    // This short name is used only to select a paragraph inside that source,
    // never to associate introductions across companies or branches.
    const name = job.company.replace(/(?:有限责任公司|股份有限公司|有限公司|股份公司)$/, '');
    const paragraphs = intro.split('\n').map(line => line.trim()).filter(Boolean);
    if (name.length >= 4 && !paragraphs[0]?.includes(name)) {
      const relevant = paragraphs.find(line => line.includes(job.company)) || paragraphs.find(line => line.includes(name));
      if (relevant && Array.from(relevant).length >= 24) intro = relevant;
    }
    return { version: 1, kind: 'company', text: shorten(intro) };
  }
  const role = section(text, roleHeading);
  if (Array.from(role).length >= 20) return { version: 1, kind: 'responsibilities', text: shorten(role) };
  const paragraphs = text.split('\n').map(line => line.trim()).filter(line =>
    Array.from(line).length >= 24 && !metadata.test(line) && line !== job.title &&
    !/详情尚未读取|招聘详情待补全|登录后查看|仅核实列表标题|^学校官方日程/.test(line));
  const paragraph = paragraphs.find(line => /^(?:\d+[、.．]\s*)?(?:负责|参与|承担|协助)/.test(line));
  if (paragraph) return { version: 1, kind: 'responsibilities', text: shorten(paragraphs.slice(paragraphs.indexOf(paragraph)).join(' ')) };
  return { version: 1, kind: 'notice', text: shorten(paragraphs[0] || '单位介绍与岗位说明请查看原公告。') };
}

export function cardSummaryFor(job: Job): CardSummary {
  return job.card_summary?.version === 1 ? { ...job.card_summary, text: job.excerpt } : extractCardSummary(job);
}

/** Reuse an introduction only for exactly the same unambiguous full name.
 * Brands, departments, subsidiaries and branches never borrow each other's. */
export function buildCardSummaries(jobs: Job[], fullText: Readonly<Record<string, string>> = {}): Map<string, CardSummary> {
  const rows = jobs.map(job => ({ job, summary: extractCardSummary(job, fullText[job.id]), profile: resolveEmployer(job) }));
  const introductions = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    if (row.summary.kind !== 'company' || row.profile?.scope !== 'name' || row.job.company_conflict || row.job.provenance === '第三方线索') continue;
    const exactName = Array.from(row.profile.name).map(char => '\\^$.*+?()[]{}|'.includes(char) ? '\\' + char : char).join('');
    if (!new RegExp(`${exactName}(?=[\\s，。；（(、:：]|成立|始建|创立|是一家|主要|专注|$)`).test(row.summary.text.normalize('NFKC'))) continue;
    const old = introductions.get(row.profile.id);
    if (!old || (Date.parse(row.job.published_at || '') || 0) > (Date.parse(old.job.published_at || '') || 0))
      introductions.set(row.profile.id, row);
  }
  return new Map(rows.map(({ job, summary, profile }) => {
    const related = !job.company_conflict && profile?.scope === 'name' ? introductions.get(profile.id) : undefined;
    if (summary.kind !== 'company' && related && related.job.source_url !== job.source_url) {
      return [job.id, { ...related.summary, source_url: related.job.source_url, source_published_at: related.job.published_at }];
    }
    return [job.id, summary];
  }));
}

export function validateCardSummary(value: CardSummary): void {
  if (value.version !== 1 || !['company', 'responsibilities', 'notice'].includes(value.kind) ||
      typeof value.text !== 'string' || !value.text.trim() || Array.from(value.text).length > CARD_SUMMARY_LIMIT)
    throw Error('岗位卡片摘要格式异常。');
  if (value.source_url !== undefined) {
    if (typeof value.source_url !== 'string' || value.source_url.length > 2048) throw Error('单位介绍来源异常。');
    const url = new URL(value.source_url);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error('单位介绍来源异常。');
  }
  if (value.source_published_at !== undefined && value.source_published_at !== null &&
      (typeof value.source_published_at !== 'string' || !Number.isFinite(Date.parse(value.source_published_at))))
    throw Error('单位介绍来源日期异常。');
}
