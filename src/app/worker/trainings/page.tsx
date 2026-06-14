import { auth } from '@/auth.worker';
import { prisma } from '@/lib/prisma';
import WorkerTrainingList from '@/components/worker/WorkerTrainingList';

export default async function WorkerTrainingsPage() {
  const session = await auth();
  const allEnrollments = await prisma.enrollment.findMany({
    where: { userId: session?.user?.id },
    include: {
      course: true,
      quizAttempts: {
        orderBy: { completedAt: 'desc' },
        take: 1,
      },
    },
  });

  // Deduplicate: one entry per course, preferring completed/attested, then latest enrollment
  const latestByCourse = new Map<string, (typeof allEnrollments)[number]>();
  const completedByCourse = new Map<string, (typeof allEnrollments)[number]>();

  for (const e of allEnrollments) {
    const existing = latestByCourse.get(e.courseId);
    if (
      !existing ||
      (e.startedAt && existing.startedAt && e.startedAt > existing.startedAt) ||
      (!existing.startedAt && e.startedAt)
    ) {
      latestByCourse.set(e.courseId, e);
    }
    if (e.status === 'completed' || e.status === 'attested') {
      const existingCompleted = completedByCourse.get(e.courseId);
      if (!existingCompleted || e.status === 'attested') {
        completedByCourse.set(e.courseId, e);
      }
    }
  }

  const courses = [...latestByCourse.entries()].map(([courseId, e]) => {
    const completed = completedByCourse.get(courseId);
    const picked = completed ?? e;
    return {
      id: courseId,
      enrollmentId: picked.id,
      title: picked.course.title,
      status: picked.status,
      progress: picked.progress,
      deadline: null,
      duration: picked.course.duration || undefined,
      category: picked.course.category,
      retakeOf: picked.retakeOf,
      quizAttempts: picked.quizAttempts,
    };
  });

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
