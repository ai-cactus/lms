import Link from 'next/link';
import { ShieldAlert } from 'lucide-react';
import { requirePermission } from '@/lib/rbac/require-permission';
import prisma from '@/lib/prisma';
import { getCourses } from '@/app/actions/course';
import { listGlobalVideoCatalogCourses } from '@/app/actions/offering';
import { hasActiveBilling } from '@/lib/billing';
import { logger } from '@/lib/logger';
import { Button } from '@/components/ui/button';
import CoursesListClient from '@/components/dashboard/courses/CoursesListClient';
import type { CourseWithStats } from '@/types/course';

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

  const [ownCourses, catalogCourses] = await Promise.all([
    getCourses(),
    // Video courses are owned by the organization from creation, but that
    // ownership is what the plan buys: an org without an active subscription
    // sees only what it authored or already adopted. No tier mapping — the
    // single hasActiveBilling() ruling, computed above with no extra read.
    hasBilling
      ? listGlobalVideoCatalogCourses().catch((err) => {
          // The catalog is additive, so a failure here must degrade to the
          // org's own courses rather than take the page down — but it is a
          // real fault and is never swallowed silently.
          logger.error({ msg: '[course] Global video catalog lookup failed', err, organizationId });
          return [] as CourseWithStats[];
        })
      : Promise.resolve<CourseWithStats[]>([]),
  ]);

  // One list, no "available" step. Own and adopted rows win the de-dupe: they
  // carry this org's source-document lineage and full row affordances, which a
  // catalog-only row deliberately does not.
  const seen = new Set(ownCourses.map((course) => course.id));
  const courses = [...ownCourses, ...catalogCourses.filter((course) => !seen.has(course.id))];

  return <CoursesListClient courses={courses} hasBilling={hasBilling} viewerRole={ctx.role} />;
}
