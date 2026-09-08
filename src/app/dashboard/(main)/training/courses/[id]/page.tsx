import React from 'react';
import { notFound } from 'next/navigation';
import TrainingDetails from '@/components/dashboard/training/TrainingDetails';
import { loadCourseDetail } from '@/lib/course/load-course-detail';
import { auth } from '@/auth';
import { can } from '@/lib/rbac/permissions';
import { dbRoleToRoleKey } from '@/lib/rbac/role-utils';

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

  // This page has no `course.read` gate, but /dashboard/courses does and
  // redirects on deny — so sending every viewer there made "Go Back" a dead
  // button for roles that lack it (finance, since 2026-08-25). Same predicate
  // the sidebar uses to decide whether to offer Courses at all.
  const roleKey = session?.user?.role ? dbRoleToRoleKey(session.user.role) : null;
  const backHref = roleKey && can(roleKey, 'course.read') ? '/dashboard/courses' : '/dashboard';

  return (
    <TrainingDetails
      course={course}
      canWithdrawAssignments={canWithdrawAssignments}
      backHref={backHref}
    />
  );
}
