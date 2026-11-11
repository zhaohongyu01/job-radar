'use client';

import { useState } from 'react';
import { Check, Sparkles, UserCheck, X } from 'lucide-react';
import type { Filters } from '@/lib/jobs';
import {
  formatUnifiedProfileSummary,
  isUnifiedProfileConfigured,
  jobFiltersToUnified,
  readUnifiedProfile,
  unifiedToJobFiltersPatch,
  writeUnifiedProfile,
} from '@/lib/unified-profile';

export const ONBOARDED_STORAGE = 'job-radar-onboarded-v1';

const QUICK_CITIES = ['济南', '青岛', '烟台', '潍坊', '北京', '上海'];

type CohortOption = '2027' | '社招' | '全部';

export interface OnboardingCardProps {
  onComplete: (patch: Partial<Filters>) => void;
  onDismiss: () => void;
}

export function OnboardingCard({ onComplete, onDismiss }: OnboardingCardProps) {
  const [unified] = useState(() => readUnifiedProfile());
  const hasSharedProfile = isUnifiedProfileConfigured(unified);
  const [cities, setCities] = useState<string[]>(() =>
    unified.cities.length > 0 ? unified.cities.slice(0, 3) : ['济南'],
  );
  const [cohort, setCohort] = useState<CohortOption>(() =>
    unified.gradIdentity === '在职/社会人员' ? '社招' : '2027',
  );

  const toggleCity = (city: string) => {
    setCities((prev) =>
      prev.includes(city) ? prev.filter((c) => c !== city) : [...prev, city],
    );
  };

  const handleApplyShared = () => {
    onComplete(unifiedToJobFiltersPatch(unified));
  };

  const handleFinish = () => {
    const patch: Partial<Filters> = {
      workCities: cities,
      city: cities.length === 1 ? cities[0] : '全部城市',
      type: cohort === '2027' ? '校招' : cohort === '社招' ? '社招' : '全部',
      year: cohort === '2027' ? '2027' : '全部',
    };
    writeUnifiedProfile(
      jobFiltersToUnified(
        {
          workCities: cities,
          city: patch.city || '全部城市',
          education: '全部',
          major: '',
          type: patch.type || '全部',
        },
        unified,
      ),
    );
    onComplete(patch);
  };

  if (hasSharedProfile) {
    return (
      <section className="onboarding-bar" aria-label="共享求职画像提示">
        <div className="onboarding-bar-label">
          <UserCheck size={15} className="text-brand" />
          <span>
            已同步你的跨端画像：<strong>{formatUnifiedProfileSummary(unified)}</strong>
          </span>
        </div>
        <div className="onboarding-bar-actions">
          <button type="button" className="btn btn-tonal btn-xs" onClick={handleApplyShared}>
            <Check size={13} />
            <span>一键套用筛选</span>
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="关闭提示"
            onClick={onDismiss}
          >
            <X size={14} />
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="onboarding-bar" aria-label="首次访问快速设置">
      <div className="onboarding-bar-label">
        <Sparkles size={14} className="text-brand" />
        <strong>快速偏好：</strong>
      </div>

      <div className="onboarding-bar-chips">
        {QUICK_CITIES.map((city) => {
          const active = cities.includes(city);
          return (
            <button
              key={city}
              type="button"
              className="toggle-chip toggle-chip-sm"
              aria-pressed={active}
              onClick={() => toggleCity(city)}
            >
              {city}
            </button>
          );
        })}
        <span className="onboarding-bar-sep" aria-hidden="true" />
        {(
          [
            ['2027', '2027校招'],
            ['社招', '社招'],
            ['全部', '不限'],
          ] as const
        ).map(([val, label]) => (
          <button
            key={val}
            type="button"
            className="toggle-chip toggle-chip-sm"
            aria-pressed={cohort === val}
            onClick={() => setCohort(val)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="onboarding-bar-actions">
        <button type="button" className="btn btn-tonal btn-xs" onClick={handleFinish}>
          <Check size={13} />
          <span>套用</span>
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="关闭引导"
          onClick={onDismiss}
        >
          <X size={14} />
        </button>
      </div>
    </section>
  );
}
