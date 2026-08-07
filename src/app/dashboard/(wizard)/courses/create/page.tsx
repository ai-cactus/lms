import { Suspense } from 'react';
import { isAdminRole } from '@/lib/rbac/role-utils';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { hasActiveBilling } from '@/lib/billing';
import CourseWizard from '@/components/dashboard/courses/CourseWizard';

export const metadata = {
  title: 'Create Course | Theraptly LMS',
  description: 'Build a new training course for your organization.',
};

export default async function CreateCoursePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const { role, organizationId } = session.user;
  if (!isAdminRole(role)) {
    redirect('/dashboard');
  }

  // Confirm the org has an active subscription before allowing access to the
  // wizard. This prevents URL-bypassing of the UI billing gate.
  const organization = organizationId
    ? await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { subscription: { select: { status: true, pausedAt: true } } },
      })
    : null;

  const hasBilling = hasActiveBilling(organization?.subscription);

  if (!hasBilling) {
    // Redirect to the courses list where the billing gate UI will be shown
    redirect('/dashboard/courses');
  }

  return (
    <Suspense fallback={<div>Loading course wizard...</div>}>
      <CourseWizard />
    </Suspense>
  );
}
