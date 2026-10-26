import { CITY_REGISTRY } from './cities.generated.ts';

export const ALL_CITIES = CITY_REGISTRY.cities.map((row) => row.name);
export const PROVINCE_CITIES: Record<string, string[]> = {};
const aliases = new Map<string, Set<string>>();
const counties = new Map<string, Set<string>>();
for (const row of CITY_REGISTRY.cities) {
  (PROVINCE_CITIES[row.province] ??= []).push(row.name);
  for (const alias of row.aliases) {
    if (!aliases.has(alias)) aliases.set(alias, new Set());
    aliases.get(alias)!.add(row.name);
  }
}
for (const row of CITY_REGISTRY.counties) {
  if (!counties.has(row.name)) counties.set(row.name, new Set());
  counties.get(row.name)!.add(row.city);
}
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pattern = (keys: Iterable<string>) => [...keys].sort((a, b) => b.length - a.length || a.localeCompare(b)).map(escape).join('|');
const cityPattern = pattern(aliases.keys());
const countyPattern = pattern(counties.keys());
const cityMatcher = new RegExp(cityPattern, 'g');
const countyMatcher = new RegExp(countyPattern, 'g');
const order = new Map(ALL_CITIES.map((city, index) => [city, index]));
const textCities = new Map<string, string[]>();

export function citiesInText(text: string, inferCounties = false): string[] {
  const key = `${Number(inferCounties)}:${text}`;
  const cached = textCities.get(key);
  if (cached) return [...cached];
  const found = new Set<string>();
  for (const match of text.matchAll(cityMatcher)) {
    const name = match[0];
    const index = match.index;
    if (name === '佛山' && text[index - 1] === '千') continue;
    if (['吉林', '海南', '朝阳'].includes(name) && ['省', '区'].includes(text[index + name.length])) continue;
    const candidates = aliases.get(name)!;
    if (candidates.size === 1) for (const city of candidates) found.add(city);
  }
  if (inferCounties && !found.size) {
    for (const match of text.matchAll(countyMatcher)) {
      const candidates = counties.get(match[0])!;
      const scoped = candidates.size === 1 ? [...candidates] : [...candidates].filter((city) =>
        Object.entries(PROVINCE_CITIES).some(([province, cities]) => text.includes(province) && cities.includes(city)),
      );
      if (scoped.length === 1) found.add(scoped[0]);
    }
  }
  const result = [...found].sort((a, b) => order.get(a)! - order.get(b)!);
  if (text.length <= 2000) {
    if (textCities.size >= 4096) textCities.delete(textCities.keys().next().value!);
    textCities.set(key, result);
  }
  return [...result];
}

export function workplaceEvidence(lines: string[]): string[] {
  return lines.filter((line) => !/^(?:用人单位所在地|单位所在地|企业所在地|分支机构线索|举办地点|宣讲地点)/.test(line)
    && !/标题\/单位(?:标注地点|明确企事业单位或机构|明确分支机构)/.test(line));
}

export function normalizeCity(value: string): string | null {
  const candidates = aliases.get(value);
  return candidates?.size === 1 ? [...candidates][0] : null;
}
