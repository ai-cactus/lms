import React from 'react';
import { notFound } from 'next/navigation';
import CoursePreview from '@/components/dashboard/training/CoursePreview';
import { loadCourseDetail } from '@/lib/course/load-course-detail';
import { requirePermission } from '@/lib/rbac/require-permission';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function CoursePreviewPage(props: PageProps) {
  const params = await props.params;

  // Had no page-level gate at all — it relied entirely on loadCourseDetail's
  // data-layer refusal. `course.read` is the same verb the Training list and
  // the sibling detail route resolve against, and `notFound` is the deny shape
  // for an id-addressed page: a redirect would confirm the id exists.
  await requirePermission('course.read', { onDeny: 'notFound' });

  const course = await loadCourseDetail(params.id);
  if (!course) {
    notFound();
  }

  return <CoursePreview course={course} />;
}
