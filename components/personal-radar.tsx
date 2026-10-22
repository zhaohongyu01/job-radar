'use client';

import { useState, useEffect, useMemo } from 'react';
import { Plus, Zap, Clock, BookmarkCheck, ChevronUp, ChevronDown, Check, Bell, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { Filters, Job, RadarFocus } from '@/lib/jobs';
import {
  type RadarPreset,
  loadRadarPresets,
  saveRadarPresets,
  computeRadarMetrics,
  RADAR_ACTIVE_PRESET_STORAGE,
} from '@/lib/radar';

export type PersonalRadarProps = {
  currentFilters: Filters;
  filteredJobs: Job[];
  activeFocus?: RadarFocus;
  now: number;
  onApplyPreset: (presetFilters: Partial<Filters>) => void;
  onQuickFocus: (focus: 'today' | 'supplement' | 'urgent' | 'change') => void;
};

type QuickFocus = Parameters<PersonalRadarProps['onQuickFocus']>[0];

export function PersonalRadar({
  currentFilters,
  filteredJobs,
  activeFocus = 'none',
  now,
  onApplyPreset,
  onQuickFocus,
}: PersonalRadarProps) {
  const [presets, setPresets] = useState<RadarPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [presetError, setPresetError] = useState('');

  useEffect(() => {
    queueMicrotask(() => {
      const loaded = loadRadarPresets();
      setPresets(loaded);
      let savedActive: string | null = null;
      try { savedActive = window.localStorage.getItem(RADAR_ACTIVE_PRESET_STORAGE); } catch { /* Storage may be blocked. */ }
      if (savedActive && loaded.some((p) => p.id === savedActive)) {
        setActivePresetId(savedActive);

      }
    });
  }, []);

  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 600px)');
    queueMicrotask(() => setCollapsed(mobile.matches));
    const adjust = () => setCollapsed(mobile.matches);
    mobile.addEventListener('change', adjust);
    return () => mobile.removeEventListener('change', adjust);
  }, []);

  const metrics = useMemo(() => {
    return computeRadarMetrics(filteredJobs, now);
  }, [filteredJobs, now]);

  const handleSelectPreset = (preset: RadarPreset) => {
    setActivePresetId(preset.id);
    try {
      window.localStorage.setItem(RADAR_ACTIVE_PRESET_STORAGE, preset.id);
    } catch {
      // ignore
    }
    onApplyPreset(preset.filters);
  };

  const handleSaveCurrentAsPreset = () => {
    const name = newPresetName.trim();
    if (!name) return;
    const newPreset: RadarPreset = {
      id: `preset-${Date.now()}`,
      name,
      filters: { ...currentFilters, view: 'all', radarFocus: 'none', onlyNew: false, onlyUnread: false },
      createdAt: new Date().toISOString(),
    };
    const updated = [...presets, newPreset];
    if (!saveRadarPresets(updated)) {
      setPresetError('浏览器未允许保存，请检查存储设置后重试。');
      return;
    }
    setPresetError('');
    setPresets(updated);
    setActivePresetId(newPreset.id);
    try {
      window.localStorage.setItem(RADAR_ACTIVE_PRESET_STORAGE, newPreset.id);
    } catch {
      // ignore
    }
    setNewPresetName('');
    setIsAdding(false);
  };

  const handleDeletePreset = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (presets.length <= 1) return;
    const updated = presets.filter((p) => p.id !== id);
    if (!saveRadarPresets(updated)) {
      setPresetError('浏览器未允许保存，请检查存储设置后重试。');
      return;
    }
    setPresetError('');
    setPresets(updated);
    if (activePresetId === id) {
      setActivePresetId(updated[0]?.id ?? null);
    }
  };

  const stats: {
    focus: QuickFocus;
    label: string;
    count: number;
    icon: typeof Zap;
    hot?: boolean;
    activeTitle: string;
    idleTitle: string;
  }[] = [
    {
      focus: 'today',
      label: '今日发布 / 收录',
      count: metrics.todayCount,
      icon: Zap,
      activeTitle: `已聚焦今日发布 / 收录（共 ${metrics.todayCount} 条），再次点击可取消`,
      idleTitle: `点击查看今日发布或首次收录机会（共 ${metrics.todayCount} 条）`,
    },
    {
      focus: 'supplement',
      label: '补录机会',
      count: metrics.supplementCount,
      icon: BookmarkCheck,
      activeTitle: `已聚焦补录机会（共 ${metrics.supplementCount} 条），再次点击可取消`,
      idleTitle: `点击快速筛选最新补录与补招机会（共 ${metrics.supplementCount} 条）`,
    },
    {
      focus: 'urgent',
      label: '3 天内截止',
      count: metrics.urgentCount,
      icon: Clock,
      hot: metrics.urgentCount > 0,
      activeTitle: `已聚焦3天内截止机会（共 ${metrics.urgentCount} 条），再次点击可取消`,
      idleTitle: `点击筛选即将截止的机会（共 ${metrics.urgentCount} 条）`,
    },
    {
      focus: 'change',
      label: '近期变更',
      count: metrics.changeCount,
      icon: Bell,
      activeTitle: `已聚焦近期变更机会（共 ${metrics.changeCount} 条），再次点击可取消`,
      idleTitle: `点击筛选延期、补录及重要变更机会（共 ${metrics.changeCount} 条）`,
    },
  ];

  return (
    <section className={`focus-panel ${collapsed ? 'is-collapsed' : ''}`} aria-label="个人机会雷达">
      <div className="focus-head">
        <div className="focus-title">
          <strong>我的筛选方案</strong>
          <small>下方数量按当前筛选统计</small>
        </div>
        <div className="focus-actions">
          {!isAdding && (
            <button
              type="button"
              className="text-btn"
              onClick={() => setIsAdding(true)}
              title="将当前各项筛选保存为我的专属雷达"
            >
              <Plus />
              保存当前筛选
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? '展开雷达' : '折叠雷达'}
          >
            {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
      </div>

      {presetError && <output className="focus-error">{presetError}</output>}
      {isAdding && (
        <div className="preset-create">
          <Input
            className="field-input"
            aria-label="筛选方案名称" maxLength={32} placeholder="例如：济南 · 2027校招"
            value={newPresetName}
            onChange={(e) => setNewPresetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveCurrentAsPreset();
              if (e.key === 'Escape') setIsAdding(false);
            }}
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleSaveCurrentAsPreset}
            disabled={!newPresetName.trim()}
          >
            <Check />
            保存
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setIsAdding(false)}>
            取消
          </button>
        </div>
      )}

      {!collapsed && (
        <>
          <fieldset className="preset-tabs" aria-label="雷达方案列表">
            {presets.map((preset) => {
              const isActive = activePresetId === preset.id && Object.entries(preset.filters).every(([key, value]) => currentFilters[key as keyof Filters] === value);
              return (
                <div
                  key={preset.id}
                  className={`preset-chip ${isActive ? 'is-active' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectPreset(preset)}
                    aria-pressed={isActive}
                  >
                    {preset.name}
                  </button>
                  {presets.length > 1 && (
                    <button
                      type="button"
                      className="preset-del"
                      onClick={(e) => handleDeletePreset(preset.id, e)}
                      title={`删除方案 ${preset.name}`}
                      aria-label={`删除方案 ${preset.name}`}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </fieldset>

          <div className="focus-stats">
            {stats.map(({ focus, label, count, icon: Icon, hot, activeTitle, idleTitle }) => {
              const active = activeFocus === focus;
              return (
                <button
                  key={focus}
                  type="button"
                  className={`focus-stat ${hot ? 'is-hot' : ''}`}
                  onClick={() => onQuickFocus(focus)}
                  aria-pressed={active}
                  title={active ? activeTitle : idleTitle}
                >
                  <span className="focus-stat-label">
                    <Icon />
                    {label}
                  </span>
                  <span className="focus-stat-value">{count}</span>
                  {active && <span className="focus-stat-state">已聚焦</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
