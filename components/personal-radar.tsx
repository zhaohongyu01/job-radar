'use client';

import { useState, useEffect, useMemo } from 'react';
import { Radar, Plus, Zap, Clock, BookmarkCheck, ChevronUp, ChevronDown, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Filters, Job } from '@/lib/jobs';
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
  onApplyPreset: (presetFilters: Partial<Filters>) => void;
  onQuickFocus: (focus: 'today' | 'supplement' | 'urgent') => void;
};

export function PersonalRadar({
  currentFilters,
  filteredJobs,
  onApplyPreset,
  onQuickFocus,
}: PersonalRadarProps) {
  const [presets, setPresets] = useState<RadarPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      const loaded = loadRadarPresets();
      setPresets(loaded);
      const savedActive = window.localStorage.getItem(RADAR_ACTIVE_PRESET_STORAGE);
      if (savedActive && loaded.some((p) => p.id === savedActive)) {
        setActivePresetId(savedActive);
      } else if (loaded.length > 0) {
        setActivePresetId(loaded[0].id);
      }
    });
  }, []);

  const metrics = useMemo(() => {
    return computeRadarMetrics(filteredJobs);
  }, [filteredJobs]);

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
      filters: {
        city: currentFilters.city,
        locationScope: currentFilters.locationScope,
        year: currentFilters.year,
        type: currentFilters.type,
        sector: currentFilters.sector,
        direction: currentFilters.direction,
        salary: currentFilters.salary,
        query: currentFilters.query,
      },
      createdAt: new Date().toISOString(),
    };
    const updated = [...presets, newPreset];
    setPresets(updated);
    saveRadarPresets(updated);
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
    setPresets(updated);
    saveRadarPresets(updated);
    if (activePresetId === id) {
      setActivePresetId(updated[0]?.id ?? null);
    }
  };

  return (
    <div className={`personal-radar-card ${collapsed ? 'collapsed' : ''}`} aria-label="个人机会雷达">
      <div className="radar-header">
        <div className="radar-title-box">
          <div className="radar-icon-pulse">
            <Radar size={18} className="radar-pulse-svg" />
          </div>
          <span className="radar-main-title">每日机会雷达</span>
          <span className="radar-sub-desc">已为当前关注条件动态扫描全网机会</span>
        </div>

        <div className="radar-header-actions">
          {!isAdding && (
            <Button
              variant="outline"
              size="sm"
              className="radar-add-btn"
              onClick={() => setIsAdding(true)}
              title="将当前各项筛选保存为我的专属雷达"
            >
              <Plus size={14} />
              <span>设为新雷达</span>
            </Button>
          )}
          <button
            type="button"
            className="radar-collapse-toggle"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? '展开雷达' : '折叠雷达'}
          >
            {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
      </div>

      {isAdding && (
        <div className="radar-create-row">
          <Input
            className="radar-name-input"
            placeholder="输入雷达方案名称（例如：济南 · 2027校招）"
            value={newPresetName}
            onChange={(e) => setNewPresetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveCurrentAsPreset();
              if (e.key === 'Escape') setIsAdding(false);
            }}
          />
          <Button size="sm" onClick={handleSaveCurrentAsPreset} disabled={!newPresetName.trim()}>
            <Check size={14} />
            保存
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setIsAdding(false)}>
            取消
          </Button>
        </div>
      )}

      {!collapsed && (
        <>
          <div className="radar-presets-row" role="tablist" aria-label="雷达方案列表">
            {presets.map((preset) => {
              const isActive = activePresetId === preset.id;
              return (
                <div
                  key={preset.id}
                  className={`radar-preset-chip ${isActive ? 'active' : ''}`}
                >
                  <button
                    type="button"
                    className="preset-name-btn"
                    onClick={() => handleSelectPreset(preset)}
                    role="tab"
                    aria-selected={isActive}
                  >
                    {preset.name}
                  </button>
                  {presets.length > 1 && (
                    <button
                      type="button"
                      className="preset-delete-btn"
                      onClick={(e) => handleDeletePreset(preset.id, e)}
                      title={`删除方案 ${preset.name}`}
                      aria-label={`删除方案 ${preset.name}`}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="radar-metrics-row">
            <button
              type="button"
              className="radar-stat-pill today"
              onClick={() => onQuickFocus('today')}
              title="点击查看今日最新发布机会"
            >
              <Zap size={14} className="stat-icon" />
              <span className="stat-label">今日新发</span>
              <span className="stat-count">{metrics.todayCount}</span>
            </button>

            <button
              type="button"
              className="radar-stat-pill supplement"
              onClick={() => onQuickFocus('supplement')}
              title="点击快速筛选最新补录与补招机会"
            >
              <BookmarkCheck size={14} className="stat-icon" />
              <span className="stat-label">新开补录</span>
              <span className="stat-count">{metrics.supplementCount}</span>
            </button>

            <button
              type="button"
              className="radar-stat-pill urgent"
              onClick={() => onQuickFocus('urgent')}
              title="点击将即将截止的机会排在最前面"
            >
              <Clock size={14} className="stat-icon" />
              <span className="stat-label">3天内截止</span>
              <span className="stat-count">{metrics.urgentCount}</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
