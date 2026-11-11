'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  ChevronDown,
  Download,
  RotateCcw,
  Upload,
} from 'lucide-react';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxCollection,
  ComboboxItem,
  ComboboxEmpty,
} from '@/components/ui/combobox';
import type { Filters, Snapshot } from '@/lib/jobs';
import { countActiveFilters, selectedWorkCities } from '@/lib/jobs';
import { loadAllCities, normalizeCity } from '@/lib/cities';

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const text = (option: string) =>
    label === '企业体验参考'
      ? ({ all: '不限参考分', '3': '3分及以上', '4': '4分及以上' } as Record<string, string>)[option] ||
        option
      : ({
          all: '全部',
          full_time: '全职',
          internship: '实习',
          part_time: '兼职',
          confirmed_open: '近期核验在招',
          long_term: '原文长期招聘',
          unconfirmed: '有效性待核实',
        } as Record<string, string>)[option] || option;
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <Select value={value} onValueChange={(v) => onChange(v ?? '全部')}>
        <SelectTrigger className="field-select" aria-label={label}>
          <SelectValue>{text(value)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((v) => (
            <SelectItem key={v} value={v}>
              {text(v)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Short option sets read best as a segmented control; longer ones wrap as chips. */
function PillChoice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const segmented = options.length <= 3;
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <fieldset className={segmented ? 'seg seg-block' : 'chip-row'} aria-label={label}>
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            aria-pressed={value === opt}
            className={segmented ? undefined : 'toggle-chip toggle-chip-sm'}
            onClick={() => onChange(opt)}
          >
            {opt}
          </button>
        ))}
      </fieldset>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="check-row">
      <Checkbox checked={checked} onCheckedChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

const QUICK_CITIES = ['济南', '青岛', '北京', '上海', '广州', '深圳', '杭州', '南京', '成都', '武汉'] as const;
const QUICK_EDUCATION = [
  { label: '不限', value: '' },
  { label: '大专', value: '大专' },
  { label: '本科', value: '本科' },
  { label: '硕士', value: '硕士' },
  { label: '博士', value: '博士' },
] as const;
const QUICK_MAJORS = ['计算机', '软件工程', '电气', '电子信息', '机械', '会计', '金融', '法学', '汉语言'] as const;

export function FilterSidebar({
  filters,
  data,
  years,
  ready,
  onChange,
  onReset,
  onExport,
  onImport,
  className = '',
  facts,
  cityCounts,
}: {
  filters: Filters;
  data: Snapshot | null;
  years: string[];
  facts?: { verified: number; salaryKnown: number; total: number; hasReputationScores: boolean };
  cityCounts?: Record<string, number>;
  ready: boolean;
  onChange: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  onReset: () => void;
  onExport: () => void;
  onImport: () => void;
  className?: string;
}) {
  const cityListId = useId();
  const majorId = useId();
  const [cityQuery, setCityQuery] = useState('');
  const [loadedCities, setLoadedCities] = useState<string[]>([]);
  const citiesRequestedRef = useRef(false);
  const ensureCitiesLoaded = useCallback(() => {
    if (citiesRequestedRef.current) return;
    citiesRequestedRef.current = true;
    void loadAllCities().then(setLoadedCities);
  }, []);
  const selectedCities = selectedWorkCities(filters);
  const cityOptions = Array.from(
    new Set([...QUICK_CITIES, ...loadedCities, ...(data?.cities || []), ...selectedCities]),
  );
  const resolvedCity =
    normalizeCity(cityQuery.trim()) ||
    (cityOptions.includes(cityQuery.trim()) ? cityQuery.trim() : null);
  const canAddCity = Boolean(resolvedCity && !selectedCities.includes(resolvedCity));
  const addCity = () => {
    if (!resolvedCity || selectedCities.includes(resolvedCity)) return;
    onChange('workCities', [...selectedCities, resolvedCity]);
    setCityQuery('');
  };
  const toggleQuickCity = (city: string) => {
    const next = selectedCities.includes(city)
      ? selectedCities.filter((value) => value !== city)
      : [...selectedCities, city];
    onChange('workCities', next);
  };

  const currentMajor = filters.major || '';
  const [majorDraft, setMajorDraft] = useState(currentMajor);
  const [majorBase, setMajorBase] = useState(currentMajor);
  if (majorBase !== currentMajor) {
    setMajorBase(currentMajor);
    setMajorDraft(currentMajor);
  }
  const majorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const updateMajor = useCallback(
    (value: string, immediate = false) => {
      setMajorDraft(value);
      clearTimeout(majorTimer.current);
      if (immediate) onChange('major', value);
      else majorTimer.current = setTimeout(() => onChange('major', value), 300);
    },
    [onChange],
  );
  useEffect(() => () => clearTimeout(majorTimer.current), []);

  const activeCount = countActiveFilters(filters);
  // Filters with no matching data stay hidden unless already active (so they can be cleared).
  const showValidity = !facts || facts.verified > 0 || (filters.validity || 'all') !== 'all';
  const showReputation =
    !facts ||
    facts.hasReputationScores ||
    (filters.reputationMin || 'all') !== 'all' ||
    filters.includeUnrated === false;

  return (
    <aside className={`filter-rail ${className}`} aria-label="筛选条件">
      <div className="rail-head">
        <div className="rail-head-title">
          <h2>筛选</h2>
          {activeCount > 0 && <span className="filter-active-badge">{activeCount} 项生效</span>}
        </div>
        <button className="text-btn" aria-label="重置筛选" title="重置筛选" onClick={onReset}>
          <RotateCcw />
          重置
        </button>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={cityListId}>
          意向工作城市（可多选）
        </label>
        <div className="city-input-row">
          <Combobox<string>
            items={cityOptions}
            limit={30}
            value={null}
            inputValue={cityQuery}
            onInputValueChange={(val) => setCityQuery(val)}
            onOpenChange={(open) => {
              if (open) ensureCitiesLoaded();
            }}
            onValueChange={(val) => {
              if (!val) return;
              const resolved =
                normalizeCity(val.trim()) ||
                (cityOptions.includes(val.trim()) ? val.trim() : null);
              if (resolved && !selectedCities.includes(resolved)) {
                onChange('workCities', [...selectedCities, resolved]);
              }
              setCityQuery('');
            }}
          >
            <ComboboxInput
              id={cityListId}
              placeholder="输入城市名称后添加"
              onFocus={ensureCitiesLoaded}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.defaultPrevented && canAddCity) {
                  event.preventDefault();
                  addCity();
                }
              }}
            />
            <ComboboxContent>
              <ComboboxEmpty>暂无匹配城市</ComboboxEmpty>
              <ComboboxList>
                <ComboboxCollection>
                  {(city: string) => (
                    <ComboboxItem key={city} value={city}>
                      {city}
                    </ComboboxItem>
                  )}
                </ComboboxCollection>
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!canAddCity}
            onClick={addCity}
          >
            添加城市
          </button>
        </div>
        <fieldset className="quick-filter-pills" aria-label="热门城市快捷选择">
          {QUICK_CITIES.map((city) => {
            const active = selectedCities.includes(city);
            const cnt = cityCounts?.[city];
            return (
              <button
                key={city}
                type="button"
                aria-pressed={active}
                className={`toggle-chip toggle-chip-xs${active ? ' is-active' : ''}`}
                onClick={() => toggleQuickCity(city)}
              >
                <span>{city}</span>
                {typeof cnt === 'number' && cnt > 0 && (
                  <small className="pill-facet-count">{cnt}</small>
                )}
              </button>
            );
          })}
        </fieldset>
        <div className="chip-row">
          {!selectedCities.length && <span className="filter-help">未限定城市，显示全部</span>}
          {selectedCities.map((city) => (
            <button
              key={city}
              type="button"
              className="chip"
              aria-label={`移除工作城市${city}`}
              onClick={() =>
                onChange(
                  'workCities',
                  selectedCities.filter((value) => value !== city),
                )
              }
            >
              {city} ×
            </button>
          ))}
          {!!selectedCities.length && (
            <button type="button" className="text-btn" onClick={() => onChange('workCities', [])}>
              全部城市
            </button>
          )}
        </div>
        <small className="filter-help">按岗位工作地筛选；各城市的本地来源覆盖程度不同。</small>
      </div>
      <PillChoice
        label="招聘类型"
        value={filters.type}
        options={['全部', '校招', '社招']}
        onChange={(v) => onChange('type', v)}
      />
      {filters.type === '校招' && (
        <Choice
          label="毕业届别"
          value={filters.year}
          options={years}
          onChange={(v) => onChange('year', v)}
        />
      )}
      <Choice
        label="招聘单位"
        value={filters.sector}
        options={[
          '全部',
          '企业 / 其他',
          '国企',
          '事业单位',
          '公务员',
          '银行',
          '保险',
          '单位性质未明确',
        ]}
        onChange={(v) => onChange('sector', v)}
      />
      <Choice
        label="工作性质"
        value={filters.employmentType || 'all'}
        options={['all', 'full_time', 'internship', 'part_time']}
        onChange={(value) => onChange('employmentType', value as Filters['employmentType'])}
      />
      <Choice
        label="岗位方向"
        value={filters.direction}
        options={[
          '全部',
          '财务 / 经济',
          '管理 / 职能',
          '技术 / 研发',
          '市场 / 销售',
        ]}
        onChange={(v) => onChange('direction', v)}
      />
      <PillChoice
        label="薪资期望"
        value={filters.salary}
        options={['全部', '6K以上', '8K以上', '10K以上', '15K以上', '20K以上']}
        onChange={(v) => onChange('salary', v)}
      />
      {facts && facts.total > 0 && filters.salary !== '全部' && (
        <small className="filter-help">
          仅含写明薪资的公告（全站约 {Math.round((facts.salaryKnown / facts.total) * 100)}%），未写薪资的不会出现。
        </small>
      )}
      <div className="field">
        <span className="field-label">学历要求</span>
        <fieldset className="quick-filter-pills" aria-label="学历快捷选择">
          {QUICK_EDUCATION.map((item) => {
            const active = filters.education === item.value;
            return (
              <button
                key={item.label}
                type="button"
                aria-pressed={active}
                className={`toggle-chip toggle-chip-xs${active ? ' is-active' : ''}`}
                onClick={() => onChange('education', active && item.value ? '' : item.value)}
              >
                {item.label}
              </button>
            );
          })}
        </fieldset>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={majorId}>
          专业关键词（同一岗位匹配）
        </label>
        <Input
          id={majorId}
          value={majorDraft}
          onChange={(event) => updateMajor(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') updateMajor(majorDraft, true);
          }}
          placeholder="例如会计、软件工程"
        />
        <fieldset className="quick-filter-pills" aria-label="热门专业快捷选择">
          {QUICK_MAJORS.map((major) => {
            const active = currentMajor === major;
            return (
              <button
                key={major}
                type="button"
                aria-pressed={active}
                className={`toggle-chip toggle-chip-xs${active ? ' is-active' : ''}`}
                onClick={() => updateMajor(active ? '' : major, true)}
              >
                {major}
              </button>
            );
          })}
        </fieldset>
      </div>
      <details className="filter-more">
        <summary>
          <span>
            更多条件<small>来源 · 信息状态</small>
          </span>
          <ChevronDown size={15} />
        </summary>
        <PillChoice
          label="信息来源"
          value={filters.provenance}
          options={['全部', '高校 / 政府', '第三方线索']}
          onChange={(v) => onChange('provenance', v)}
        />
        <PillChoice
          label="信息类型"
          value={filters.kind}
          options={['全部', '具体岗位', '招聘公告']}
          onChange={(v) => onChange('kind', v)}
        />
        <Choice
          label="招聘变更 / 状态"
          value={filters.changeType}
          options={['全部', '有变更', '截止延期', '补录招募', '岗位调整', '考核阶段']}
          onChange={(v) => onChange('changeType', v as Filters['changeType'])}
        />
        <Toggle
          label="保留招聘类型、届别或学历未明确的公告"
          checked={filters.includeUncertain}
          onChange={(v) => onChange('includeUncertain', v)}
        />
        <Toggle
          label="显示已截止公告"
          checked={filters.showExpired}
          onChange={(v) => onChange('showExpired', v)}
        />
        <Toggle
          label="同时看本城宣讲关联机会（工作地另核）"
          checked={Boolean(filters.includeRelatedTalks)}
          onChange={(value) => onChange('includeRelatedTalks', value)}
        />
        {showValidity && (
          <Choice
            label="招聘有效性"
            value={filters.validity || 'all'}
            options={['all', 'confirmed_open', 'long_term', 'unconfirmed']}
            onChange={(value) => onChange('validity', value as Filters['validity'])}
          />
        )}
        {showReputation && (
          <>
            <Choice
              label="企业体验参考"
              value={filters.reputationMin || 'all'}
              options={['all', '3', '4']}
              onChange={(value) => onChange('reputationMin', value as Filters['reputationMin'])}
            />
            <Toggle
              label="保留评分不足的企业"
              checked={filters.includeUnrated !== false}
              onChange={(value) => onChange('includeUnrated', value)}
            />
            <p className="filter-help">
              体验参考分来自近一年公开员工体验的规则归纳，非平台官方评分；集团参考不直接套用到子公司。
            </p>
          </>
        )}
        <p className="filter-help">
          默认只保留国内或地点未明确的机会；仅海外岗位自动排除。专业可用上方“专业关键词”按同一岗位筛选；公告未写明的资格需查看原文。
        </p>
      </details>
      <div className="rail-foot">
        <h3>我的记录</h3>
        <p>岗位、活动与企业意向仅存当前浏览器，可导出后在其他设备导入。</p>
        <div className="rail-foot-actions">
          <button className="btn btn-secondary btn-sm" onClick={onExport} disabled={!ready}>
            <Download />
            导出
          </button>
          <button className="btn btn-secondary btn-sm" onClick={onImport} disabled={!ready}>
            <Upload />
            导入
          </button>
        </div>
      </div>
    </aside>
  );
}
