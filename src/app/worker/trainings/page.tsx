import { auth } from '@/auth.worker';
import prisma from '@/lib/prisma';
import WorkerTrainingList from '@/components/worker/WorkerTrainingList';
import { computeDisplayProgress } from '@/lib/enrollment-progress';
import { selectDisplayEnrollments } from '@/lib/enrollment/display-selection';
import type { LearnerCourseRow } from '@/types/enrollment';

export default async function WorkerTrainingsPage() {
  const session = await auth();
  const organizationUserId = session?.user?.organizationUserId;
  const allEnrollments = organizationUserId
    ? await prisma.enrollment.findMany({
        where: { organizationUserId },
        include: {
          course: { include: { quiz: { select: { passingScore: true } } } },
          certificate: { select: { id: true } },
          quizAttempts: {
            orderBy: { completedAt: 'desc' },
            take: 1,
          },
        },
      })
    : [];

  const courses: LearnerCourseRow[] = selectDisplayEnrollments(allEnrollments).map((picked) => ({
    id: picked.courseId,
    enrollmentId: picked.id,
    title: picked.course.title,
    status: picked.status,
    progress: computeDisplayProgress({
      status: picked.status,
      progress: picked.progress,
      score: picked.score,
      passingScore: picked.course.quiz?.passingScore ?? null,
    }),
    deadline: picked.dueAt,
    duration: picked.course.duration || undefined,
    category: picked.course.category,
    passingScore: picked.course.quiz?.passingScore ?? null,
    retakeOf: picked.retakeOf,
    quizAttempts: picked.quizAttempts,
    certificateId: picked.certificate?.id ?? null,
  }));

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-8 max-md:gap-5">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="mb-1 text-2xl font-bold text-[#1a202c] max-md:text-xl">
            Assigned Courses
          </h1>
        </div>
      </header>

      <WorkerTrainingList courses={courses} />
    </div>
  );
}
