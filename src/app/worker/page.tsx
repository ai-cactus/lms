import { auth } from '@/auth.worker';
import { prisma } from '@/lib/prisma';
import styles from '@/components/worker/WorkerDashboard.module.css';
import WorkerWelcomeModal from '@/components/dashboard/learner/WorkerWelcomeModal';
import WorkerDashboardMetrics from '@/components/worker/WorkerDashboardMetrics';
import WorkerCourseList from '@/components/worker/WorkerCourseList';
import WorkerAchievements from '@/components/worker/WorkerAchievements';
import WorkerEmptyState from '@/components/worker/WorkerEmptyState';

export default async function LearnerDashboard() {
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
      quizAttempts: picked.quizAttempts,
      retakeOf: picked.retakeOf,
    };
  });

  const totalCourses = courses.length;
  const completedCourses = courses.filter(
    (c) => c.status === 'attested' || c.status === 'completed',
  ).length;
  const badgeCount = completedCourses;

  // Calculate Average Grade (from deduplicated courses)
  const coursesWithScores = courses.filter((c) => {
    const enrollment = allEnrollments.find((e) => e.id === c.enrollmentId);
    return enrollment?.score !== null;
  });
  const averageGrade =
    coursesWithScores.length > 0
      ? Math.round(
          coursesWithScores.reduce((sum, c) => {
            const enrollment = allEnrollments.find((e) => e.id === c.enrollmentId);
            return sum + (enrollment?.score || 0);
          }, 0) / coursesWithScores.length,
        )
      : 0;

  // Check if completely empty (onboarding state)
  const showWelcomeModal = courses.length === 0;

  // Check for any progress to intelligently hide welcome modal
  const hasProgress = courses.some(
    (c) => (c.progress || 0) > 0 || c.status === 'completed' || c.status === 'attested',
  );

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.welcome}>Dashboard</h1>
          <p className={styles.sub}>Here is an overview of your courses</p>
        </div>
      </header>

      <WorkerDashboardMetrics
        totalCourses={totalCourses}
        completedCourses={completedCourses}
        averageGrade={averageGrade}
      />

      <WorkerCourseList courses={courses} />

      <WorkerAchievements
        badgeCount={badgeCount}
        completedCourses={courses
          .filter((c) => c.status === 'attested' || c.status === 'completed')
          .map((c) => ({ id: c.id, title: c.title }))}
      />

      {showWelcomeModal && <WorkerEmptyState />}

      <WorkerWelcomeModal
        courseCount={courses.length}
        firstCourseId={courses[0]?.id}
        hasProgress={hasProgress}
      />
    </div>
  );
}
