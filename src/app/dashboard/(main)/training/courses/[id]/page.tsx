import React from 'react';
import { notFound } from 'next/navigation';
import TrainingDetails from '@/components/dashboard/training/TrainingDetails';
import { loadCourseDetail } from '@/lib/course/load-course-detail';
import { auth } from '@/auth';

export const dynamic = 'force-dynamic';

// Next.js 15+: params is a Promise
interface PageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function CourseDetailsPage(props: PageProps) {
  const params = await props.params;

  const [course, session] = await Promise.all([loadCourseDetail(params.id), auth()]);
  if (!course) {
    notFound();
  }

  // Mirrors removeWorkerAssignment's own gate, so the control is only offered
  // where it would actually succeed. An admin viewing a course someone else
  // created still sees the roster — reading it and withdrawing from it are
  // separate rights.
  const canWithdrawAssignments =
    !!session?.user?.organizationUserId &&
    course.createdByOrgUserId === session.user.organizationUserId;

  return <TrainingDetails course={course} canWithdrawAssignments={canWithdrawAssignments} />;
}
