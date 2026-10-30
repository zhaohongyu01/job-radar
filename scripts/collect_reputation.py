"""Bounded public enterprise-page collection, independent of job collection.

Only source-provided JSON is decoded; no scripts, login, search or captcha
endpoints are executed. Public output contains short attributed excerpts, not
full posts, personal names, profiles, contacts or author IDs.
"""
import argparse
import hashlib
import html
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup
from city_registry import cities_in_text

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://www.nowcoder.com'
CHANNELS = ('discussion', 'interview')
PROMO = re.compile(r'内推码|推荐码|加群|扫码|课程推广|\breferral\b|内推链接', re.I)
FIRSTHAND = re.compile(r'(?:我|本人)(?:曾|之前)?在.{0,30}(?:工作|上班|实习|任职|待过|待了)|实习期间|工作了|干过|待过|离职(?:了|前|后)')
EXPERIENCE_TITLE = re.compile(r'实习体验|工作体验|工作感悟|入职体验|就职体验|离职感想')
QUESTION = re.compile(r'[?？]|有没有|有无|求问|求助|有人了解|想问|怎么样|是否|[吗么]$')
RULES = {
    'pay': (r'待遇不错|福利还不错|待遇很好|按时发薪|薪资待遇不错|薪资很有竞争力|福利很好', r'拖欠工资|降薪|工资偏低|薪资偏低|福利几乎为0|不发工资|奖金没发|没有加班费'),
    'worklife': (r'双休|不怎么加班|很少加班|工作量不大|压力也挺小|不强制加班', r'经常加班|每天加班|单休|大小周|加班到(?:晚上)?[89十]|加班严重|工作确实累'),
    'growth': (r'学到了不少|学到很多|导师对我非常好|晋升透明|培训完善|成长很快', r'学不到|晋升困难|没有晋升|没什么成长|一眼望到头'),
    'management': (r'同事都挺好相处|领导也没什么架子|氛围很好|氛围不错|沟通顺畅|同事很友好', r'溜须拍马|氛围很差|管理混乱|领导打压|沟通困难|强制末位'),
}


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')


def clean(value):
    return re.sub(r'\s+', ' ', BeautifulSoup(html.unescape(value or ''), 'html.parser').get_text(' ', strip=True)).strip()


def redact(text):
    text = re.sub(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[联系方式省略]', text)
    return re.sub(r'(?<!\d)1[3-9]\d{9}(?!\d)', '[联系方式省略]', text)


def is_experience(title, text):
    if QUESTION.search(title) or re.search(r'还没入职|尚未入职|考虑入职|想入职|准备入职|听说|据说', title):
        return False
    return bool(FIRSTHAND.search(text) or EXPERIENCE_TITLE.search(title))


def source_time(value, now):
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    try:
        seconds = value / 1000 if value > 10**11 else value
        if not 946684800 <= seconds <= now + 300:
            return None
        return datetime.fromtimestamp(seconds, timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    except (ValueError, OverflowError, OSError):
        return None


def extract_state(document):
    soup = BeautifulSoup(document, 'html.parser')
    for node in soup.find_all('script'):
        text = (node.string or '').strip()
        if text.startswith('window.__INITIAL_STATE__='):
            # raw_decode deliberately ignores the cleanup function after JSON.
            value, _ = json.JSONDecoder().raw_decode(text.split('=', 1)[1])
            if isinstance(value, dict):
                return value
    raise ValueError('source_initial_state_missing')


def signals_for(text):
    signals = []
    for clause in re.findall(r'[^。！？!?；;\n]+[。！？!?；;]?', text):
        if not clause or QUESTION.search(clause.rstrip('。；;')) or re.search(r'听说|据说|可能|不知道|不是不|并非没有', clause):
            continue
        for dimension, (positive, negative) in RULES.items():
            pos = re.search(positive, clause)
            neg = re.search(negative, clause)
            # Negated accusations and mixed statements are left unscored.
            if neg and re.search(r'(?:没有|并未|从不|并非).{0,5}$', clause[:neg.start()]):
                neg = None
            if pos and re.search(r'(?:不|没有|并非).{0,3}$', clause[:pos.start()]):
                pos = None
            if bool(pos) == bool(neg):
                continue
            match = pos or neg
            start = max(0, match.start() - 12)
            quote = clause[start:start + 60]
            if len(clause) > start + 60:
                quote += '…'
            signal = {'dimension': dimension, 'polarity': 1 if pos else -1, 'quote': quote}
            if not any(row['dimension'] == dimension and row['polarity'] == signal['polarity'] for row in signals):
                signals.append(signal)
            if len(signals) >= 4:
                return signals
    return signals


def attribution_for(title, text, names):
    # Only firsthand clauses explicitly naming this employer can support scores.
    # Comparisons and transitions are retained for review, never assigned by tag.
    combined = title + '。' + text
    if re.search(r'前公司|上家公司|相比|比起|对比|跳槽|离职后|入职慢脚', combined):
        return 'uncertain'
    aliases = [name for name in names if len(name) >= 2]
    if EXPERIENCE_TITLE.search(title) and any(name in title for name in aliases) and not QUESTION.search(title):
        return 'target'
    for name in aliases:
        target = re.escape(name)
        if re.search(r'(?:我|本人)(?:曾|之前)?在[“\" ]*' + target + r'.{0,12}(?:工作|上班|实习|任职|待过|待了)', text):
            return 'target'
    return 'uncertain'


def parse_page(document, enterprise_id, channel, collected_at, now=None):
    now = time.time() if now is None else now
    state = extract_state(document)
    enterprise = state.get('store', {}).get('enterprise', {})
    info = enterprise.get('enterpriseInfoNP') or {}
    basic = enterprise.get('enterpriseInfo') or {}
    if str(info.get('companyId') or basic.get('companyId')) != str(enterprise_id):
        raise ValueError('enterprise_identity_mismatch')
    names = list(dict.fromkeys(clean(info.get(key)) for key in ('companyName', 'simpleName') if clean(info.get(key))))
    if not names:
        raise ValueError('enterprise_name_missing')
    apps = [app for app in state.get('app', {}).values() if isinstance(app, dict) and isinstance(app.get('postList'), list)]
    if not apps:
        raise ValueError('public_post_list_missing')
    rows = [row for app in apps for row in app['postList']]
    records, excluded = [], 0
    for row in rows:
        content = row.get('contentData') or {}
        if not isinstance(content, dict):
            excluded += 1
            continue
        tag = row.get('evaluateSubscript') or {}
        if tag.get('companyId') and str(tag['companyId']) != str(enterprise_id):
            excluded += 1  # Cross-company recommended content is not this firm's experience.
            continue
        text, title = redact(clean(content.get('content'))), redact(clean(content.get('title')))
        if not text or not title or content.get('recommendAd') or content.get('staffAnswer') or PROMO.search(title + text) or re.search(r'内推|网申|投递入口|招聘开启|招人|捞人', title):
            excluded += 1
            continue
        content_id, uuid = str(content.get('id') or row.get('contentId') or ''), content.get('uuid')
        if uuid and re.fullmatch(r'[a-f0-9]{32}', str(uuid)):
            identity, url = str(uuid), f'{ORIGIN}/feed/main/detail/{uuid}'
        elif re.fullmatch(r'\d{1,22}', content_id):
            identity, url = content_id, f'{ORIGIN}/discuss/{content_id}'
        else:
            excluded += 1
            continue
        firsthand = is_experience(title, text)
        kind = 'interview' if channel == 'interview' else 'experience' if firsthand else 'question'
        city_match = re.search(r'(?:base\s*(?:在|地|于|[:：])?|工作地点[:：]|工作城市[:：]|坐标)\s*([^，。；;\n]{2,24})', text, re.I)
        work_cities = cities_in_text(city_match[1]) if city_match else ()
        role_match = re.search(r'(?:面试岗位|面试职位|工作岗位|岗位)\s*[:：]\s*([^，。；;\n]{2,35})', text)
        dept_match = re.search(r'(?:部门|事业部)\s*[:：]\s*([^，。；;\n]{2,24})', text)
        author = content.get('authorId')
        attribution = attribution_for(title, text, names) if kind == 'experience' else 'target'
        assessments = signals_for(text) if kind == 'experience' and attribution == 'target' else []
        # Store only a short excerpt; do not mirror full posts or author profiles.
        length = min(80, max(12, len(text) // 4))
        records.append({
            'id': 'nowcoder:' + identity, 'provider': 'nowcoder', 'url': url, 'title': title[:100],
            'attribution': attribution, 'excerpt': text[:length] + ('…' if len(text) > length else ''), 'kind': kind,
            'published_at': source_time(content.get('createTime'), now), 'collected_at': collected_at,
            'city': work_cities[0] if len(work_cities) == 1 else None, 'role': role_match[1] if role_match else None,
            'department': dept_match[1] if dept_match else None,
            'contributor': hashlib.sha256(('nowcoder:' + str(author)).encode()).hexdigest()[:24] if author else None,
            'fingerprint': hashlib.sha256(re.sub(r'\W+', '', text).encode()).hexdigest(), 'signals': assessments,
        })
    return {
        'id': f'nowcoder:{enterprise_id}', 'provider': 'nowcoder', 'names': names,
        'name': clean(info.get('simpleName') or info.get('companyName')), 'legal_name': clean(info.get('companyName')),
        'source_url': f'{ORIGIN}/enterprise/{enterprise_id}/{channel}', 'records': records,
        'channel': channel, 'excluded': excluded, 'public_rows': len(rows), 'partial': True,
    }


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    tmp.replace(path)


class PublicClient:
    def __init__(self, config, deadline):
        self.config, self.deadline, self.last, self.requests = config, deadline, 0, 0
        self.robot = None

    def get(self, path):
        if not re.fullmatch(r'/robots\.txt|/enterprise/\d+/(?:discussion|interview)(?:\?page=\d+)?', path):
            raise ValueError('unapproved_source_path')
        remaining = self.deadline - time.monotonic()
        pause = max(0, self.config['min_interval_seconds'] - (time.monotonic() - self.last))
        if remaining <= pause + 0.2:
            raise TimeoutError('run_budget_reached')
        time.sleep(pause)
        self.last = time.monotonic()
        url = ORIGIN + path
        if path != '/robots.txt' and (not self.robot or not self.robot.can_fetch(self.config['user_agent'], url)):
            raise ValueError('robots_denied')
        request = urllib.request.Request(url, headers={'User-Agent': self.config['user_agent'], 'Accept': 'text/html,text/plain'})
        self.requests += 1
        with urllib.request.urlopen(request, timeout=min(self.config['timeout_seconds'], max(0.2, self.deadline - time.monotonic()))) as response:
            target = urllib.parse.urlsplit(response.url)
            if target.hostname != 'www.nowcoder.com' or target.scheme != 'https':
                raise ValueError('source_redirected')
            data = response.read(self.config['max_response_bytes'] + 1)
            if len(data) > self.config['max_response_bytes']:
                raise ValueError('source_response_too_large')
            return data.decode('utf-8', 'replace')

    def robots(self):
        text = self.get('/robots.txt')
        if '<html' in text.lower() or 'user-agent' not in text.lower():
            raise ValueError('robots_not_available')
        self.robot = urllib.robotparser.RobotFileParser()
        self.robot.parse(text.splitlines())


def discover_enterprises(config, state, client):
    """Search candidates are untrusted until their exact source name matches."""
    known = {str(seed['id']) for seed in config['enterprises']}
    verified = state.setdefault('discovered_enterprises', {})
    for key, seed in verified.items():
        if key.isdigit() and key == str(seed.get('id')) and seed.get('expected_names') and key not in known:
            config['enterprises'].append(dict(seed, priority=config.get('_priorities', {}).get(key, seed.get('priority', 0))))
            known.add(key)
    outcomes = []
    history = state.setdefault('discovery_history', {})
    candidates = [row for row in config.get('_needs_mapping', []) if time.time() - history.get(row.get('name'), {}).get('attempt_epoch', 0) > 86400]
    original_deadline = client.deadline
    client.deadline = min(original_deadline, time.monotonic() + 25)
    for candidate in candidates[:config.get('discovery_limit', 0)]:
        if client.deadline - time.monotonic() < 5:
            break
        name = candidate.get('name', '')
        if not isinstance(name, str) or not 2 <= len(name) <= 160:
            continue
        outcome = {'name': name, 'status': 'no_verified_match'}
        try:
            query = urllib.parse.urlencode({'format': 'rss', 'q': f'site:www.nowcoder.com/enterprise/ "{name}"'})
            req = urllib.request.Request('https://www.bing.com/search?' + query, headers={'User-Agent': config['user_agent']})
            client.requests += 1
            with urllib.request.urlopen(req, timeout=5) as response:
                if urllib.parse.urlsplit(response.url).hostname != 'www.bing.com':
                    raise ValueError('search_redirected')
                raw = response.read(250001)
            if len(raw) > 250000:
                raise ValueError('search_response_too_large')
            ids = []
            for item in ET.fromstring(raw).findall('.//item'):
                match = re.fullmatch(r'https://www\.nowcoder\.com/enterprise/(\d+)(?:/(?:discussion|interview))?/?', item.findtext('link') or '')
                if match and match[1] not in known:
                    ids.append(match[1])
            matches = []
            for key in list(dict.fromkeys(ids))[:2]:
                page = parse_page(client.get(f'/enterprise/{key}/discussion'), int(key), 'discussion', stamp())
                if name in page['names']:
                    matches.append(key)
            if len(matches) == 1:
                key = matches[0]
                seed = {'id': int(key), 'expected_names': [name], 'priority': 60}
                verified[key] = seed; config['enterprises'].append(seed); known.add(key)
                outcome.update(status='verified', id=key)
            elif len(matches) > 1:
                outcome['status'] = 'ambiguous'
        except Exception as error:
            outcome.update(status='unavailable', reason=str(error)[:100])
        history[name] = {**outcome, 'attempt_epoch': time.time()}
        outcomes.append(outcome)
    client.deadline = original_deadline
    return outcomes


def collect(config, state, state_path, budget, limit, force=False):
    if config.get('schema_version') != 1 or state.get('schema_version', 1) != 1 or not isinstance(state.get('enterprises', {}), dict):
        raise ValueError('unsupported_state_or_config')
    if state.get('normalizer_version', 1) < 3:
        # Old checkpoints contain excerpts only. Conservatively demote anything
        # that no longer demonstrates firsthand experience; never invent text.
        for entry in state.get('enterprises', {}).values():
            for page in entry.get('channels', {}).values():
                for row in page.get('records', []):
                    if row['kind'] == 'experience':
                        row['attribution'] = 'uncertain'
                        row['signals'] = []  # Old excerpts cannot prove full-post attribution.
        state['normalizer_version'] = 3
    started = time.monotonic()
    client = PublicClient(config, started + budget)
    report = {'started_at': stamp(), 'requests': 0, 'attempted': 0, 'successes': 0, 'failures': 0, 'cached': 0, 'errors': []}
    state.setdefault('schema_version', 1)
    state.setdefault('enterprises', {})
    try:
        client.robots()
    except Exception as error:
        report['errors'].append({'reason': str(error)[:160]})
        report.update(elapsed_seconds=round(time.monotonic() - started, 2), requests=client.requests)
        return state, report
    report['discovery'] = discover_enterprises(config, state, client)
    seeds = sorted(config['enterprises'], key=lambda item: (-item.get('priority', 0), state['enterprises'].get(str(item['id']), {}).get('last_attempt_at', '')))
    consecutive_blocks = 0
    for seed in seeds:
        if report['attempted'] >= limit or time.monotonic() >= client.deadline:
            break
        key = str(seed['id'])
        old = state['enterprises'].get(key, {})
        now = time.time()
        if old.get('retry_after', 0) > now:
            continue
        if not force and old.get('status') == 'ok' and old.get('last_success_epoch', 0) + config['cache_hours'] * 3600 > now:
            report['cached'] += 1
            continue
        entry = {**old, 'last_attempt_at': stamp()}
        channels = dict(old.get('channels', {}))
        report['attempted'] += 1
        successes = 0
        for channel in CHANNELS:
            try:
                document = client.get(f'/enterprise/{key}/{channel}')
                page = parse_page(document, seed['id'], channel, stamp())
                page['pages_read'] = 1
                page['pagination_status'] = 'first_page_only'
                if config.get('max_pages', 1) > 1 and page['public_rows']:
                    try:
                        following = parse_page(client.get(f'/enterprise/{key}/{channel}?page=2'), seed['id'], channel, stamp())
                        old_ids = {row['id'] for row in page['records']}
                        new_rows = [row for row in following['records'] if row['id'] not in old_ids]
                        page['pages_read'] = 2
                        page['pagination_status'] = 'advanced' if new_rows else 'repeated_or_empty'
                        page['records'].extend(new_rows)
                    except Exception as error:
                        page['pagination_status'] = 'unavailable'
                        report['errors'].append({'enterprise': key, 'channel': channel, 'reason': 'pagination:' + str(error)[:100]})
                if not any(clean(name) in page['names'] for name in seed['expected_names']):
                    raise ValueError('configured_company_name_changed')
                if any(previous.get('legal_name') and previous['legal_name'] != page['legal_name'] for previous in channels.values()):
                    raise ValueError('enterprise_legal_name_changed')
                # Retain unseen older records without refreshing their timestamps.
                previous = channels.get(channel, {})
                previous_records = {row['id']: row for row in previous.get('records', [])}
                for row in page['records']:
                    previous_records[row['id']] = row
                page['records'] = sorted(previous_records.values(), key=lambda row: row.get('published_at') or '', reverse=True)[:120]
                page['last_success_at'] = stamp()
                channels[channel] = page
                successes += 1
                consecutive_blocks = 0
            except TimeoutError:
                report['errors'].append({'enterprise': key, 'channel': channel, 'reason': 'run_budget_reached'})
                break
            except Exception as error:
                reason = str(error)[:160]
                report['failures'] += 1
                report['errors'].append({'enterprise': key, 'channel': channel, 'reason': reason})
                entry['last_error'] = reason
                consecutive_blocks += 1
                # Try the independent next channel, without retrying this page.
                if consecutive_blocks >= 3:
                    break
        entry['channels'] = channels
        if successes:
            report['successes'] += 1
            entry['last_success_at'] = stamp()
            entry['last_success_epoch'] = time.time()
            entry['status'] = 'partial' if successes < len(CHANNELS) else 'ok'
            entry.pop('last_error', None) if successes == len(CHANNELS) else None
        else:
            entry['status'] = 'failed'
        entry['retry_after'] = time.time() + (4 * 3600 if successes < len(CHANNELS) else 0)
        state['enterprises'][key] = entry
        atomic_json(state_path, state)
        if consecutive_blocks >= 3:
            report['errors'].append({'reason': 'source_cooling_after_consecutive_failures'})
            break
    report.update(elapsed_seconds=round(time.monotonic() - started, 2), requests=client.requests)
    return state, report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--state', default='data/reputation/state.json')
    parser.add_argument('--report', default='data/reputation/report.json')
    parser.add_argument('--config', default=str(ROOT / 'config/reputation-sources.json'))
    parser.add_argument('--budget', type=float, default=180)
    parser.add_argument('--limit', type=int, default=30)
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--queue')
    args = parser.parse_args()
    if not 1 <= args.budget <= 600 or not 1 <= args.limit <= 100:
        parser.error('budget must be 1–600 seconds and limit 1–100 enterprises')
    config = json.loads(Path(args.config).read_text(encoding='utf-8'))
    state_path = Path(args.state)
    state = json.loads(state_path.read_text(encoding='utf-8')) if state_path.exists() else {'schema_version': 1, 'enterprises': {}}
    if args.queue:
        queue = json.loads(Path(args.queue).read_text(encoding='utf-8'))
        if queue.get('schema_version') != 1 or not isinstance(queue.get('enterprises'), list):
            raise ValueError('unsupported_enterprise_queue')
        config['_needs_mapping'] = queue.get('needs_mapping', [])
        priorities = {str(row['id']): row['priority'] for row in queue['enterprises']}
        config['_priorities'] = priorities
        allowed = {str(seed['id']) for seed in config['enterprises']} | set(state.get('discovered_enterprises', {}))
        if set(priorities) - allowed or any(not isinstance(value, (int, float)) or not 0 <= value <= 200 for value in priorities.values()):
            raise ValueError('invalid_enterprise_queue_identity_or_priority')
        config['enterprises'] = [dict(seed, priority=priorities.get(str(seed['id']), 0)) for seed in config['enterprises']]
    state, report = collect(config, state, state_path, args.budget, args.limit, args.force)
    atomic_json(state_path, state)
    atomic_json(Path(args.report), report)
    print(json.dumps({key: value for key, value in report.items() if key != 'errors'}, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
