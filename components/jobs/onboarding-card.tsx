'use client';

import { useState } from 'react';
import { Check, Sparkles, X } from 'lucide-react';
import type { Filters } from '@/lib/jobs';

export const ONBOARDED_STORAGE = 'job-radar-onboarded-v1';

const HOT_CITIES = ['济南', '青岛', '烟台', '潍坊', '北京', '上海', '杭州', '深圳'];

type CohortOption = '2027' | '社招' | '全部';

export interface OnboardingCardProps {
  onComplete: (patch: Partial<Filters>) => void;
  onDismiss: () => void;
}

export function OnboardingCard({ onComplete, onDismiss }: OnboardingCardProps) {
  const [cities, setCities] = useState<string[]>(['济南']);
  const [cohort, setCohort] = useState<CohortOption>('2027');

  const toggleCity = (city: string) => {
    setCities((prev) =>
      prev.includes(city) ? prev.filter((c) => c !== city) : [...prev, city],
    );
  };

  const handleFinish = () => {
    const patch: Partial<Filters> = {
      workCities: cities,
      city: cities.length === 1 ? cities[0] : '全部城市',
      type: cohort === '2027' ? '校招' : cohort === '社招' ? '社招' : '全部',
      year: cohort === '2027' ? '2027' : '全部',
    };
    onComplete(patch);
  };

  return (
    <section className="onboarding-card" aria-label="首次访问快速设置">
      <div className="onboarding-head">
        <div className="onboarding-title">
          <Sparkles size={16} />
          <strong>快速定制你的求职偏好</strong>
          <span className="text-muted">仅保存在当前浏览器，随时可在左侧修改</span>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="关闭引导"
          onClick={onDismiss}
        >
          <X size={15} />
        </button>
      </div>

      <div className="onboarding-steps">
        <div className="onboarding-step">
          <span className="onboarding-step-label">① 意向城市（可多选）</span>
          <div className="chip-row">
            {HOT_CITIES.map((city) => {
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
          </div>
        </div>

        <div className="onboarding-step">
          <span className="onboarding-step-label">② 招聘届别 / 类型</span>
          <div className="chip-row">
            {(
              [
                ['2027', '校招 2027 届'],
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
        </div>

        <div className="onboarding-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={handleFinish}>
            <Check size={14} />
            <span>开始浏览</span>
          </button>
        </div>
      </div>
    </section>
  );
}
