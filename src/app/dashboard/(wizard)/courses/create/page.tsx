import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
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

  // Confirm the user is an admin with an active subscription before allowing
  // access to the wizard. This prevents URL-bypassing of the UI billing gate.
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      role: true,
      organization: {
        select: {
          subscription: {
            select: { status: true },
          },
        },
      },
    },
  });

  if (!user || user.role !== 'admin') {
    redirect('/dashboard');
  }

  const subStatus = user.organization?.subscription?.status;
  const hasBilling = subStatus === 'active' || subStatus === 'trialing';

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
