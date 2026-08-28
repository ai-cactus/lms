import React from 'react';
import { notFound } from 'next/navigation';
import TrainingDetails from '@/components/dashboard/training/TrainingDetails';
import { loadCourseDetail } from '@/lib/course/load-course-detail';

export const dynamic = 'force-dynamic';

// Next.js 15+: params is a Promise
interface PageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function CourseDetailsPage(props: PageProps) {
  const params = await props.params;

  const course = await loadCourseDetail(params.id);
  if (!course) {
    notFound();
  }

  return <TrainingDetails course={course} />;
}
