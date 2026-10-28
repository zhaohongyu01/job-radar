'use client';

import { useId, useState } from 'react';

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
import type { Filters, Snapshot } from '@/lib/jobs';
import { selectedWorkCities } from '@/lib/jobs';
import { ALL_CITIES } from '@/lib/cities';

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
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <Select value={value} onValueChange={(v) => onChange(v ?? '全部')}>
        <SelectTrigger className="field-select" aria-label={label}>
          <SelectValue>{({ all: '全部', full_time: '全职', internship: '实习', part_time: '兼职', confirmed_open: '近期核验在招', long_term: '原文长期招聘', unconfirmed: '有效性待核实' } as Record<string, string>)[value] || value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((v) => (
            <SelectItem key={v} value={v}>
              {({ all: '全部', full_time: '全职', internship: '实习', part_time: '兼职', confirmed_open: '近期核验在招', long_term: '原文长期招聘', unconfirmed: '有效性待核实' } as Record<string, string>)[v] || v}
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
}: {
  filters: Filters;
  data: Snapshot | null;
  years: string[];
  ready: boolean;
  onChange: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  onReset: () => void;
  onExport: () => void;
  onImport: () => void;
  className?: string;
}) {
  const educationId = useId();
  const cityListId = useId();
  const majorId = useId();
  const [cityQuery, setCityQuery] = useState('');
  const selectedCities = selectedWorkCities(filters);
  const cityOptions = Array.from(new Set([...ALL_CITIES, ...(data?.cities || []), ...selectedCities]));
  return (
    <aside className={`filter-rail ${className}`} aria-label="筛选条件">
      <div className="rail-head">
        <h2>筛选</h2>
        <button className="text-btn" aria-label="重置筛选" title="重置筛选" onClick={onReset}>
          <RotateCcw />
          重置
        </button>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={cityListId}>意向工作城市（可多选）</label>
        <Input id={cityListId} list={`${cityListId}-options`} value={cityQuery} placeholder="输入城市名称后添加"
          onChange={(event) => setCityQuery(event.target.value)} />
        <datalist id={`${cityListId}-options`}>{cityOptions.map((city) => <option key={city} value={city}>{city}</option>)}</datalist>
        <button type="button" className="btn btn-ghost btn-sm" disabled={!cityOptions.includes(cityQuery) || selectedCities.includes(cityQuery)}
          onClick={() => { onChange('workCities', [...selectedCities, cityQuery]); setCityQuery(''); }}>添加城市</button>
        <div className="chip-row">
          {!selectedCities.length && <span className="chip">全部城市</span>}
          {selectedCities.map((city) => <button key={city} type="button" className="chip" aria-label={`移除工作城市${city}`}
            onClick={() => onChange('workCities', selectedCities.filter((value) => value !== city))}>{city} ×</button>)}
          {!!selectedCities.length && <button type="button" className="text-btn" onClick={() => onChange('workCities', [])}>全部城市</button>}
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
      <Choice label="工作性质" value={filters.employmentType || 'all'} options={['all', 'full_time', 'internship', 'part_time']}
        onChange={(value) => onChange('employmentType', value as Filters['employmentType'])} />
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
      <label htmlFor={educationId} className="field">
        <span className="field-label">学历关键词</span>
        <Input
          id={educationId}
          className="field-input"
          value={filters.education}
          onChange={(e) => onChange('education', e.target.value)}
          placeholder="不限，可输入本科"
        />
      </label>
      <label className="field" htmlFor={majorId}><span className="field-label">专业关键词（同一岗位匹配）</span>
        <Input id={majorId} value={filters.major || ''} onChange={(event) => onChange('major', event.target.value)} placeholder="例如会计、软件工程" />
      </label>
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
        <Toggle label="同时看本城宣讲关联机会（工作地另核）" checked={Boolean(filters.includeRelatedTalks)} onChange={(value) => onChange('includeRelatedTalks', value)} />
        <Choice label="招聘有效性" value={filters.validity || 'all'} options={['all', 'confirmed_open', 'long_term', 'unconfirmed']}
          onChange={(value) => onChange('validity', value as Filters['validity'])} />
        <p className="filter-help">
          默认只保留国内或地点未明确的机会；仅海外岗位自动排除。默认不限专业，可在搜索框输入专业名称；公告未写明的资格需查看原文。
        </p>
      </details>
      <div className="rail-foot">
        <h3>我的记录</h3>
        <p>仅存当前浏览器，可导出后在其他设备导入。</p>
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
