import React from 'react';
import { notFound } from 'next/navigation';
import { getCourseById, getCourseForOrgView } from '@/app/actions/course';
import TrainingDetails from '@/components/dashboard/training/TrainingDetails';
import type { CourseWithRelations } from '@/types/course';

export const dynamic = 'force-dynamic';

// Next.js 15+: params is a Promise
interface PageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function CourseDetailsPage(props: PageProps) {
  const params = await props.params;

  // Creator/enrolled get the full view via getCourseById. When that denies
  // access, fall back to the org-scoped global-catalog view so an org admin can
  // open a global course they're only browsing (the "View" flow). 404 only when
  // neither applies.
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

  return <TrainingDetails course={course} />;
}
