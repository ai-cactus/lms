import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { hasActiveBilling } from '@/lib/billing';
import { can } from '@/lib/rbac/permissions';
import { dbRoleToRoleKey, isAdminRole } from '@/lib/rbac/role-utils';
import { getPrebuiltCourses } from '@/app/actions/course';
import PrebuiltCourseCatalog from '@/components/dashboard/courses/PrebuiltCourseCatalog';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Choose a Prebuilt Course | Theraptly LMS',
  description: 'Add a ready-made Theraptly course to your organization.',
};

export default async function PrebuiltCoursesPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const { role, organizationId } = session.user;
  if (!isAdminRole(role)) {
    redirect('/dashboard');
  }

  // Adopting a catalog course creates a course, so this route carries the same
  // gate as `addPrebuiltCourseToOrg` — read-only admins never reach the form.
  if (!can(dbRoleToRoleKey(role), 'course.create')) {
    redirect('/dashboard/courses');
  }

  // Mirrors the wizard route's gate so the billing check cannot be URL-bypassed.
  const organization = organizationId
    ? await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { subscription: { select: { status: true, pausedAt: true } } },
      })
    : null;

  if (!hasActiveBilling(organization?.subscription)) {
    redirect('/dashboard/courses');
  }

  const courses = await getPrebuiltCourses();

  return <PrebuiltCourseCatalog courses={courses} />;
}
