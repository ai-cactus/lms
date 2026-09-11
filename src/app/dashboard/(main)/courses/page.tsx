import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { requirePermission } from '@/lib/rbac/require-permission';
import prisma from '@/lib/prisma';
import { getAssignableCourses } from '@/app/actions/offering';
import { hasActiveBilling } from '@/lib/billing';
import { Button } from '@/components/ui/button';
import CoursesListClient from '@/components/dashboard/courses/CoursesListClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Courses | Theraptly LMS',
  description: 'Manage and create training courses for your organization.',
};

export default async function CoursesPage() {
  // Team QA #9: Finance must not view courses from the admin side. This was
  // `isAdminRole`, which admits Finance regardless of the registry — the same
  // enforcement-gap shape as D-01. `course.read` is the real gate, and Finance
  // no longer holds it.
  const ctx = await requirePermission('course.read');
  const { organizationId, organizationUserId } = ctx;

  // A session with no active membership (onboarding not finished) has no courses
  // to show — getCourses() would throw and dump the user on the generic error
  // boundary, so render the same empty state Settings uses instead.
  if (!organizationId || !organizationUserId) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-error/10 text-error">
          <ShieldAlert className="size-7" aria-hidden="true" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold text-foreground">No organization found</h1>
        <p className="mt-2 max-w-md text-sm text-text-secondary">
          Complete onboarding to set up your organization before managing courses.
        </p>
        <Button asChild className="mt-6">
          <Link href="/onboarding">Complete onboarding</Link>
        </Button>
      </div>
    );
  }

  // Fetch the org's subscription to determine billing status
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { subscription: { select: { status: true, pausedAt: true } } },
  });

  // Billing is "enabled" when the org has an active or trialing subscription
  // that is not paused. past_due, canceled and paused are treated as inactive.
  const hasBilling = hasActiveBilling(organization?.subscription);

  // Shared with the staff-profile assign modal. Keeping the union in ONE place
  // is the point: this page listed the global video catalogue while the modal
  // did not, so a course visible here could not be assigned there.
  const courses = await getAssignableCourses();

  return (
    <div className="flex flex-col gap-6">
      <CoursesListClient courses={courses} hasBilling={hasBilling} viewerRole={ctx.role} />
    </div>
  );
}
