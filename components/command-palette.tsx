'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Briefcase,
  Command,
  Download,
  Landmark,
  MapPin,
  Moon,
  Search,
  Sun,
  Upload,
  X,
} from 'lucide-react';
import type { Job } from '@/lib/jobs';
import type { ExamAnnouncement } from '@/lib/exams';
import { SHANDONG_16 } from '@/lib/exams';
import { readThemePreference, resolveEffectiveTheme, writeThemePreference } from '@/lib/theme';

export interface CommandPaletteAction {
  id: string;
  group: string;
  label: string;
  sublabel?: string;
  keywords?: string;
  icon: 'job' | 'exam' | 'city' | 'theme' | 'backup' | 'search';
  onSelect: () => void;
}

export interface CommandPaletteProps {
  workspace: 'jobs' | 'exams';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobs?: Job[];
  exams?: ExamAnnouncement[];
  onSelectJob?: (job: Job) => void;
  onSelectExam?: (exam: ExamAnnouncement) => void;
  onApplyCity?: (city: string) => void;
  onApplySearch?: (query: string) => void;
  onSwitchView?: (view: string) => void;
  onExportBackup?: () => void;
  onImportBackup?: () => void;
}

export function CommandPalette(props: CommandPaletteProps) {
  const { open, onOpenChange } = props;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        onOpenChange(!open);
      } else if (event.key === 'Escape' && open) {
        event.preventDefault();
        onOpenChange(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;
  return <CommandPaletteModal {...props} />;
}

function CommandPaletteModal({
  workspace,
  onOpenChange,
  jobs = [],
  exams = [],
  onSelectJob,
  onSelectExam,
  onApplyCity,
  onApplySearch,
  onSwitchView,
  onExportBackup,
  onImportBackup,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(t);
  }, []);

  const trimmed = query.trim();
  const qLower = trimmed.toLowerCase();

  const items = useMemo<CommandPaletteAction[]>(() => {
    const list: CommandPaletteAction[] = [];

    if (trimmed) {
      if (onApplySearch) {
        list.push({
          id: 'apply-current-search',
          group: '立即检索',
          label: `在当前工作台搜索「${trimmed}」`,
          sublabel: workspace === 'jobs' ? '企业求职全文与列表检索' : '考公考编公告与职位库检索',
          icon: 'search',
          onSelect: () => {
            onApplySearch(trimmed);
            onOpenChange(false);
          },
        });
      }
      list.push({
        id: 'jump-cross-search',
        group: '立即检索',
        label:
          workspace === 'jobs'
            ? `去「考公考编」搜索「${trimmed}」`
            : `去「企业求职」搜索「${trimmed}」`,
        sublabel: '跨工作台一键检索',
        icon: workspace === 'jobs' ? 'exam' : 'job',
        onSelect: () => {
          onOpenChange(false);
          const targetUrl =
            workspace === 'jobs'
              ? `/exams?q=${encodeURIComponent(trimmed)}`
              : `/?q=${encodeURIComponent(trimmed)}`;
          window.location.assign(targetUrl);
        },
      });
    }

    // Live record matches from loaded dataset
    if (qLower.length >= 1) {
      if (workspace === 'jobs' && onSelectJob && jobs.length > 0) {
        let matched = 0;
        for (const job of jobs) {
          if (matched >= 6) break;
          const hay = `${job.company} ${job.title} ${(job.cities || []).join(' ')}`.toLowerCase();
          if (hay.includes(qLower)) {
            matched += 1;
            list.push({
              id: `job-${job.id}`,
              group: '匹配的企业机会',
              label: `${job.company} · ${job.title}`,
              sublabel: (job.cities || []).slice(0, 2).join('、') || '地点见公告',
              icon: 'job',
              onSelect: () => {
                onOpenChange(false);
                onSelectJob(job);
              },
            });
          }
        }
      } else if (workspace === 'exams' && onSelectExam && exams.length > 0) {
        let matched = 0;
        for (const ex of exams) {
          if (matched >= 6) break;
          const hay = `${ex.title} ${ex.organizer} ${(ex.cities || []).join(' ')}`.toLowerCase();
          if (hay.includes(qLower)) {
            matched += 1;
            list.push({
              id: `exam-${ex.id}`,
              group: '匹配的招考公告',
              label: ex.title,
              sublabel: ex.organizer,
              icon: 'exam',
              onSelect: () => {
                onOpenChange(false);
                onSelectExam(ex);
              },
            });
          }
        }
      }
    }

    // Navigation & quick actions
    const baseActions: CommandPaletteAction[] = [
      {
        id: 'switch-workspace',
        group: '工作台与视图',
        label: workspace === 'jobs' ? '切换到「考公考编」工作台' : '切换到「企业求职」工作台',
        sublabel: workspace === 'jobs' ? '山东 16 市公务员 / 事业编 / 选调 / 教师 / 医疗' : '校招 / 社招 / 国央企 / 高校宣讲',
        keywords: '考公 考编 公务员 事业编 企业 求职 校招 社招',
        icon: workspace === 'jobs' ? 'exam' : 'job',
        onSelect: () => {
          onOpenChange(false);
          window.location.assign(workspace === 'jobs' ? '/exams' : '/');
        },
      },
    ];

    if (onSwitchView) {
      if (workspace === 'jobs') {
        baseActions.push(
          {
            id: 'view-all',
            group: '工作台与视图',
            label: '打开「发现机会」列表',
            keywords: '发现 列表 机会',
            icon: 'job',
            onSelect: () => {
              onSwitchView('all');
              onOpenChange(false);
            },
          },
          {
            id: 'view-saved',
            group: '工作台与视图',
            label: '打开「我的收藏 / 待投递」',
            keywords: '收藏 待投递',
            icon: 'job',
            onSelect: () => {
              onSwitchView('planned');
              onOpenChange(false);
            },
          },
          {
            id: 'view-pipeline',
            group: '工作台与视图',
            label: '打开「投递跟进」看板',
            keywords: '投递 跟进 进度 看板 面试',
            icon: 'job',
            onSelect: () => {
              onSwitchView('pipeline');
              onOpenChange(false);
            },
          },
        );
      } else {
        baseActions.push(
          {
            id: 'view-exam-ann',
            group: '工作台与视图',
            label: '查看「招考公告」',
            keywords: '公告 简章',
            icon: 'exam',
            onSelect: () => {
              onSwitchView('announcements');
              onOpenChange(false);
            },
          },
          {
            id: 'view-exam-pos',
            group: '工作台与视图',
            label: '查看「职位库」全表检索',
            keywords: '职位库 岗位表 专业',
            icon: 'exam',
            onSelect: () => {
              onSwitchView('positions');
              onOpenChange(false);
            },
          },
          {
            id: 'view-exam-tracker',
            group: '工作台与视图',
            label: '查看「报考进度」看板',
            keywords: '报考 进度 缴费 笔试',
            icon: 'exam',
            onSelect: () => {
              onSwitchView('tracker');
              onOpenChange(false);
            },
          },
        );
      }
    }

    baseActions.push({
      id: 'toggle-theme',
      group: '偏好与工具',
      label: '切换浅色原浆纸 / 夜间墨纸模式',
      sublabel: '护眼暖黑配色，自动记忆本地偏好',
      keywords: '深色 暗色 夜间 浅色 主题 dark light theme',
      icon: 'theme',
      onSelect: () => {
        const eff = resolveEffectiveTheme(readThemePreference());
        writeThemePreference(eff === 'dark' ? 'light' : 'dark');
        onOpenChange(false);
      },
    });

    if (onExportBackup) {
      baseActions.push({
        id: 'export-backup',
        group: '偏好与工具',
        label: '导出个人记录 JSON 备份',
        sublabel: '包含求职收藏、投递跟进、考编候选与个人画像',
        keywords: '导出 备份 下载 backup export',
        icon: 'backup',
        onSelect: () => {
          onOpenChange(false);
          onExportBackup();
        },
      });
    }
    if (onImportBackup) {
      baseActions.push({
        id: 'import-backup',
        group: '偏好与工具',
        label: '导入恢复个人记录备份',
        sublabel: '安全合并，不会直接覆盖本机已有记录',
        keywords: '导入 恢复 备份 import restore',
        icon: 'backup',
        onSelect: () => {
          onOpenChange(false);
          onImportBackup();
        },
      });
    }

    if (onApplyCity) {
      const quickCities = [...SHANDONG_16, '北京', '上海', '杭州', '深圳'];
      for (const city of quickCities) {
        if (!qLower && !['济南', '青岛', '烟台', '潍坊'].includes(city)) continue;
        baseActions.push({
          id: `city-${city}`,
          group: '按城市快速筛选',
          label: `筛选城市：${city}`,
          keywords: `城市 地点 ${city}`,
          icon: 'city',
          onSelect: () => {
            onApplyCity(city);
            onOpenChange(false);
          },
        });
      }
    }

    const filteredBase = qLower
      ? baseActions.filter((act) =>
          `${act.label} ${act.sublabel || ''} ${act.keywords || ''}`.toLowerCase().includes(qLower),
        )
      : baseActions;

    return [...list, ...filteredBase].slice(0, 18);
  }, [
    trimmed,
    qLower,
    workspace,
    jobs,
    exams,
    onSelectJob,
    onSelectExam,
    onApplyCity,
    onApplySearch,
    onSwitchView,
    onExportBackup,
    onImportBackup,
    onOpenChange,
  ]);

  const safeIndex = items.length > 0 ? Math.min(activeIndex, items.length - 1) : 0;

  const renderIcon = (kind: CommandPaletteAction['icon']) => {
    switch (kind) {
      case 'job':
        return <Briefcase size={15} />;
      case 'exam':
        return <Landmark size={15} />;
      case 'city':
        return <MapPin size={15} />;
      case 'theme':
        return resolveEffectiveTheme(readThemePreference()) === 'dark' ? (
          <Sun size={15} />
        ) : (
          <Moon size={15} />
        );
      case 'backup':
        return <Download size={15} />;
      default:
        return <Search size={15} />;
    }
  };

  return (
    <div
      className="cmdk-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <dialog
        open
        className="cmdk-dialog"
        aria-label="全局快捷命令与搜索"
      >
        <div className="cmdk-input-row">
          <Search size={16} className="cmdk-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="cmdk-input"
            placeholder="输入单位、岗位、专业、城市或操作指令…"
            aria-label="全局命令搜索"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIndex((prev) => (items.length ? (prev + 1) % items.length : 0));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIndex((prev) =>
                  items.length ? (prev - 1 + items.length) % items.length : 0,
                );
              } else if (e.key === 'Enter' && items[safeIndex]) {
                e.preventDefault();
                items[safeIndex].onSelect();
              }
            }}
          />
          {query && (
            <button
              type="button"
              className="icon-btn"
              aria-label="清空输入"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
            >
              <X size={14} />
            </button>
          )}
          <kbd className="cmdk-esc">ESC</kbd>
        </div>

        <div className="cmdk-list">
          {items.length === 0 ? (
            <div className="cmdk-empty">没有找到匹配的命令或记录</div>
          ) : (
            items.map((item, idx) => {
              const prevGroup = idx > 0 ? items[idx - 1].group : '';
              const showGroup = item.group !== prevGroup;
              const isSelected = idx === safeIndex;
              return (
                <div key={item.id}>
                  {showGroup && <div className="cmdk-group-title">{item.group}</div>}
                  <button
                    type="button"
                    aria-current={isSelected ? 'true' : undefined}
                    className={`cmdk-item${isSelected ? ' is-selected' : ''}`}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={item.onSelect}
                  >
                    <span className="cmdk-item-icon">
                      {item.id === 'import-backup' ? <Upload size={15} /> : renderIcon(item.icon)}
                    </span>
                    <span className="cmdk-item-body">
                      <span className="cmdk-item-label">{item.label}</span>
                      {item.sublabel && <small className="cmdk-item-sub">{item.sublabel}</small>}
                    </span>
                    <ArrowRight size={13} className="cmdk-item-arrow" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="cmdk-foot">
          <span>
            <Command size={11} /> ↑↓ 选择 · Enter 执行 · Esc 关闭
          </span>
          <span>⌘K / Ctrl+K 随时呼出</span>
        </div>
      </dialog>
    </div>
  );
}
