import { Suspense } from 'react';
import { isAdminRole } from '@/lib/rbac/role-utils';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { getCourses } from '@/app/actions/course';
import { hasActiveBilling } from '@/lib/billing';
import CoursesListClient from '@/components/dashboard/courses/CoursesListClient';

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

  const { role, organizationId } = session.user;
  if (!isAdminRole(role)) {
    redirect('/dashboard');
  }

  // Fetch the org's subscription to determine billing status
  const organization = organizationId
    ? await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { subscription: { select: { status: true, pausedAt: true } } },
      })
    : null;

  // Billing is "enabled" when the org has an active or trialing subscription
  // that is not paused. past_due, canceled and paused are treated as inactive.
  const hasBilling = hasActiveBilling(organization?.subscription);

  const courses = await getCourses();

  return (
    <Suspense fallback={null}>
      <CoursesListClient courses={courses} hasBilling={hasBilling} viewerRole={role} />
    </Suspense>
  );
}
