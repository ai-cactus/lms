import React from 'react';
import { isAdminRole } from '@/lib/rbac/role-utils';
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

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      role: true,
      organizationId: true,
      organization: {
        select: {
          subscription: { select: { status: true, pausedAt: true } },
        },
      },
    },
  });
  if (!me || !isAdminRole(me.role)) redirect('/dashboard');

  // Block URL-bypass of the billing gate: assigning courses requires active
  // billing. Redirect to the courses list where the gate UI is shown.
  if (!hasActiveBilling(me.organization?.subscription)) {
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
        { createdBy: session.user.id },
        ...(me.organizationId
          ? [{ offerings: { some: { organizationId: me.organizationId } } }]
          : []),
      ],
    },
    select: { id: true, title: true, status: true },
  });
  if (!course) redirect('/dashboard/courses');

  const [existingSettings, roleHolderCounts] = await Promise.all([
    getCourseAssignmentSettings(course.id),
    getRoleHolderCounts(),
  ]);

  return (
    <AssignPublishClient
      courseId={course.id}
      courseTitle={course.title}
      courseStatus={course.status}
      existingSettings={existingSettings}
      roleHolderCounts={roleHolderCounts}
    />
  );
}
