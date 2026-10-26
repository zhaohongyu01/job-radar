import { citiesInText } from './cities.ts';
import type { PositionRequirement } from './jobs.ts';

export type PositionCriteria = { cities: string[]; education: string; major: string; year: string; includeUnknown: boolean };
/** Every active constraint must concern the SAME row of the source position table. */
export function positionMatches(position: PositionRequirement, criteria: PositionCriteria): boolean {
  const matches = (actual: string | undefined, expected: string) => !expected || expected === '全部' || (!actual ? criteria.includeUnknown : actual.includes(expected));
  const cities = citiesInText(position.city || '', true);
  return (!criteria.cities.length || (cities.length ? criteria.cities.some((c) => cities.includes(c)) : criteria.includeUnknown))
    && matches(position.education, criteria.education)
    && matches(position.majors?.join(' '), criteria.major)
    && matches(position.cohort, criteria.year);
}
