import React from 'react';
import { notFound } from 'next/navigation';
import TrainingDetails from '@/components/dashboard/training/TrainingDetails';
import { loadCourseDetail } from '@/lib/course/load-course-detail';
import { auth } from '@/auth';
import { can } from '@/lib/rbac/permissions';
import { dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import { getCourseAssignmentSettings, getRoleHolderCounts } from '@/app/actions/enrollment';

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

  // This page has no `course.read` gate, but /dashboard/courses does and now
  // 404s on deny (founder Q26) — so sending every viewer there made "Go Back" a
  // dead button for roles that lack it (finance, since 2026-08-25). Same
  // predicate the sidebar uses to decide whether to offer Courses at all.
  const roleKey = session?.user?.role ? dbRoleToRoleKey(session.user.role) : null;

  // Mirrors removeWorkerAssignment's own gate: the `assignment.delete` verb and
  // an organisation to act in. Tenancy is per ENROLMENT there, not per course —
  // an adopted video course is authored by Theraptly, yet its roster here is
  // this organisation's own learners (both course-detail reads scope the roster
  // to the caller's org), so keying this on the course creator hid the control
  // on every adopted course.
  const canWithdrawAssignments =
    Boolean(roleKey && can(roleKey, 'assignment.delete')) && !!session?.user?.organizationId;
  const backHref = roleKey && can(roleKey, 'course.read') ? '/dashboard/courses' : '/dashboard';

  // Both reads THROW `Forbidden` without `assignment.read`, so they must be
  // skipped rather than caught: this page is reachable by every enrolled
  // learner, and a rejected promise here would take the whole page down for
  // them. No settings means no role picker, which is the correct outcome anyway.
  const canReadAssignments = Boolean(roleKey && can(roleKey, 'assignment.read'));
  const [assignmentSettings, roleHolderCounts] = canReadAssignments
    ? await Promise.all([getCourseAssignmentSettings(params.id), getRoleHolderCounts()])
    : [null, {}];

  return (
    <TrainingDetails
      course={course}
      canWithdrawAssignments={canWithdrawAssignments}
      backHref={backHref}
      assignmentSettings={assignmentSettings}
      roleHolderCounts={roleHolderCounts}
      canCreateRoleTargets={Boolean(roleKey && can(roleKey, 'assignment.create'))}
      canRevokeRoleTargets={Boolean(roleKey && can(roleKey, 'assignment.delete'))}
    />
  );
}
