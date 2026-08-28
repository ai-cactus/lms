import { notFound, redirect } from 'next/navigation';
import { auth } from '@/auth.worker';
import prisma from '@/lib/prisma';
import CoursePreview from '@/components/dashboard/training/CoursePreview';
import { getCourseById } from '@/app/actions/course';
import { isCourseAccessError } from '@/lib/course/access-error';

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

  // getCourseById THROWS on denial rather than calling notFound(). Unguarded,
  // that escapes the server component and renders as an HTTP 500 — the opaque
  // failure team QA #15 reported. Only an access refusal becomes a 404 here;
  // anything else (a database fault, a bug) is rethrown rather than disguised as
  // a missing course.
  let course;
  try {
    course = await getCourseById(params.id);
  } catch (error) {
    if (!isCourseAccessError(error)) throw error;
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
