import type { Job } from './jobs.ts';
import { duplicateSourceNames, mergeJobIntoExisting, promotePreferredCampusPrimary } from './jobs.ts';

export type JobSourceChannel = {
  /** Stable identifier for active selection (URL when available, else fallback key). */
  key: string;
  /** True for the primary canonical source on the job record. */
  isPrimary: boolean;
  /** Display channel / school / platform name. */
  sourceName: string;
  /** Announcement title published on this specific channel. */
  title: string;
  /** Original announcement URL on this channel (empty if placeholder before detail loads). */
  url: string;
  /** Direct application URL if this channel specifies one. */
  applicationUrl: string | null;
  /** Publication date on this channel if known. */
  publishedAt: string | null;
  /** Optional full announcement body specific to this channel. */
  body?: string;
  /** Optional excerpt specific to this channel. */
  excerpt?: string;
  /** True when the entry is a name-only preview from listing_facts before detail loads. */
  previewOnly?: boolean;
  /** Number of raw duplicate postings merged under this same channel name (when > 1). */
  postCount?: number;
};

function readFactString(facts: Record<string, unknown> | undefined, key: string): string | undefined {
  const val = facts?.[key];
  return typeof val === 'string' && val.trim() ? val : undefined;
}

function normalizeChannelNameKey(name: string): string {
  return name.trim().replace(/\s+/g, '');
}

function isPreferredChannelName(name: string): boolean {
  return name.includes('山东财经大学');
}

function trailingUrlNumericId(url: string): number {
  const match = url.match(/(\d{4,})(?:\/)?(?:\?.*)?$/);
  return match ? Number(match[1]) : 0;
}

function isBetterChannelCandidate(candidate: JobSourceChannel, current: JobSourceChannel): boolean {
  if (candidate.isPrimary !== current.isPrimary) return candidate.isPrimary;
  if (Boolean(candidate.previewOnly) !== Boolean(current.previewOnly)) return !candidate.previewOnly;
  const candApp = candidate.applicationUrl ? 1 : 0;
  const currApp = current.applicationUrl ? 1 : 0;
  if (candApp !== currApp) return candApp > currApp;
  const candGenericTitle = candidate.title.includes('面向我校') ? 0 : 1;
  const currGenericTitle = current.title.includes('面向我校') ? 0 : 1;
  if (candGenericTitle !== currGenericTitle) return candGenericTitle > currGenericTitle;
  const candBody = (candidate.body ?? '').length;
  const currBody = (current.body ?? '').length;
  if (candBody !== currBody) return candBody > currBody;
  const candDate = candidate.publishedAt ?? '';
  const currDate = current.publishedAt ?? '';
  if (candDate !== currDate) return candDate > currDate;
  return trailingUrlNumericId(candidate.url) > trailingUrlNumericId(current.url);
}

/**
 * Return duplicate_ids on `browseJob` that are not yet accounted for by `primaryDetail`.
 * Because `mergeJobIntoExisting` appends each merged canonical sibling's own `id`
 * before its nested `duplicate_ids`, iterating from the front lets the loader fetch
 * the canonical sibling record first and skip its already-nested IDs in one hop.
 */
export function findMissingSiblingIds(browseJob: Job, primaryDetail: Job): string[] {
  const browseDupIds = browseJob.duplicate_ids ?? [];
  if (!browseDupIds.length) return [];
  const covered = new Set<string>([primaryDetail.id, ...(primaryDetail.duplicate_ids ?? [])]);
  return browseDupIds.filter((id) => Boolean(id) && !covered.has(id));
}

/**
 * Deterministically merge cross-shard sibling detail records (produced when
 * `build_browse_index.mjs` deduplicates canonical records offline) into a single
 * hydrated detail Job, preserving each merged channel's URL, title, date and body facts.
 */
export function mergeDetailRecords(
  browseJob: Job,
  primaryDetail: Job,
  siblingDetails: readonly Job[] = [],
): Job {
  const merged: Job = {
    ...primaryDetail,
    duplicate_sources: primaryDetail.duplicate_sources
      ? primaryDetail.duplicate_sources.map((s) => ({ ...s }))
      : [],
    duplicate_ids: primaryDetail.duplicate_ids ? [...primaryDetail.duplicate_ids] : [],
    talk_events: browseJob.talk_events ?? primaryDetail.talk_events,
  };

  for (const sibling of siblingDetails) {
    if (!sibling || sibling.id === merged.id) continue;
    const siblingClone: Job = {
      ...sibling,
      duplicate_sources: sibling.duplicate_sources
        ? sibling.duplicate_sources.map((s) => ({ ...s }))
        : [],
      duplicate_ids: sibling.duplicate_ids ? [...sibling.duplicate_ids] : [],
    };
    mergeJobIntoExisting(merged, siblingClone);
    // Attach full announcement title & body facts onto the newly added entry for sibling's primary URL
    // so users switching to this channel inside DetailDrawer see its exact original text.
    if (sibling.source_url && merged.duplicate_sources?.length) {
      const entry = merged.duplicate_sources.find((s) => s.url === sibling.source_url);
      if (entry) {
        if (!entry.announcement_title && sibling.title) entry.announcement_title = sibling.title;
        if (!entry.facts && (sibling.body || sibling.excerpt)) {
          entry.facts = {
            ...(sibling.body ? { body: sibling.body } : {}),
            ...(sibling.excerpt ? { excerpt: sibling.excerpt } : {}),
            ...(sibling.title ? { title: sibling.title } : {}),
            ...(sibling.published_at ? { published_at: sibling.published_at } : {}),
            ...(sibling.application_url ? { application_url: sibling.application_url } : {}),
          };
        }
      }
    }
  }

  // Keep upgraded cleaner title from browseJob when primaryDetail still carries school-local "面向我校"
  if (
    (merged.title ?? '').includes('面向我校') &&
    browseJob.title &&
    !browseJob.title.includes('面向我校')
  ) {
    merged.title = browseJob.title;
  }

  return promotePreferredCampusPrimary(merged);
}

/**
 * Extract an ordered list of distinct channels for a job, deduplicating both
 * identical URLs and same-channel repeat submissions (e.g. an HR posting the
 * exact same announcement twice to the same university portal).
 * When called on a lightweight browse-index record before detail shards load,
 * falls back to deduplicated `listing_facts.source_names` preview items so the
 * count stays identical before and after hydration.
 */
export function extractJobChannels(job: Job): JobSourceChannel[] {
  const rawChannels: JobSourceChannel[] = [];
  const seenUrls = new Set<string>();

  const primaryUrl = job.source_url || '';
  const primaryName = job.source_name || job.source || job.source_id || '原发布渠道';
  rawChannels.push({
    key: primaryUrl || `primary:${job.id}`,
    isPrimary: true,
    sourceName: primaryName,
    title: job.title || primaryName,
    url: primaryUrl,
    applicationUrl: job.application_url || null,
    publishedAt: job.published_at || null,
    body: job.body,
    excerpt: job.excerpt,
  });
  if (primaryUrl) seenUrls.add(primaryUrl);

  const dupSources = job.duplicate_sources ?? [];
  if (dupSources.length > 0) {
    dupSources.forEach((dup, idx) => {
      const url = dup.url || '';
      if (url && seenUrls.has(url)) return;
      if (url) seenUrls.add(url);
      const sourceName = dup.source_name || dup.source || dup.title || '同步渠道';
      const factTitle = readFactString(dup.facts, 'title');
      const title =
        dup.announcement_title ||
        factTitle ||
        (dup.title && dup.title !== sourceName ? dup.title : job.title || sourceName);
      const body = readFactString(dup.facts, 'body');
      const excerpt = readFactString(dup.facts, 'excerpt');
      const appUrl = dup.application_url || readFactString(dup.facts, 'application_url') || null;
      const pubAt = dup.published_at || readFactString(dup.facts, 'published_at') || null;
      rawChannels.push({
        key: url || `dup:${dup.id || idx}:${sourceName}`,
        isPrimary: false,
        sourceName,
        title,
        url,
        applicationUrl: appUrl,
        publishedAt: pubAt,
        body,
        excerpt,
      });
    });
  } else {
    const previewNames = duplicateSourceNames(job);
    previewNames.forEach((name, idx) => {
      const cleanName = (name || '').trim() || '同步渠道';
      rawChannels.push({
        key: `preview:${idx}:${cleanName}`,
        isPrimary: false,
        sourceName: cleanName,
        title: job.title || cleanName,
        url: '',
        applicationUrl: null,
        publishedAt: null,
        previewOnly: true,
      });
    });
  }

  // Collapse repeat submissions on the exact same school/channel portal while
  // keeping the primary entry first and selecting the cleanest/richest record per channel.
  const byChannel = new Map<string, JobSourceChannel>();
  const order: string[] = [];
  for (const ch of rawChannels) {
    const nameKey = normalizeChannelNameKey(ch.sourceName) || ch.key;
    const existing = byChannel.get(nameKey);
    if (!existing) {
      byChannel.set(nameKey, { ...ch, postCount: 1 });
      order.push(nameKey);
    } else {
      const nextCount = (existing.postCount ?? 1) + 1;
      if (isBetterChannelCandidate(ch, existing)) {
        byChannel.set(nameKey, { ...ch, isPrimary: existing.isPrimary || ch.isPrimary, postCount: nextCount });
      } else {
        existing.postCount = nextCount;
      }
    }
  }
  const deduped = order.map((k) => byChannel.get(k)!);
  // Prioritize Shandong University of Finance and Economics channels at the top
  // while preserving original relative order for all other channels.
  const preferred = deduped.filter((ch) => isPreferredChannelName(ch.sourceName));
  if (!preferred.length) return deduped;
  const others = deduped.filter((ch) => !isPreferredChannelName(ch.sourceName));
  return [...preferred, ...others];
}

/**
 * Project a non-mutating view of `job` for the user-selected channel key while
 * keeping the canonical identity (`id`, `duplicate_ids`, `positions`, `attachments`, etc.) intact.
 */
export function applyActiveChannel(
  job: Job,
  channelKey: string | null | undefined,
): { jobView: Job; activeChannel: JobSourceChannel; channels: JobSourceChannel[] } {
  const channels = extractJobChannels(job);
  const primaryChannel = channels.find((c) => c.isPrimary) ?? channels[0];
  const activeChannel =
    (channelKey ? channels.find((c) => c.key === channelKey) : undefined) ?? primaryChannel;

  if (!activeChannel || activeChannel.isPrimary || activeChannel.previewOnly) {
    return { jobView: job, activeChannel: primaryChannel, channels };
  }

  const jobView: Job = {
    ...job,
    source_name: activeChannel.sourceName,
    source_url: activeChannel.url || job.source_url,
    application_url: activeChannel.applicationUrl ?? job.application_url,
    title: activeChannel.title || job.title,
    published_at: activeChannel.publishedAt ?? job.published_at,
    body: activeChannel.body || job.body,
    excerpt: activeChannel.excerpt || job.excerpt,
  };
  return { jobView, activeChannel, channels };
}
