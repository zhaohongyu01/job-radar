'use client';

import {
  SlidersHorizontal,
  RotateCcw,
  Download,
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Filters, Snapshot } from '@/lib/jobs';

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
    <div className="filter-field">
      <span className="field-label">{label}</span>
      <Select value={value} onValueChange={(v) => onChange(v ?? '全部')}>
        <SelectTrigger className="field-control" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((v) => (
            <SelectItem key={v} value={v}>
              {v}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

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
  return (
    <div className="filter-field">
      <span className="field-label">{label}</span>
      <fieldset className="pill-group" aria-label={label}>
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            aria-pressed={value === opt}
            className={`pill-item ${value === opt ? 'active' : ''}`}
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
    <label className="check-label">
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
  fileRef,
  className = '',
}: {
  filters: Filters;
  data: Snapshot | null;
  years: string[];
  ready: boolean;
  onChange: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  onReset: () => void;
  onExport: () => void;
  onImport: (file?: File) => void;
  fileRef: React.RefObject<HTMLInputElement | null>;
  className?: string;
}) {
  return (
    <aside className={`filter-panel ${className}`} aria-label="筛选条件">
      <h2>
        <SlidersHorizontal size={17} />
        筛选机会
        <button
          aria-label="重置筛选"
          title="重置筛选"
          onClick={onReset}
        >
          <RotateCcw size={15} />
        </button>
      </h2>
      <p className="saved-filter-note">筛选条件会记在本机，下次继续使用。右上角可重置。</p>
      <Choice
        label="工作城市"
        value={filters.city}
        options={Array.from(new Set(['全部城市', filters.city, ...(data?.cities ?? ['济南'])]))}
        onChange={(v) => onChange('city', v)}
      />
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
          '银行',
          '国企',
          '事业单位',
          '公务员',
        ]}
        onChange={(v) => onChange('sector', v)}
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
      <label htmlFor="education" className="filter-field">
        <span className="field-label">学历关键词</span>
        <Input
          id="education"
          className="field-control"
          value={filters.education}
          onChange={(e) => onChange('education', e.target.value)}
          placeholder="不限，可输入本科"
        />
      </label>
      <Choice
        label="排序方式"
        value={filters.sort === 'deadline_asc' ? '即将截止优先' : filters.sort === 'salary_desc' ? '薪资从高到低' : '最新发布'}
        options={['最新发布', '即将截止优先', '薪资从高到低']}
        onChange={(v) => {
          const mapped = v === '即将截止优先' ? 'deadline_asc' : v === '薪资从高到低' ? 'salary_desc' : 'newest';
          onChange('sort', mapped);
        }}
      />
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
      <div className="filter-checks">
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
        <p>
          默认只保留国内或地点未明确的机会；仅海外岗位自动排除。默认不限专业，可在搜索框输入专业名称；公告未写明的资格需查看原文。
        </p>
      </div>
      <div className="local-records">
        <h3>我的记录</h3>
        <p>仅存当前浏览器，可导出后在其他设备导入。</p>
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={onExport}
            disabled={!ready}
          >
            <Download size={14} />
            导出
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={!ready}
          >
            <Upload size={14} />
            导入
          </Button>
          <input
            type="file"
            accept="application/json,.json"
            ref={fileRef}
            hidden
            onChange={(e) => onImport(e.target.files?.[0])}
          />
        </div>
      </div>
    </aside>
  );
}
