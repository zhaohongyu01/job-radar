import type { Filters } from './jobs.ts';
import type { ExamUserProfile } from './exams.ts';
import { readStore, writeStore } from './local-store.ts';

export const UNIFIED_PROFILE_STORAGE = 'job-radar-unified-profile-v1';
export const JOBS_UNIFIED_SYNC_AT = 'job-radar-jobs-unified-sync-at-v1';
export const EXAMS_UNIFIED_SYNC_AT = 'job-radar-exams-unified-sync-at-v1';

export type UnifiedEducation = '全部' | '专科' | '本科' | '硕士' | '博士';
export type UnifiedGradIdentity = '不限' | '当年应届' | '择业期应届' | '在职/社会人员';

export interface UnifiedCareerProfile {
  cities: string[];
  education: UnifiedEducation;
  majorCategory: string;
  majorQuery: string;
  gradIdentity: UnifiedGradIdentity;
  updatedAt?: string;
}

export const DEFAULT_UNIFIED_PROFILE: UnifiedCareerProfile = {
  cities: [],
  education: '全部',
  majorCategory: '',
  majorQuery: '',
  gradIdentity: '不限',
};

const EDU_SET = new Set<UnifiedEducation>(['全部', '专科', '本科', '硕士', '博士']);
const GRAD_SET = new Set<UnifiedGradIdentity>(['不限', '当年应届', '择业期应届', '在职/社会人员']);

export function validateUnifiedProfile(input: unknown): UnifiedCareerProfile {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('个人画像格式不正确');
  }
  const r = input as Record<string, unknown>;
  const cities = Array.isArray(r.cities)
    ? r.cities
        .filter((c): c is string => typeof c === 'string' && c.trim().length > 0 && c.length <= 20)
        .filter((c) => c !== '全部' && c !== '全部城市')
        .slice(0, 12)
    : [];
  const education: UnifiedEducation =
    typeof r.education === 'string' && EDU_SET.has(r.education as UnifiedEducation)
      ? (r.education as UnifiedEducation)
      : '全部';
  const majorCategory =
    typeof r.majorCategory === 'string' && r.majorCategory.length <= 40 ? r.majorCategory.trim() : '';
  const majorQuery =
    typeof r.majorQuery === 'string' && r.majorQuery.length <= 60 ? r.majorQuery.trim() : '';
  const gradIdentity: UnifiedGradIdentity =
    typeof r.gradIdentity === 'string' && GRAD_SET.has(r.gradIdentity as UnifiedGradIdentity)
      ? (r.gradIdentity as UnifiedGradIdentity)
      : '不限';
  const updatedAt =
    typeof r.updatedAt === 'string' && r.updatedAt.length <= 40 ? r.updatedAt : undefined;

  return {
    cities,
    education,
    majorCategory,
    majorQuery,
    gradIdentity,
    ...(updatedAt ? { updatedAt } : {}),
  };
}

export function isUnifiedProfileConfigured(profile: UnifiedCareerProfile): boolean {
  return Boolean(
    profile.cities.length > 0 ||
      profile.education !== '全部' ||
      profile.majorCategory ||
      profile.majorQuery ||
      profile.gradIdentity !== '不限',
  );
}

export function formatUnifiedProfileSummary(profile: UnifiedCareerProfile): string {
  const parts: string[] = [];
  if (profile.cities.length > 0) {
    parts.push(
      profile.cities.slice(0, 2).join('、') +
        (profile.cities.length > 2 ? `等${profile.cities.length}城` : ''),
    );
  }
  if (profile.education !== '全部') parts.push(profile.education);
  const majorText = profile.majorQuery || profile.majorCategory;
  if (majorText) parts.push(majorText);
  if (profile.gradIdentity !== '不限') parts.push(profile.gradIdentity);
  return parts.join(' · ');
}

export function examProfileToUnified(
  examProfile: ExamUserProfile,
  examCities?: string[],
  existing: UnifiedCareerProfile = DEFAULT_UNIFIED_PROFILE,
): UnifiedCareerProfile {
  let education: UnifiedEducation = '全部';
  if (examProfile.education === '专科') education = '专科';
  else if (examProfile.education === '本科') education = '本科';
  else if (examProfile.education === '硕士研究生') education = '硕士';
  else if (examProfile.education === '博士研究生') education = '博士';

  const cities =
    examCities === undefined
      ? existing.cities
      : examCities.filter(
          (c) => c && c !== '全部' && c !== '全部城市' && c !== '山东省直' && c !== '全国',
        );
  return {
    cities,
    education,
    majorCategory: (examProfile.majorCategory || '').trim(),
    majorQuery: (examProfile.majorQuery || '').trim(),
    gradIdentity: examProfile.gradIdentity,
    updatedAt: new Date().toISOString(),
  };
}

export function unifiedToExamProfilePatch(profile: UnifiedCareerProfile): Partial<ExamUserProfile> {
  let education: ExamUserProfile['education'] = '全部';
  if (profile.education === '专科') education = '专科';
  else if (profile.education === '本科') education = '本科';
  else if (profile.education === '硕士') education = '硕士研究生';
  else if (profile.education === '博士') education = '博士研究生';

  return {
    education,
    majorCategory: profile.majorCategory,
    majorQuery: profile.majorQuery,
    gradIdentity: profile.gradIdentity,
  };
}

export function jobFiltersToUnified(
  filters: Pick<Filters, 'workCities' | 'city' | 'education' | 'major' | 'type'>,
  existing: UnifiedCareerProfile = DEFAULT_UNIFIED_PROFILE,
): UnifiedCareerProfile {
  const cities =
    filters.workCities && filters.workCities.length > 0
      ? filters.workCities.filter((c) => c && c !== '全部城市')
      : filters.city && filters.city !== '全部城市'
        ? [filters.city]
        : [];

  let education: UnifiedEducation = '全部';
  if (filters.education === '大专') education = '专科';
  else if (filters.education === '本科') education = '本科';
  else if (filters.education === '硕士') education = '硕士';
  else if (filters.education === '博士') education = '博士';

  let gradIdentity: UnifiedGradIdentity = '不限';
  if (filters.type === '校招') {
    gradIdentity = existing.gradIdentity === '择业期应届' ? '择业期应届' : '当年应届';
  } else if (filters.type === '社招') {
    gradIdentity = '在职/社会人员';
  }

  const majorTrimmed = (filters.major || '').trim();
  const keepCategory =
    Boolean(majorTrimmed) &&
    (majorTrimmed === existing.majorQuery ||
      majorTrimmed === existing.majorCategory.replace(/类$/, ''));
  return {
    cities,
    education,
    majorCategory: keepCategory ? existing.majorCategory : '',
    majorQuery: majorTrimmed,
    gradIdentity,
    updatedAt: new Date().toISOString(),
  };
}

export function unifiedToJobFiltersPatch(profile: UnifiedCareerProfile): Partial<Filters> {
  const patch: Partial<Filters> = {};
  if (profile.cities.length > 0) {
    patch.workCities = [...profile.cities];
    patch.city = profile.cities.length === 1 ? profile.cities[0] : '全部城市';
  }
  if (profile.education !== '全部') {
    patch.education = profile.education === '专科' ? '大专' : profile.education;
  }
  const majorText = (profile.majorQuery || profile.majorCategory || '').replace(/类$/, '').trim();
  if (majorText) {
    patch.major = majorText;
  }
  if (profile.gradIdentity === '当年应届' || profile.gradIdentity === '择业期应届') {
    patch.type = '校招';
  } else if (profile.gradIdentity === '在职/社会人员') {
    patch.type = '社招';
  }
  return patch;
}

export function unifiedToJobFiltersSyncPatch(profile: UnifiedCareerProfile): Partial<Filters> {
  const majorText = (profile.majorQuery || profile.majorCategory || '').replace(/类$/, '').trim();
  const type =
    profile.gradIdentity === '当年应届' || profile.gradIdentity === '择业期应届'
      ? '校招'
      : profile.gradIdentity === '在职/社会人员'
        ? '社招'
        : '全部';
  return {
    workCities: [...profile.cities],
    city: profile.cities.length === 1 ? profile.cities[0] : '全部城市',
    education:
      profile.education === '全部'
        ? ''
        : profile.education === '专科'
          ? '大专'
          : profile.education,
    major: majorText,
    type,
  };
}

export function shouldApplyUnifiedSync(
  unified: UnifiedCareerProfile,
  lastWorkspaceSyncAt?: string | null,
): boolean {
  if (!unified.updatedAt) return false;
  const unifiedMs = Date.parse(unified.updatedAt);
  if (Number.isNaN(unifiedMs)) return false;
  if (lastWorkspaceSyncAt) {
    const lastMs = Date.parse(lastWorkspaceSyncAt);
    if (!Number.isNaN(lastMs) && unifiedMs <= lastMs) return false;
    return true;
  }
  return isUnifiedProfileConfigured(unified);
}

export function readWorkspaceUnifiedSync(workspace: 'jobs' | 'exams'): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(
      workspace === 'jobs' ? JOBS_UNIFIED_SYNC_AT : EXAMS_UNIFIED_SYNC_AT,
    );
  } catch {
    return null;
  }
}

export function recordWorkspaceUnifiedSync(
  workspace: 'jobs' | 'exams',
  updatedAt?: string,
): void {
  if (typeof window === 'undefined' || !updatedAt) return;
  try {
    window.localStorage.setItem(
      workspace === 'jobs' ? JOBS_UNIFIED_SYNC_AT : EXAMS_UNIFIED_SYNC_AT,
      updatedAt,
    );
  } catch {
    // ignore storage errors
  }
}

export function readUnifiedProfile(): UnifiedCareerProfile {
  return readStore(UNIFIED_PROFILE_STORAGE, validateUnifiedProfile, DEFAULT_UNIFIED_PROFILE);
}

export function writeUnifiedProfile(profile: UnifiedCareerProfile): void {
  writeStore(UNIFIED_PROFILE_STORAGE, validateUnifiedProfile(profile));
}

export function writeUnifiedProfileFromWorkspace(
  workspace: 'jobs' | 'exams',
  profile: UnifiedCareerProfile,
): UnifiedCareerProfile {
  const validated = validateUnifiedProfile({
    ...profile,
    updatedAt: profile.updatedAt || new Date().toISOString(),
  });
  writeStore(UNIFIED_PROFILE_STORAGE, validated);
  recordWorkspaceUnifiedSync(workspace, validated.updatedAt);
  return validated;
}
