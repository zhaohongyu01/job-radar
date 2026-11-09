import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://sites-project.job-radar.workers.dev';
  const now = new Date();
  return [
    {
      url: `${base}/`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${base}/exams`,
      lastModified: now,
      changeFrequency: 'daily',
      priority: 0.9,
    },
  ];
}
