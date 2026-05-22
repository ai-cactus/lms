import React from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { getCourses } from '@/app/actions/course';
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

  // Fetch user with org subscription to determine billing status
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

  // Billing is "enabled" when the org has an active or trialing subscription.
  // past_due and canceled are treated as inactive — same as no subscription.
  const subStatus = user.organization?.subscription?.status;
  const hasBilling = subStatus === 'active' || subStatus === 'trialing';

  const courses = await getCourses();

  return <CoursesListClient courses={courses} hasBilling={hasBilling} />;
}
