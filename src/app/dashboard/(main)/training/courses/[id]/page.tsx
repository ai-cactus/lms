import React from 'react';
import { notFound } from 'next/navigation';
import TrainingDetails from '@/components/dashboard/training/TrainingDetails';
import { loadCourseDetail } from '@/lib/course/load-course-detail';
import { can } from '@/lib/rbac/permissions';
import { isAdminRole } from '@/lib/rbac/role-utils';
import { requirePermission } from '@/lib/rbac/require-permission';
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

  // The same gate as the sibling Preview route. Without it this page leaned
  // entirely on loadCourseDetail, whose enrolment door let an admin-portal role
  // with no Courses remit (Finance) open the management view of any course it
  // was enrolled on. `isAdminRole` is load-bearing alongside the verb: every
  // worker role holds `course.read` for its own learning, so the verb alone
  // would admit them should a worker-role session ever reach this portal.
  // `notFound` because the URL is id-addressed — a redirect confirms the id.
  const { role, roleKey, organizationId } = await requirePermission('course.read', {
    onDeny: 'notFound',
  });
  if (!isAdminRole(role)) notFound();

  const course = await loadCourseDetail(params.id);
  if (!course) {
    notFound();
  }

  // Mirrors removeWorkerAssignment's own gate: the `assignment.delete` verb and
  // an organisation to act in. Tenancy is per ENROLMENT there, not per course —
  // an adopted video course is authored by Theraptly, yet its roster here is
  // this organisation's own learners (both course-detail reads scope the roster
  // to the caller's org), so keying this on the course creator hid the control
  // on every adopted course.
  const canWithdrawAssignments = can(roleKey, 'assignment.delete') && !!organizationId;

  // Both reads THROW `Forbidden` without `assignment.read`, which a `course.read`
  // holder does not necessarily have, so they must be skipped rather than
  // caught: a rejected promise here would take the whole page down. No settings
  // means no role picker, which is the correct outcome anyway.
  const canReadAssignments = can(roleKey, 'assignment.read');
  const [assignmentSettings, roleHolderCounts] = canReadAssignments
    ? await Promise.all([getCourseAssignmentSettings(params.id), getRoleHolderCounts()])
    : [null, {}];

  return (
    <TrainingDetails
      course={course}
      canWithdrawAssignments={canWithdrawAssignments}
      backHref="/dashboard/courses"
      assignmentSettings={assignmentSettings}
      roleHolderCounts={roleHolderCounts}
      canCreateRoleTargets={can(roleKey, 'assignment.create')}
      canRevokeRoleTargets={can(roleKey, 'assignment.delete')}
    />
  );
}
