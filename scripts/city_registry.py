"""Versioned offline geography. A city being selectable does not imply source coverage."""
from functools import lru_cache
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = json.loads((ROOT / 'config/cities.json').read_text(encoding='utf-8'))
CITY_ROWS = REGISTRY['cities']
CITIES = [row['name'] for row in CITY_ROWS]
if len(set(CITIES)) != len(CITIES) or len({r['code'] for r in CITY_ROWS}) != len(CITY_ROWS):
    raise ValueError('Duplicate city registry identity')
PROVINCE_CITIES = {}
ALIASES = {}
CODE_CITY = {}
for row in CITY_ROWS:
    PROVINCE_CITIES.setdefault(row['province'], []).append(row['name'])
    CODE_CITY[row['code']] = row['name']
    for alias in row['aliases']:
        ALIASES.setdefault(alias, set()).add(row['name'])
COUNTY_CITIES = {}
for row in REGISTRY['counties']:
    CODE_CITY[row['code']] = row['city']
    COUNTY_CITIES.setdefault(row['name'], set()).add(row['city'])
CITY_PATTERN = re.compile('|'.join(re.escape(k) for k in sorted(ALIASES, key=lambda s: (-len(s), s))))
COUNTY_PATTERN = re.compile('|'.join(re.escape(k) for k in sorted(COUNTY_CITIES, key=lambda s: (-len(s), s))))
CITY_ORDER = {name: i for i, name in enumerate(CITIES)}


@lru_cache(maxsize=4096)
def cities_in_text(text, infer_counties=False):
    """Only call on location facts, never whole-company introduction paragraphs."""
    found = set()
    for match in CITY_PATTERN.finditer(text):
        name = match.group()
        # Province names and venue/qualification homonyms are not city evidence.
        if (name == '佛山' and text[max(0, match.start()-1):match.start()] == '千'):
            continue
        if name in {'吉林', '海南', '朝阳'} and text[match.end():match.end()+1] in {'省', '区'}:
            continue
        candidates = ALIASES[name]
        if len(candidates) == 1:
            found.update(candidates)
    if infer_counties:
        for match in COUNTY_PATTERN.finditer(text):
            candidates = COUNTY_CITIES[match.group()]
            if found:
                continue  # explicit cities already retain their own district context
            if len(candidates) == 1:
                found.update(candidates)
            else:
                scoped = {c for c in candidates if any(p in text and c in cities for p, cities in PROVINCE_CITIES.items())}
                if len(scoped) == 1:
                    found.update(scoped)
    return tuple(sorted(found, key=CITY_ORDER.__getitem__))


def work_cities(evidence):
    result = set()
    usable = []
    for line in evidence:
        if line.startswith(('用人单位所在地', '单位所在地', '企业所在地', '分支机构线索', '举办地点', '宣讲地点')):
            continue
        if re.search(r'标题/单位标注地点|标题/单位明确企事业单位或机构|标题/单位明确分支机构', line):
            continue
        usable.append(re.sub(r'[（(][^）)]*(?:路口|高速|公里|路程)[^）)]*[）)]', '', line))
        result.update(cities_in_text(line))
        for code in re.findall(r'(?<!\d)\d{6}(?!\d)', line):
            if code in CODE_CITY:
                result.add(CODE_CITY[code])
    if not result:
        for line in usable:
            result.update(cities_in_text(line, infer_counties=True))
    return sorted(result, key=CITY_ORDER.__getitem__)


def collection_cities():
    return list(json.loads((ROOT / 'config/collection-city-plan.json').read_text(encoding='utf-8'))['offerjack_cities'])


CAMPUS_RULES = json.loads((ROOT / 'config/campus-locations.json').read_text(encoding='utf-8'))['rules']
_CAMPUS = [(rule, re.compile(rule['venue_pattern'])) for rule in CAMPUS_RULES]


def resolve_event_city(school, venue):
    if re.search(r'线上|直播|空中宣讲|腾讯会议|网络会议', venue):
        return None, {'method': 'unknown', 'reason': 'online'}
    explicit = cities_in_text(venue)
    matches = [rule for rule, pattern in _CAMPUS if rule['school'] == school and pattern.search(venue)]
    inferred = {rule['city'] for rule in matches}
    if len(explicit) > 1 or len(inferred) > 1 or (explicit and inferred and set(explicit) != inferred):
        return None, {'method': 'unknown', 'reason': 'conflicting_locations'}
    if len(explicit) == 1:
        return explicit[0], {'method': 'explicit'}
    if len(inferred) == 1:
        return next(iter(inferred)), {'method': 'campus', 'rule_id': matches[0]['id']}
    return None, {'method': 'unknown', 'reason': 'unverified_venue'}
