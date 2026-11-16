import { citiesInText } from './cities.ts';
import { positionMatchesMajor } from './job-major-matcher.ts';
import type { PositionRequirement } from './jobs.ts';

export type PositionCriteria = {
  cities: string[];
  education: string;
  major: string;
  year: string;
  includeUnknown: boolean;
  includeUnlimitedMajor?: boolean;
};

const EDU_RANK: Record<string, number> = {
  大专: 1,
  专科: 1,
  本科: 2,
  硕士: 3,
  硕士研究生: 3,
  博士: 4,
  博士研究生: 4,
};

export function matchesEducationRequirement(
  actualRaw: string | null | undefined,
  selectedEdu: string,
  includeUnknown: boolean,
): boolean {
  if (!selectedEdu || selectedEdu === '全部' || selectedEdu === '不限') return true;
  const cleaned = (actualRaw ?? '')
    .replace(/(?:20)?\d{2}\s*届(?:[\s,/、，|-]*(?:20)?\d{2}\s*届)*/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,/、，|-]+|[\s,/、，|-]+$/g, '')
    .trim();
  if (
    !cleaned ||
    cleaned === '未明确' ||
    cleaned === '未明确 / 见原公告' ||
    cleaned === '学历待核实' ||
    cleaned === '学历待确认' ||
    cleaned === '招聘条件待核实'
  ) {
    return includeUnknown;
  }
  if (/不限/.test(cleaned)) return true;

  const userRank = EDU_RANK[selectedEdu];
  if (!userRank) return cleaned.includes(selectedEdu);

  const ranks: number[] = [];
  if (/大专|专科|高职/.test(cleaned)) ranks.push(1);
  if (/本科|学士/.test(cleaned)) ranks.push(2);
  if (/硕士/.test(cleaned)) ranks.push(3);
  if (/博士/.test(cleaned)) ranks.push(4);
  if (!ranks.includes(3) && !ranks.includes(4) && /研究生/.test(cleaned)) {
    ranks.push(3, 4);
  }
  if (ranks.length === 0) return cleaned.includes(selectedEdu);
  if (ranks.includes(userRank)) return true;

  const hasAbove = /及以上|以上|起/.test(cleaned);
  const hasBelow = /及以下|以下/.test(cleaned);
  if (hasAbove && hasBelow) {
    return userRank >= Math.min(...ranks) && userRank <= Math.max(...ranks);
  }
  if (hasAbove) return userRank >= Math.min(...ranks);
  if (hasBelow) return userRank <= Math.max(...ranks);
  return false;
}

/** Every active constraint must concern the SAME row of the source position table. */
export function positionMatches(position: PositionRequirement, criteria: PositionCriteria): boolean {
  const matches = (actual: string | undefined, expected: string) =>
    !expected || expected === '全部' || (!actual ? criteria.includeUnknown : actual.includes(expected));
  const cities = citiesInText(position.city || '', true);
  return (
    (!criteria.cities.length ||
      (cities.length ? criteria.cities.some((c) => cities.includes(c)) : criteria.includeUnknown)) &&
    matchesEducationRequirement(position.education, criteria.education, criteria.includeUnknown) &&
    positionMatchesMajor(position, criteria.major, { includeUnlimited: criteria.includeUnlimitedMajor }) &&
    matches(position.cohort, criteria.year)
  );
}
