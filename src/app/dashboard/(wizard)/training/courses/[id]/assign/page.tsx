import React from 'react';
import { dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import { can } from '@/lib/rbac/permissions';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { hasActiveBilling } from '@/lib/billing';
import { getCourseAssignmentSettings, getRoleHolderCounts } from '@/app/actions/enrollment';
import AssignPublishClient from '@/components/dashboard/training/AssignPublishClient';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AssignCoursePage(props: PageProps) {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const { role, organizationId, organizationUserId } = session.user;
  // Gate the wizard on the same permission its submit actions require, so a
  // read-only admin-tier role (Supervisor) or one with no training remit
  // (Finance) is redirected here rather than reaching a page whose every
  // action would deny.
  if (!can(dbRoleToRoleKey(role), 'assignment.create')) redirect('/dashboard');

  // Block URL-bypass of the billing gate: assigning courses requires active
  // billing. Redirect to the courses list where the gate UI is shown.
  const organization = organizationId
    ? await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { subscription: { select: { status: true, pausedAt: true } } },
      })
    : null;
  if (!hasActiveBilling(organization?.subscription)) {
    redirect('/dashboard/courses');
  }

  const { id } = await props.params;

  // Assignable when it's a global published course (catalog), the admin's own
  // course, or one their org has already offered.
  const course = await prisma.course.findFirst({
    where: {
      id,
      OR: [
        { isGlobal: true, status: 'published' },
        ...(organizationUserId ? [{ createdByOrgUserId: organizationUserId }] : []),
        ...(organizationId ? [{ offerings: { some: { organizationId } } }] : []),
      ],
    },
    select: { id: true, title: true, status: true },
  });
  if (!course) redirect('/dashboard/courses');

  const [existingSettings, roleHolderCounts] = await Promise.all([
    getCourseAssignmentSettings(course.id),
    getRoleHolderCounts(),
  ]);

  // Surface emails that were assigned this course but haven't joined yet, so an
  // admin can see the assignment isn't lost. Scoped strictly to the caller's org
  // via the parked invite; expired/accepted invites are excluded.
  const pendingInvitedEmails = organizationId
    ? Array.from(
        new Set(
          (
            await prisma.inviteCourseAssignment.findMany({
              where: {
                courseId: course.id,
                invite: {
                  organizationId,
                  status: 'pending',
                  expiresAt: { gt: new Date() },
                },
              },
              select: { invite: { select: { email: true } } },
              orderBy: { createdAt: 'desc' },
            })
          ).map((row) => row.invite.email),
        ),
      )
    : [];

  return (
    <AssignPublishClient
      courseId={course.id}
      courseTitle={course.title}
      courseStatus={course.status}
      existingSettings={existingSettings}
      roleHolderCounts={roleHolderCounts}
      pendingInvitedEmails={pendingInvitedEmails}
    />
  );
}
