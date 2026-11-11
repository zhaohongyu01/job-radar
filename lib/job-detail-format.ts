import type { Job } from './jobs.ts';
import { cardJobTitle, displayJobTitle, formatCompanyDisplay, stripTrailingAtsCode } from './jobs.ts';
import { extractSalary } from './salary-display.ts';

const SHANDONG_CITY_SET = new Set([
  '济南', '青岛', '淄博', '枣庄', '东营', '烟台', '潍坊', '济宁',
  '泰安', '威海', '日照', '临沂', '德州', '聊城', '滨州', '菏泽',
]);

const TRAILING_ATS_EXTRACT_RE =
  /[（([\s]*(?:岗位编号|职位编号|编号|Job\s*ID|Req\s*ID)?[:：\s]*([A-Za-z]{1,4}[-_]?\d{3,10}|\d{5,10})[)）\]\s]*$/i;

const PROVINCE_PREFIX_RE =
  /(?:河北|山西|辽宁|吉林|黑龙江|江苏|浙江|安徽|福建|江西|山东|河南|湖北|湖南|广东|海南|四川|贵州|云南|陕西|甘肃|青海|台湾|内蒙古|广西|西藏|宁夏|新疆)(?:壮族自治区|维吾尔自治区|回族自治区|自治区|省)?[·.\s]*(?=(?!省|自治区)[\u4e00-\u9fa5])/g;

const CONTAMINATED_DUTY_SPLIT_RE =
  /(?:^|[；;：:\s])\d{1,2}[.、．]\s*(?:承接|负责|参与|协助|制定|开拓|跟进|完成|维护|独立|熟悉|具备|掌握|支持|主导|组织|开展|学习|配合|对接)/;

const PROVENANCE_DISCLAIMER_RE =
  /^此条为第三方公开招聘线索[，,].*请打开来源核对投递方式[。.]?$/;

const SDU_STANDALONE_LABELS = new Set([
  '招聘信息',
  '标题',
  '招聘截止日期',
  '应聘网址',
  '简历投递邮箱',
]);

const REDUNDANT_COMPANY_KEYS = new Set([
  '招聘单位', '所属企业', '单位名称', '公司名称', '企业名称', '用人单位', '企业', '公司',
]);

const REDUNDANT_TITLE_KEYS = new Set([
  '岗位名称', '职位名称', '招聘职位名称',
]);

const LOCATION_META_KEYS = new Set([
  '工作地点', '工作城市', '工作地区', '工作地域', '统一分配工作地点',
]);

const DEADLINE_META_KEYS = new Set([
  '报名截止', '报名截止时间', '截止时间', '截止日期', '招聘截止日期', '有效日期', '报备截止',
]);

const BATCH_META_KEYS = new Set([
  '招聘批次', '招聘类型', '工作性质', '招聘性质',
]);

const URL_EMAIL_META_KEYS = new Set([
  '网申或官网', '职位投递网址链接', '应聘网址', '网申地址', '投递链接', '简历投递邮箱', '投递邮箱',
]);

const PROMOTED_META_LABEL_MAP: Record<string, string> = {
  岗位类别: '岗位类别',
  职位类别: '岗位类别',
  职能类别: '岗位类别',
  专业要求: '专业要求',
  需求专业: '专业要求',
  所需专业: '专业要求',
  专业方向: '专业要求',
  薪资: '薪资参考',
  薪资待遇: '薪资参考',
  薪资状况: '薪资参考',
  薪酬: '薪资参考',
  薪酬待遇: '薪资参考',
  月薪: '薪资参考',
  年薪: '薪资参考',
  招聘人数: '招聘人数',
  需求人数: '招聘人数',
  拟招人数: '招聘人数',
  所属部门: '所属部门',
  用人部门: '所属部门',
  部门: '所属部门',
  单位性质: '单位性质',
  企业性质: '单位性质',
  所属行业: '所属行业',
  行业类别: '所属行业',
  详细地址: '详细地址',
  单位地址: '详细地址',
  公司地址: '详细地址',
  联系人: '联系人',
  联系电话: '联系电话',
  年龄要求: '年龄要求',
  外语要求: '外语要求',
  工作经验: '经验要求',
};

const KNOWN_SECTION_KEYWORDS = [
  '单位介绍', '单位简介', '公司介绍', '公司简介', '企业介绍', '企业简介', '集团简介', '企业概况', '公司概况', '关于我们',
  '岗位职责', '工作职责', '职位职责', '岗位描述', '职位描述', '工作内容', '工作任务', '职责描述',
  '任职要求', '任职资格', '任职条件', '岗位要求', '应聘条件', '应聘要求', '资格条件', '基本条件', '招聘条件', '报名条件', '选聘条件', '招聘对象',
  '招聘岗位', '需求岗位', '热招岗位', '招聘职位', '招聘方向', '招聘计划', '岗位需求',
  '薪资福利', '薪酬福利', '福利待遇', '薪资待遇', '薪酬待遇', '福利保障', '我们提供',
  '培养发展', '晋升发展', '职业发展', '人才培养',
  '招聘流程', '应聘流程', '面试流程', '选拔流程',
  '投递方式', '报名方式', '应聘方式', '简历投递', '联系方式', '联系我们',
  '注意事项', '其他说明', '温馨提示', '招聘简章', '招聘附件',
];

const KNOWN_SECTION_SET = new Set(KNOWN_SECTION_KEYWORDS);

const NUMBERED_BRACKET_HEADING_RE =
  /^\s*(?:([一二三四五六七八九十]+、[^\n]{1,28})|(（[一二三四五六七八九十]+）[^\n]{1,28})|(【[^】]{2,20}】[^\n]{0,20}))\s*$/;

const STANDALONE_KEYWORD_HEADING_RE = new RegExp(
  `^\\s*(?:[一二三四五六七八九十\\d]+[、.．)）]\\s*|[【（(\\[])?(${KNOWN_SECTION_KEYWORDS.join('|')})(?:[】）)\\]])?\\s*[:：]?\\s*$`,
);

const INLINE_KEYWORD_PREFIX_RE = new RegExp(
  `^\\s*(${KNOWN_SECTION_KEYWORDS.join('|')})\\s*[:：]+\\s*(.+)$`,
);

const SINGLE_ROLE_LINE_RE = /^(?:招聘)?岗位\s*[:：]\s*(.{1,64})$/;

const LIST_ITEM_RE =
  /^\s*(?:(\d{1,2})[.、．)）]|[（(](\d{1,2})[)）]|([①②③④⑤⑥⑦⑧⑨⑩])|([•·▪▫●○])|[-*]\s+)\s*(.+)$/;

export interface DetailTitleInfo {
  title: string;
  atsCode: string | null;
  salary: string | null;
  displayCompany: string;
}

export function formatDetailTitle(
  job: Pick<Job, 'title' | 'company' | 'source_id' | 'excerpt' | 'body' | 'listing_facts'>,
): DetailTitleInfo {
  const baseTitle = displayJobTitle(job);
  const { cleanTitle, salary } = extractSalary({ ...job, title: baseTitle });
  const atsMatch = TRAILING_ATS_EXTRACT_RE.exec(cleanTitle);
  const rawCode = atsMatch?.[1]?.trim() || null;
  const atsCode = rawCode && !/^20\d{2}$/.test(rawCode) ? rawCode : null;
  const withoutAts = stripTrailingAtsCode(cleanTitle);
  const { displayCompany } = formatCompanyDisplay(job.company, withoutAts, job.source_id);
  const dedupedTitle = job.company
    ? cardJobTitle(withoutAts, job.company, displayCompany)
    : withoutAts;

  return {
    title: dedupedTitle || withoutAts || baseTitle,
    atsCode,
    salary,
    displayCompany,
  };
}

export interface LocationPresentation {
  chips: string[];
  prioritizedCount: number;
  supplement: string | null;
  fallbackText: string;
}

function isRedundantWithCities(segment: string, cities: string[]): boolean {
  if (!cities.length) return false;
  let remainder = segment.replace(PROVINCE_PREFIX_RE, '');
  const sortedCities = [...cities].sort((a, b) => b.length - a.length);
  for (const city of sortedCities) {
    if (!city) continue;
    const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    remainder = remainder.replace(new RegExp(`${escaped}市?`, 'g'), '');
  }
  remainder = remainder.replace(/[、/，,；;·.\s（）()【】[\]均在及等各]+/g, '');
  return remainder.length === 0;
}

function cleanLocationSegment(raw: string): string {
  let text = raw
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^(?:由[^，,：:]{1,20}统一分配)?(?:统一分配)?工作(?:地点|城市|地域|地区)\s*[:：]+\s*/g, '')
    .replace(/^原文工作地域\s*[:：]+\s*/g, '')
    .trim();

  const dutySplit = CONTAMINATED_DUTY_SPLIT_RE.exec(text);
  if (dutySplit) {
    text = text.slice(0, dutySplit.index).trim();
  }

  // Strip repeated inner "工作地点:" if empty or contaminated
  text = text
    .replace(/[；;。\s]*工作(?:地点|城市)\s*[:：]*\s*$/g, '')
    .replace(/^[·:：、，,；;\s]+|[；;。，,\s]+$/g, '')
    .trim();

  if (!text || text.length > 100) return '';
  if (/承接|业绩指标|岗位职责|任职要求|完成.*目标|负责.*工作/.test(text)) return '';
  return text;
}

export function buildLocationPresentation(
  job: Pick<Job, 'cities' | 'location_evidence'>,
  preferredCities: string[] = [],
): LocationPresentation {
  const preferredSet = new Set(preferredCities.map((c) => c.trim()).filter(Boolean));
  const uniqueCities = Array.from(new Set((job.cities ?? []).map((c) => c.trim()).filter(Boolean)));

  const tier0: string[] = [];
  const tier1: string[] = [];
  const tier2: string[] = [];
  for (const city of uniqueCities) {
    if (preferredSet.has(city)) tier0.push(city);
    else if (SHANDONG_CITY_SET.has(city)) tier1.push(city);
    else tier2.push(city);
  }
  const chips = [...tier0, ...tier1, ...tier2];
  const prioritizedCount = tier0.length + tier1.length;

  const supplements: string[] = [];
  for (const rawItem of job.location_evidence ?? []) {
    for (const part of rawItem.split(/[；;\n]+/)) {
      const cleaned = cleanLocationSegment(part);
      if (!cleaned) continue;
      if (isRedundantWithCities(cleaned, chips)) continue;
      if (!supplements.includes(cleaned)) {
        supplements.push(cleaned);
      }
    }
  }

  const supplement = supplements.length > 0 ? supplements.join('；').slice(0, 140) : null;
  return {
    chips,
    prioritizedCount,
    supplement,
    fallbackText: supplement || '原公告未注明具体城市',
  };
}

export interface ExtractedMetaItem {
  label: string;
  value: string;
}

export type BodyBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'roles'; items: string[] };

export interface StructuredSection {
  id: string;
  heading?: string;
  shortLabel?: string;
  blocks: BodyBlock[];
}

export interface StructuredJobBody {
  extractedEducation: string | null;
  extractedDeadline: string | null;
  extractedLocationSupplement: string | null;
  extraMeta: ExtractedMetaItem[];
  sections: StructuredSection[];
  sourceDisclaimer: string | null;
}

function makeShortLabel(heading: string): string {
  return heading
    .replace(/^[一二三四五六七八九十\d]+[、.．)）]\s*/, '')
    .replace(/^（[一二三四五六七八九十\d]+）\s*/, '')
    .replace(/^【([^】]+)】.*$/, '$1')
    .trim()
    .slice(0, 8);
}

function splitInlineNumberedItems(line: string): string[] {
  const matches = line.match(/(?:^|[。；;！!\s])\d{1,2}[.、．]\s*[^\d\s]/g);
  if (!matches || matches.length < 2) return [line];
  return line
    .split(/(?<=[。；;！!])\s*(?=\d{1,2}[.、．]\s*[^\d\s])/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function detectHeadingLine(trimmed: string): { heading: string; remainder?: string } | null {
  if (!trimmed) return null;

  if (NUMBERED_BRACKET_HEADING_RE.test(trimmed) && trimmed.length <= 34) {
    return { heading: trimmed.replace(/\s*[:：]\s*$/, '') };
  }

  const standaloneMatch = STANDALONE_KEYWORD_HEADING_RE.exec(trimmed);
  if (standaloneMatch) {
    return { heading: trimmed.replace(/\s*[:：]\s*$/, '') };
  }

  const inlineMatch = INLINE_KEYWORD_PREFIX_RE.exec(trimmed);
  if (inlineMatch) {
    const keyword = inlineMatch[1];
    const rest = inlineMatch[2].trim();
    if (!rest) return { heading: keyword };
    const nested = detectHeadingLine(rest);
    if (nested) {
      return { heading: nested.heading, remainder: nested.remainder };
    }
    return { heading: keyword, remainder: rest };
  }

  return null;
}

function blocksFromLines(lines: string[]): BodyBlock[] {
  const expanded: string[] = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    for (const piece of splitInlineNumberedItems(trimmed)) {
      expanded.push(piece);
    }
  }

  const blocks: BodyBlock[] = [];
  let i = 0;
  while (i < expanded.length) {
    const line = expanded[i];

    // Check for 2+ consecutive "岗位：xxx" lines
    const roleMatch = SINGLE_ROLE_LINE_RE.exec(line);
    if (roleMatch && i + 1 < expanded.length && SINGLE_ROLE_LINE_RE.test(expanded[i + 1])) {
      const roles: string[] = [];
      while (i < expanded.length) {
        const m = SINGLE_ROLE_LINE_RE.exec(expanded[i]);
        if (!m) break;
        const val = m[1].trim();
        if (val && !roles.includes(val)) roles.push(val);
        i += 1;
      }
      if (roles.length > 0) {
        blocks.push({ type: 'roles', items: roles });
        continue;
      }
    }

    // Check for numbered or bulleted list items
    const listMatch = LIST_ITEM_RE.exec(line);
    if (listMatch) {
      const isOrdered = Boolean(listMatch[1] || listMatch[2] || listMatch[3]);
      const items: string[] = [];
      while (i < expanded.length) {
        const m = LIST_ITEM_RE.exec(expanded[i]);
        if (!m) break;
        const itemOrdered = Boolean(m[1] || m[2] || m[3]);
        if (itemOrdered !== isOrdered && items.length > 0) break;
        items.push(m[5].trim());
        i += 1;
      }
      if (items.length > 0) {
        blocks.push({ type: 'list', ordered: isOrdered, items });
        continue;
      }
    }

    blocks.push({ type: 'paragraph', text: line });
    i += 1;
  }

  return blocks;
}

export function parseStructuredJobBody(
  job: Pick<Job, 'title' | 'company' | 'body' | 'cities' | 'education' | 'deadline' | 'types' | 'graduation_years'>,
  overrideBody?: string | null,
): StructuredJobBody {
  const raw = overrideBody !== undefined ? overrideBody : job.body;
  if (!raw || !raw.trim()) {
    return {
      extractedEducation: null,
      extractedDeadline: null,
      extractedLocationSupplement: null,
      extraMeta: [],
      sections: [],
      sourceDisclaimer: null,
    };
  }

  const normalizedLines = raw
    .replace(/\r\n?/g, '\n')
    .replace(/：：+/g, '：')
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim());

  let extractedEducation: string | null = null;
  let extractedDeadline: string | null = null;
  let extractedLocationSupplement: string | null = null;
  let sourceDisclaimer: string | null = null;
  const extraMeta: ExtractedMetaItem[] = [];
  const pushMeta = (label: string, value: string) => {
    const cleanVal = value.trim();
    if (!cleanVal || cleanVal === '-' || cleanVal === '无' || cleanVal === '暂无') return;
    if (!extraMeta.some((m) => m.label === label && m.value === cleanVal)) {
      extraMeta.push({ label, value: cleanVal });
    }
  };

  // Strip trailing third-party provenance disclaimer line if present
  let endIdx = normalizedLines.length;
  while (endIdx > 0 && !normalizedLines[endIdx - 1]) endIdx -= 1;
  if (endIdx > 0 && PROVENANCE_DISCLAIMER_RE.test(normalizedLines[endIdx - 1])) {
    sourceDisclaimer = normalizedLines[endIdx - 1];
    endIdx -= 1;
  }
  const workingLines = normalizedLines.slice(0, endIdx);

  // Step 1: Consume SDU-style standalone form labels at the very start
  let cursor = 0;
  while (cursor < workingLines.length && !workingLines[cursor]) cursor += 1;

  if (workingLines[cursor] === '招聘信息') {
    cursor += 1;
    while (cursor < workingLines.length) {
      const cur = workingLines[cursor];
      if (!cur) {
        cursor += 1;
        continue;
      }
      if (!SDU_STANDALONE_LABELS.has(cur)) break;
      const nextLine = workingLines[cursor + 1] ?? '';
      if (cur === '标题') {
        cursor += nextLine && !SDU_STANDALONE_LABELS.has(nextLine) && !detectHeadingLine(nextLine) ? 2 : 1;
      } else if (cur === '招聘截止日期') {
        if (nextLine && /^\d{4}-\d{2}-\d{2}/.test(nextLine)) {
          if (!job.deadline) extractedDeadline = nextLine;
          cursor += 2;
        } else {
          cursor += 1;
        }
      } else if (cur === '应聘网址') {
        cursor += nextLine && /^https?:\/\//i.test(nextLine) ? 2 : 1;
      } else if (cur === '简历投递邮箱') {
        cursor += nextLine && nextLine.includes('@') ? 2 : 1;
      } else {
        cursor += 1;
      }
    }
  }

  // Step 2: Consume leading Key: Value metadata lines before prose / headings
  const cities = job.cities ?? [];
  const eduUnspecified = !job.education || job.education.includes('未明确');

  while (cursor < workingLines.length) {
    const line = workingLines[cursor];
    if (!line) {
      cursor += 1;
      continue;
    }
    if (detectHeadingLine(line)) break;
    if (SINGLE_ROLE_LINE_RE.test(line)) break;

    const kvMatch = /^([\u4e00-\u9fa5A-Za-z]{2,10})\s*[:：]\s*(.{1,520})$/.exec(line);
    if (!kvMatch) break;

    const key = kvMatch[1].trim();
    const val = kvMatch[2].trim();
    if (KNOWN_SECTION_SET.has(key)) break;
    if (!LOCATION_META_KEYS.has(key) && val.length > 160) break;

    if (REDUNDANT_COMPANY_KEYS.has(key)) {
      if (job.company && (val.includes(job.company) || job.company.includes(val))) {
        cursor += 1;
        continue;
      }
      if (job.title && job.title.includes(val)) {
        cursor += 1;
        continue;
      }
      pushMeta('招聘单位', val);
      cursor += 1;
      continue;
    }

    if (REDUNDANT_TITLE_KEYS.has(key)) {
      const cleanVal = stripTrailingAtsCode(val);
      const cleanJobTitle = stripTrailingAtsCode(job.title || '');
      if (cleanJobTitle && (cleanVal === cleanJobTitle || cleanJobTitle.includes(cleanVal) || cleanVal.includes(cleanJobTitle))) {
        cursor += 1;
        continue;
      }
      pushMeta('招聘岗位', val);
      cursor += 1;
      continue;
    }

    if (LOCATION_META_KEYS.has(key)) {
      // Check if contaminated with duties (e.g. "统一分配工作地点： 1. 承接公司销售目标...")
      const dutySplit = CONTAMINATED_DUTY_SPLIT_RE.exec(val);
      if (dutySplit) {
        const locPart = cleanLocationSegment(val.slice(0, dutySplit.index));
        if (locPart && !isRedundantWithCities(locPart, cities)) {
          extractedLocationSupplement = locPart;
        }
        const dutyRest = val.slice(dutySplit.index).replace(/^[；;：:\s]+/, '').trim();
        if (dutyRest) {
          workingLines[cursor] = `岗位职责：${dutyRest}`;
        } else {
          cursor += 1;
        }
        break;
      }
      const cleanedLoc = cleanLocationSegment(val);
      if (cleanedLoc && !isRedundantWithCities(cleanedLoc, cities)) {
        extractedLocationSupplement = cleanedLoc;
      }
      cursor += 1;
      continue;
    }

    if (DEADLINE_META_KEYS.has(key)) {
      if (!job.deadline && val) {
        extractedDeadline = val;
      }
      cursor += 1;
      continue;
    }

    if (BATCH_META_KEYS.has(key)) {
      const hasYear = (job.graduation_years ?? []).some((y) => val.includes(y));
      const hasCampus = (job.types ?? []).includes('校招') && /校招|校园招聘|应届/.test(val);
      if (!hasYear && !hasCampus && val.length <= 24) {
        pushMeta(key, val);
      }
      cursor += 1;
      continue;
    }

    if (key === '学历要求' || key === '学历' || key === '毕业届别与学历') {
      if (eduUnspecified && val && !val.includes('未明确')) {
        if (val.length <= 16) {
          extractedEducation = val;
        } else {
          pushMeta('学历说明', val);
        }
      } else if (val.length > 10 && val !== job.education) {
        pushMeta('学历说明', val);
      }
      cursor += 1;
      continue;
    }

    if (key === '招聘岗位' && val.length <= 60) {
      pushMeta('招聘岗位', val);
      cursor += 1;
      continue;
    }

    if (URL_EMAIL_META_KEYS.has(key)) {
      cursor += 1;
      continue;
    }

    const promotedLabel = PROMOTED_META_LABEL_MAP[key];
    if (promotedLabel) {
      if (promotedLabel === '薪资参考' && /^(?:面议|薪资面议|待定|面谈)$/.test(val)) {
        cursor += 1;
        continue;
      }
      const formattedVal =
        promotedLabel === '招聘人数' && /^\d+$/.test(val) ? `${val}人` : val;
      pushMeta(promotedLabel, formattedVal);
      cursor += 1;
      continue;
    }

    // Unknown Key: Value — stop metadata stripping so we never swallow real content
    break;
  }

  // Fallback education rescue from numbered/prose requirement lines when top-level education is unspecified
  if (eduUnspecified && !extractedEducation) {
    for (let i = cursor; i < workingLines.length; i += 1) {
      const eduMatch = /(?:^|[\d.、．)）\s])学历(?:要求)?\s*[:：]\s*((?:博士研究生|硕士研究生|大专|专科|本科|硕士|博士)(?:及以上)?)(?:学历)?(?=[；;。，,\s]|$)/.exec(
        workingLines[i],
      );
      if (eduMatch) {
        extractedEducation = eduMatch[1];
        break;
      }
    }
  }

  // Step 3: Parse remaining lines into structured sections
  const sections: StructuredSection[] = [];
  let currentHeading: string | undefined;
  let currentShortLabel: string | undefined;
  let buffer: string[] = [];

  const flushSection = () => {
    const blocks = blocksFromLines(buffer);
    if (currentHeading || blocks.length > 0) {
      sections.push({
        id: `drawer-body-sec-${sections.length}`,
        heading: currentHeading,
        shortLabel: currentShortLabel,
        blocks,
      });
    }
    buffer = [];
  };

  for (let i = cursor; i < workingLines.length; i += 1) {
    const trimmed = workingLines[i];
    if (!trimmed) continue;

    const detected = detectHeadingLine(trimmed);
    if (detected) {
      flushSection();
      currentHeading = detected.heading;
      currentShortLabel = makeShortLabel(detected.heading);
      if (detected.remainder) {
        buffer.push(detected.remainder);
      }
    } else {
      buffer.push(trimmed);
    }
  }
  flushSection();

  return {
    extractedEducation,
    extractedDeadline,
    extractedLocationSupplement,
    extraMeta,
    sections,
    sourceDisclaimer,
  };
}
