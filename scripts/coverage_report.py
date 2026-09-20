"""Explain changes between internal collection baselines and public snapshots."""
import datetime as dt
import re

PROVINCE_CITIES = {
    '山东': '济南 青岛 淄博 枣庄 东营 烟台 潍坊 济宁 泰安 威海 日照 临沂 德州 聊城 滨州 菏泽'.split(),
    '广东': '广州 深圳 珠海 东莞 佛山'.split(),
    '江苏': ['南京', '苏州'],
    '浙江': ['杭州', '宁波'],
    '安徽': ['合肥'],
    '福建': ['福州', '厦门'],
    '湖北': ['武汉'],
    '湖南': ['长沙'],
    '河南': ['郑州'],
    '陕西': ['西安'],
    '四川': ['成都'],
}
ALL_SPECIFIC_CITIES = [c for cities in PROVINCE_CITIES.values() for c in cities]
LOCATION_PREFIX_RE = re.compile(r'^(?:工作地点|工作城市|岗位地点|工作地域|招聘地点|招聘机构|工作区域|意向工作地|意向城市|工作地|招聘城市|所属分行|所属分公司)')


def location_match(job, city):
    if not job:
        return 'none'
    cities = job.get('cities') or []
    if city == '全部城市' or city in cities:
        return 'exact'
    evidence = job.get('location_evidence') or []
    detail_locations = [line for line in evidence if LOCATION_PREFIX_RE.match(line)]
    specific_cities = [cand for cand in ALL_SPECIFIC_CITIES if any(cand in line for line in detail_locations)]
    if city in specific_cities:
        return 'exact'
    return 'none'


def is_job_expired(job, as_of_iso):
    if not job:
        return False
    if job.get('listing_status') == 'withdrawn':
        return True
    deadline = job.get('deadline')
    if not deadline:
        return False
    try:
        dt_deadline = dt.datetime.fromisoformat(deadline)
        dt_as_of = dt.datetime.fromisoformat(as_of_iso)
        if dt_deadline.tzinfo is None and dt_as_of.tzinfo is not None:
            dt_deadline = dt_deadline.replace(tzinfo=dt_as_of.tzinfo)
        elif dt_deadline.tzinfo is not None and dt_as_of.tzinfo is None:
            dt_as_of = dt_as_of.replace(tzinfo=dt_deadline.tzinfo)
        return dt_deadline < dt_as_of
    except Exception:
        return str(deadline)[:10] < str(as_of_iso)[:10]


def build_coverage_report(before, after, snapshot, previous_snapshot=None):
    try:
        import collect as collector
    except ImportError:
        from scripts import collect as collector

    old_jobs = before.get('jobs', {}) if isinstance(before, dict) else {}
    current_jobs = after.get('jobs', {}) if isinstance(after, dict) else {}
    after_run_at = (after.get('last_run_at') if isinstance(after, dict) else None) or dt.datetime.now(collector.TZ).isoformat()
    today = after_run_at[:10]

    has_prev_snapshot = (previous_snapshot is not None and isinstance(previous_snapshot, dict) and 'jobs' in previous_snapshot)
    curr_generated_at = snapshot.get('generated_at') or after_run_at
    prev_generated_at = previous_snapshot.get('generated_at') if has_prev_snapshot else None
    before_run_at = prev_generated_at or (before.get('last_run_at') if isinstance(before, dict) else None) or after_run_at

    def summary(row):
        return {key: row.get(key) for key in ('id', 'title', 'source_id', 'source_url')}

    # -------------------------------------------------------------
    # Layer 1: 全站发布变化 (Global Published Changes)
    # -------------------------------------------------------------
    global_events = {key: [] for key in (
        'published_new_records', 'withheld_records', 'visibility_restored',
        'missing_records', 'cities_changed', 'deadline_changed', 'newly_expired', 'duplicate_groups'
    )}

    prev_published_ids = set()
    prev_snap_jobs = {}
    if has_prev_snapshot:
        for j in previous_snapshot.get('jobs', []):
            prev_published_ids.add(j['id'])
            prev_snap_jobs[j['id']] = j
            for dup_id in j.get('duplicate_ids', []):
                prev_published_ids.add(dup_id)
                prev_snap_jobs[dup_id] = j

    # 1. 原始渠道记录级审计 (Raw Record Lifecycle)
    for identifier, raw in current_jobs.items():
        row = collector.public_record(raw)
        prior_raw = old_jobs.get(identifier)
        prior = collector.public_record(prior_raw) if prior_raw else None
        entry = summary(row)

        is_published = collector.publishable_job(raw)

        if has_prev_snapshot:
            was_published = identifier in prev_published_ids
            is_new_published = is_published and not was_published
        else:
            was_published = collector.publishable_job(prior_raw) if prior_raw else False
            is_new_published = is_published and (prior_raw is None)

        if is_new_published:
            global_events['published_new_records'].append(entry)

        if not is_published:
            global_events['withheld_records'].append(dict(
                entry, verification=raw.get('detail_verification') or 'unverified'
            ))
        elif prior_raw and not was_published:
            global_events['visibility_restored'].append(entry)

        # 当无历史公开快照时，降级对比原始渠道记录的历史快照
        if not has_prev_snapshot and prior:
            if set(prior.get('cities') or []) != set(row.get('cities') or []):
                global_events['cities_changed'].append(dict(
                    entry, before=prior.get('cities', []), after=row.get('cities', [])
                ))
            if prior.get('deadline') != row.get('deadline'):
                global_events['deadline_changed'].append(dict(
                    entry, before=prior.get('deadline'), after=row.get('deadline')
                ))
            if (is_job_expired(row, curr_generated_at) and not is_job_expired(prior, before_run_at)):
                global_events['newly_expired'].append(entry)

    # 2. 公开快照卡片级审计 (Published Snapshot Diff)
    # 按合并公告统计一次，附上关联渠道 duplicate_ids，避免多渠道副本导致重复计数
    if has_prev_snapshot:
        for j in snapshot.get('jobs', []):
            prev_card = prev_snap_jobs.get(j['id'])
            if not prev_card:
                for dup_id in j.get('duplicate_ids', []):
                    if dup_id in prev_snap_jobs:
                        prev_card = prev_snap_jobs[dup_id]
                        break
            if prev_card:
                card_entry = dict(summary(j), duplicate_ids=j.get('duplicate_ids', []))
                if set(prev_card.get('cities') or []) != set(j.get('cities') or []):
                    global_events['cities_changed'].append(dict(
                        card_entry, before=prev_card.get('cities', []), after=j.get('cities', [])
                    ))
                if prev_card.get('deadline') != j.get('deadline'):
                    global_events['deadline_changed'].append(dict(
                        card_entry, before=prev_card.get('deadline'), after=j.get('deadline')
                    ))
                if (is_job_expired(j, curr_generated_at) and not is_job_expired(prev_card, prev_generated_at)):
                    global_events['newly_expired'].append(card_entry)

    for identifier in old_jobs.keys() - current_jobs.keys():
        global_events['missing_records'].append(summary(old_jobs[identifier]))

    for row in snapshot.get('jobs', []):
        if row.get('duplicate_ids'):
            global_events['duplicate_groups'].append(dict(summary(row), duplicate_ids=row['duplicate_ids']))

    # -------------------------------------------------------------
    # Layer 2: 目标预设筛选变化与互斥主因归因 (Preset Filter Impact Diff)
    # Benchmark preset: 济南 + 2027届(含未明确) + 未截止未撤下
    # -------------------------------------------------------------
    benchmark_preset = {
        'city': '济南',
        'location_scope': 'exact',
        'type': '校招',
        'graduation_year': '2027',
        'include_uncertain': True,
        'show_expired': False,
        'exclude_withdrawn': True,
        'domestic_only': True,
    }

    def matches_benchmark(item, as_of_iso):
        if not item:
            return False
        if item.get('domestic_status') == 'overseas':
            return False
        if location_match(item, '济南') != 'exact':
            return False
        if item.get('listing_status') == 'withdrawn':
            return False
        if is_job_expired(item, as_of_iso):
            return False
        types = item.get('types') or []
        if types:
            if '校招' not in types:
                return False
        elif not benchmark_preset.get('include_uncertain', True):
            return False
        years = item.get('graduation_years') or []
        if years:
            if '2027' not in years:
                return False
        elif not benchmark_preset.get('include_uncertain', True):
            return False
        return True

    current_dup_map = {}
    for j in snapshot.get('jobs', []):
        for dup_id in j.get('duplicate_ids', []):
            current_dup_map[dup_id] = j['id']

    preset_diff = {
        'benchmark_preset': benchmark_preset,
        'rules_version': 2,
        'description': '基准预设视图：济南 + 2027届校招(含未明确) + 国内 + 未截止未撤下',
        'compare_timestamps': {
            'before': before_run_at,
            'after': after_run_at,
        },
    }

    if not has_prev_snapshot:
        preset_diff['status'] = 'initial_or_no_baseline'
        preset_diff['message'] = '首次运行或无历史发布快照，仅统计当前存量'
        preset_diff['current_visible_count'] = sum(1 for j in snapshot.get('jobs', []) if matches_benchmark(j, after_run_at))
    else:
        preset_diff['status'] = 'compared'
        prev_matched = [j for j in previous_snapshot.get('jobs', []) if matches_benchmark(j, before_run_at)]
        curr_matched = [j for j in snapshot.get('jobs', []) if matches_benchmark(j, after_run_at)]
        prev_matched_ids = {j['id'] for j in prev_matched}
        curr_matched_ids = {j['id'] for j in curr_matched}

        dropped_ids = prev_matched_ids - curr_matched_ids
        added_ids = curr_matched_ids - prev_matched_ids

        curr_snap_jobs = {j['id']: j for j in snapshot.get('jobs', [])}

        reasons_count = {
            'removed_from_source': 0,
            'withheld_unverified': 0,
            'merged_duplicate': 0,
            'filtered_withdrawn': 0,
            'filtered_expired': 0,
            'filtered_city': 0,
            'filtered_domestic': 0,
            'filtered_type': 0,
            'filtered_year': 0,
            'other': 0
        }
        dropped_details = []

        for j_id in dropped_ids:
            raw = current_jobs.get(j_id)
            snap_j = curr_snap_jobs.get(j_id)

            if snap_j:
                # 优先根据本轮已公开快照记录判断未能命中基准预设的原因
                if snap_j.get('listing_status') == 'withdrawn':
                    primary = 'filtered_withdrawn'
                elif is_job_expired(snap_j, after_run_at):
                    primary = 'filtered_expired'
                elif location_match(snap_j, '济南') != 'exact':
                    primary = 'filtered_city'
                elif snap_j.get('domestic_status') == 'overseas':
                    primary = 'filtered_domestic'
                elif snap_j.get('types') and '校招' not in snap_j['types']:
                    primary = 'filtered_type'
                elif snap_j.get('graduation_years') and '2027' not in snap_j['graduation_years']:
                    primary = 'filtered_year'
                else:
                    primary = 'other'
            else:
                # 未在当前公开快照中呈现，结合内部处理流水线状态判断未公开原因
                if not raw:
                    primary = 'removed_from_source'
                elif not collector.publishable_job(raw):
                    primary = 'withheld_unverified'
                elif j_id in current_dup_map:
                    primary = 'merged_duplicate'
                elif raw.get('listing_status') == 'withdrawn':
                    primary = 'filtered_withdrawn'
                elif is_job_expired(raw, after_run_at):
                    primary = 'filtered_expired'
                elif location_match(collector.public_record(raw), '济南') != 'exact':
                    primary = 'filtered_city'
                elif raw.get('domestic_status') == 'overseas':
                    primary = 'filtered_domestic'
                elif raw.get('types') and '校招' not in raw['types']:
                    primary = 'filtered_type'
                elif raw.get('graduation_years') and '2027' not in raw['graduation_years']:
                    primary = 'filtered_year'
                else:
                    primary = 'other'

            reasons_count[primary] = reasons_count.get(primary, 0) + 1
            dropped_details.append({
                'id': j_id,
                'primary_reason': primary,
                'summary': summary(snap_j or raw) if (snap_j or raw) else {'id': j_id}
            })

        preset_diff['before_visible_count'] = len(prev_matched)
        preset_diff['after_visible_count'] = len(curr_matched)
        preset_diff['net_change'] = len(curr_matched) - len(prev_matched)
        preset_diff['newly_visible_count'] = len(added_ids)
        preset_diff['dropped_count'] = len(dropped_ids)
        preset_diff['primary_exclusion_reasons'] = reasons_count
        preset_diff['dropped_samples'] = dropped_details[:50]

    return {
        'schema_version': 2,
        'generated_at': after_run_at,
        'baseline_at': before.get('last_run_at') if isinstance(before, dict) else None,
        'scope': '两层基线审计：1. 全站底层发布变动；2. 济南基准预设筛选归因。',
        'counts': {
            'before_records': len(old_jobs),
            'after_records': len(current_jobs),
            'published_records': snapshot.get('raw_records'),
            'published_groups': len(snapshot.get('jobs', [])),
            'withheld_records': snapshot.get('withheld_records'),
            'duplicates_merged': snapshot.get('duplicates_merged')
        },
        'event_counts': {
            **{key: len(rows) for key, rows in global_events.items()},
            'new_records': len(global_events['published_new_records']),
            'withheld': len(global_events['withheld_records']),
        },
        'global_published_changes': {
            'event_counts': {
                **{key: len(rows) for key, rows in global_events.items()},
                'new_records': len(global_events['published_new_records']),
                'withheld': len(global_events['withheld_records']),
            },
            'events': global_events,
        },
        'preset_filter_changes': preset_diff
    }
