import React from 'react';
import { notFound } from 'next/navigation';
import CoursePreview from '@/components/dashboard/training/CoursePreview';
import { loadCourseDetail } from '@/lib/course/load-course-detail';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function CoursePreviewPage(props: PageProps) {
  const params = await props.params;

  const course = await loadCourseDetail(params.id);
  if (!course) {
    notFound();
  }

  return <CoursePreview course={course} />;
}
