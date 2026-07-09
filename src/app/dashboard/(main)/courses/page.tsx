import React, { Suspense } from 'react';
import { isAdminRole } from '@/lib/rbac/role-utils';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { getCourses } from '@/app/actions/course';
import { listAvailableVideoCourses } from '@/app/actions/offering';
import { hasActiveBilling } from '@/lib/billing';
import CoursesPageTabs from '@/components/dashboard/courses/CoursesPageTabs';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Courses | Theraptly LMS',
  description: 'Manage and create training courses for your organization.',
};

export default async function CoursesPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  // Fetch user with org subscription to determine billing status
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      role: true,
      organization: {
        select: {
          subscription: {
            select: { status: true, pausedAt: true },
          },
        },
      },
    },
  });

  if (!user || !isAdminRole(user.role)) {
    redirect('/dashboard');
  }

  // Billing is "enabled" when the org has an active or trialing subscription
  // that is not paused. past_due, canceled and paused are treated as inactive.
  const hasBilling = hasActiveBilling(user.organization?.subscription);

  // Fetch both data sources in parallel; a failure in available courses
  // should never break the page — fall back to an empty list.
  const [courses, availableCourses] = await Promise.all([
    getCourses(),
    listAvailableVideoCourses().catch(() => []),
  ]);

  return (
    <Suspense fallback={null}>
      <CoursesPageTabs
        courses={courses}
        hasBilling={hasBilling}
        availableCourses={availableCourses}
      />
    </Suspense>
  );
}
