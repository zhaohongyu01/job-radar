import type { Metadata } from 'next';
import { ExamsPageClient } from '@/components/exams/exams-page-client';

export const metadata: Metadata = {
  title: '山东考公考编',
  description:
    '山东省级与 16 地市公务员、事业单位、教师、医疗、选调、军队文职招考公告与岗位筛选，按报考条件找能报的岗位。',
  alternates: { canonical: '/exams' },
};

export default function ExamsPage() {
  return <ExamsPageClient />;
}
