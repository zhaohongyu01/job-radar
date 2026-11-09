'use client';

import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { EXAM_TYPE_OPTIONS, SHANDONG_16 } from '@/lib/exams';
import type { BianzhiCategory, ExamCategory, ExamFilters } from '@/lib/exams';
import { bianzhiLabel, categoryLabel } from '@/components/exam-ui';

export const EXAM_CATEGORIES: ExamCategory[] = [
  '公务员国考',
  '公务员省考',
  '选调生招录',
  '事业单位统考',
  '事业单位单招',
  '教师公开招聘',
  '医疗卫生招聘',
  '高校 / 科研院所',
  '人才引进 / 优才',
  '军队文职招考',
  '三支一扶 / 基层',
];

export const BIANZHI_OPTIONS: BianzhiCategory[] = [
  '公务员（行政编）',
  '参公管理',
  '事业编',
  '控制总量 / 备案制',
  '选调生',
  '教师编',
  '医疗卫生编',
  '军队文职',
  '三支一扶 / 基层项目',
  '高层次 / 紧缺人才',
];

export const SUBJECT_OPTIONS = [
  '行测',
  '申论',
  '公基',
  '职测',
  '综应',
  '综合写作',
  '教基/教学',
  '医基/临床',
  '直接面试/面谈',
];

/** value -> display label; values are what filterExams() expects. */
export const STAGE_OPTIONS: [string, string][] = [
  ['可报名/进行中', '可报名'],
  ['正在报名', '报名中'],
  ['即将开始', '即将开始'],
  ['长期招聘', '长期招聘'],
  ['考务跟进（笔面试/资审）', '考试进行中'],
  ['时间待确认', '时间待确认'],
  ['报名已结束', '已结束'],
];

export const NOTICE_OPTIONS: [string, string][] = [
  ['仅看招考简章', '只看招考简章'],
  ['考务进展通知', '只看考务通知'],
];

function FilterSection({
  title,
  children,
  defaultOpen = true,
  badge,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  badge?: number;
}) {
  return (
    <details className="exw-fsec" open={defaultOpen}>
      <summary>
        <span>{title}</span>
        {badge ? <span className="exw-fsec-badge">{badge}</span> : null}
        <ChevronDown size={14} className="exw-fsec-caret" />
      </summary>
      <div className="exw-fsec-body">{children}</div>
    </details>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`exw-chip${active ? ' is-on' : ''}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function buildActiveExamFilters(
  filters: ExamFilters,
  onToggleCity: (city: string) => void,
  onUpdateFilters: (patch: Partial<ExamFilters>) => void,
): { key: string; label: string; clear: () => void }[] {
  const selectedCities = filters.cities.filter((c) => c !== '全部');
  return [
    ...selectedCities.map((c) => ({
      key: `city-${c}`,
      label: c,
      clear: () => onToggleCity(c),
    })),
    ...(filters.category !== '全部'
      ? [
          {
            key: 'cat',
            label: categoryLabel(filters.category),
            clear: () => onUpdateFilters({ category: '全部' }),
          },
        ]
      : []),
    ...(filters.bianzhi !== '全部'
      ? [
          {
            key: 'bz',
            label: bianzhiLabel(filters.bianzhi),
            clear: () => onUpdateFilters({ bianzhi: '全部' }),
          },
        ]
      : []),
    ...(filters.stage !== '全部'
      ? [
          {
            key: 'stage',
            label: STAGE_OPTIONS.find(([v]) => v === filters.stage)?.[1] ?? filters.stage,
            clear: () => onUpdateFilters({ stage: '全部' }),
          },
        ]
      : []),
    ...(filters.subject !== '全部'
      ? [
          {
            key: 'subj',
            label: filters.subject,
            clear: () => onUpdateFilters({ subject: '全部' }),
          },
        ]
      : []),
    ...(filters.noticeRole !== '全部'
      ? [
          {
            key: 'role',
            label: NOTICE_OPTIONS.find(([v]) => v === filters.noticeRole)?.[1] ?? filters.noticeRole,
            clear: () => onUpdateFilters({ noticeRole: '全部' }),
          },
        ]
      : []),
    ...(filters.unlimitedMajorOnly
      ? [
          {
            key: 'major',
            label: '不限专业',
            clear: () => onUpdateFilters({ unlimitedMajorOnly: false }),
          },
        ]
      : []),
    ...(filters.freshGradOnly
      ? [
          {
            key: 'fresh',
            label: '应届专项',
            clear: () => onUpdateFilters({ freshGradOnly: false }),
          },
        ]
      : []),
  ];
}

export interface ExamFilterSidebarProps {
  filters: ExamFilters;
  filtersOpen: boolean;
  activeFilterCount: number;
  resultCount?: number;
  onCloseMobile?: () => void;
  onToggleCity: (city: string) => void;
  onUpdateFilters: (patch: Partial<ExamFilters>) => void;
  onResetFilters: () => void;
}

export function ExamFilterSidebar({
  filters,
  filtersOpen,
  activeFilterCount,
  resultCount = 0,
  onCloseMobile,
  onToggleCity,
  onUpdateFilters,
  onResetFilters,
}: ExamFilterSidebarProps) {
  const selectedCities = filters.cities.filter((c) => c !== '全部');

  const filterBody = (
    <>
      <div className="exw-filters-head">
        <span>筛选</span>
        {activeFilterCount > 0 && (
          <button type="button" className="text-btn" onClick={onResetFilters}>
            重置
          </button>
        )}
      </div>

      <FilterSection title="地区" badge={selectedCities.length}>
        <div className="exw-chip-grid">
          <Chip active={selectedCities.length === 0} onClick={() => onToggleCity('全部')}>
            全部
          </Chip>
          {SHANDONG_16.map((city) => (
            <Chip
              key={city}
              active={filters.cities.includes(city)}
              onClick={() => onToggleCity(city)}
            >
              {city}
            </Chip>
          ))}
        </div>
      </FilterSection>

      <FilterSection title="报名状态" badge={filters.stage !== '全部' ? 1 : 0}>
        <div className="exw-chip-wrap">
          <Chip active={filters.stage === '全部'} onClick={() => onUpdateFilters({ stage: '全部' })}>
            全部
          </Chip>
          {STAGE_OPTIONS.map(([v, label]) => (
            <Chip key={v} active={filters.stage === v} onClick={() => onUpdateFilters({ stage: v })}>
              {label}
            </Chip>
          ))}
        </div>
      </FilterSection>

      <FilterSection title="考试类型" badge={filters.category !== '全部' ? 1 : 0}>
        <div className="exw-chip-wrap">
          <Chip
            active={filters.category === '全部'}
            onClick={() => onUpdateFilters({ category: '全部' })}
          >
            全部
          </Chip>
          {EXAM_TYPE_OPTIONS.map((typeLabel) => (
            <Chip
              key={typeLabel}
              active={
                filters.category === typeLabel ||
                categoryLabel(filters.category) === typeLabel
              }
              onClick={() => onUpdateFilters({ category: typeLabel })}
            >
              {typeLabel}
            </Chip>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          <label className="exw-switch">
            <input
              type="checkbox"
              checked={Boolean(filters.freshGradOnly)}
              onChange={(e) => onUpdateFilters({ freshGradOnly: e.target.checked })}
            />
            <span className="exw-switch-ui" aria-hidden="true" />
            <span>应届专项</span>
          </label>
          <label className="exw-switch">
            <input
              type="checkbox"
              checked={filters.unlimitedMajorOnly}
              onChange={(e) => onUpdateFilters({ unlimitedMajorOnly: e.target.checked })}
            />
            <span className="exw-switch-ui" aria-hidden="true" />
            <span>不限专业</span>
          </label>
        </div>
      </FilterSection>

      <FilterSection
        title="更多"
        defaultOpen={false}
        badge={
          (filters.bianzhi !== '全部' ? 1 : 0) +
          (filters.subject !== '全部' ? 1 : 0) +
          (filters.noticeRole !== '全部' ? 1 : 0)
        }
      >
        <p className="exw-fsub">编制性质</p>
        <div className="exw-chip-wrap">
          <Chip
            active={filters.bianzhi === '全部'}
            onClick={() => onUpdateFilters({ bianzhi: '全部' })}
          >
            全部
          </Chip>
          {BIANZHI_OPTIONS.map((bz) => (
            <Chip
              key={bz}
              active={filters.bianzhi === bz}
              onClick={() => onUpdateFilters({ bianzhi: bz })}
            >
              {bianzhiLabel(bz)}
            </Chip>
          ))}
        </div>
        <p className="exw-fsub">考试科目</p>
        <div className="exw-chip-wrap">
          <Chip
            active={filters.subject === '全部'}
            onClick={() => onUpdateFilters({ subject: '全部' })}
          >
            全部
          </Chip>
          {SUBJECT_OPTIONS.map((s) => (
            <Chip
              key={s}
              active={filters.subject === s}
              onClick={() => onUpdateFilters({ subject: s })}
            >
              {s}
            </Chip>
          ))}
        </div>
        <p className="exw-fsub">公告类型</p>
        <div className="exw-chip-wrap">
          <Chip
            active={filters.noticeRole === '全部'}
            onClick={() => onUpdateFilters({ noticeRole: '全部' })}
          >
            全部
          </Chip>
          {NOTICE_OPTIONS.map(([v, label]) => (
            <Chip
              key={v}
              active={filters.noticeRole === v}
              onClick={() => onUpdateFilters({ noticeRole: v })}
            >
              {label}
            </Chip>
          ))}
        </div>
      </FilterSection>
    </>
  );

  return (
    <>
      <aside className="exw-filters" aria-label="筛选条件">
        {filterBody}
      </aside>
      <Sheet
        open={filtersOpen}
        onOpenChange={(open) => {
          if (!open) onCloseMobile?.();
        }}
      >
        <SheetContent side="bottom" className="exw-filter-sheet">
          <SheetHeader className="detail-header">
            <SheetTitle>筛选条件</SheetTitle>
            <SheetDescription>调整筛选条件后立即生效</SheetDescription>
          </SheetHeader>
          <div className="exw-filter-sheet-scroll">{filterBody}</div>
          <div className="mobile-filter-footer">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onCloseMobile?.()}
            >
              查看 {resultCount} 条结果
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
