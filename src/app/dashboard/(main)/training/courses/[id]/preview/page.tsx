import React from 'react';
import { notFound } from 'next/navigation';
import { getCourseById, getCourseForOrgView } from '@/app/actions/course';
import CoursePreview from '@/components/dashboard/training/CoursePreview';
import type { CourseWithRelations } from '@/types/course';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function CoursePreviewPage(props: PageProps) {
  const params = await props.params;

  // Same access pattern as the management page: creator/enrolled via
  // getCourseById, otherwise the org-scoped global-catalog view so an org admin
  // can preview a global course they're only browsing.
  let course: CourseWithRelations;
  try {
    course = await getCourseById(params.id);
  } catch {
    try {
      course = await getCourseForOrgView(params.id);
    } catch {
      notFound();
    }
  }

  return <CoursePreview course={course} />;
}
