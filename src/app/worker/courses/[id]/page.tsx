import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth.worker';
import prisma from '@/lib/prisma';
import CoursePreview from '@/components/dashboard/training/CoursePreview';
import { getCourseById } from '@/app/actions/course';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function WorkerCourseDetailsPage(props: PageProps) {
  const params = await props.params;
  const session = await auth();

  if (!session?.user?.id) {
    redirect('/');
  }

  // getCourseById THROWS 'Course not found' on denial rather than calling
  // notFound(). Unguarded, that escapes the server component and renders as an
  // HTTP 500 — the opaque failure team QA #15 reported. The dashboard
  // equivalents already catch it; this call site never did, and it is the one a
  // manager in learn mode opens.
  let course;
  try {
    course = await getCourseById(params.id);
  } catch {
    notFound();
  }

  // Fetch latest enrollment for this membership and course
  const enrollment = session.user.organizationUserId
    ? await prisma.enrollment.findFirst({
        where: {
          organizationUserId: session.user.organizationUserId,
          courseId: params.id,
        },
        orderBy: {
          startedAt: 'desc',
        },
        include: {
          quizAttempts: true,
          organizationUser: {
            include: { user: true, organization: true },
          },
          course: true,
          certificate: true,
        },
      })
    : null;

  // Sanitize course data to avoid leaking other users' enrollments to the client
  const sanitizedCourse = {
    ...course,
    enrollments: [], // Remove enrollments containing other users' data
  };

  return (
    <CoursePreview
      course={sanitizedCourse}
      mode="worker"
      user={session.user}
      enrollment={enrollment}
    />
  );
}
