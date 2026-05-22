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

  // In the new design, we list ALL courses in the course list table, including attested/completed ones.
  // The "Courses Completed" section is just a summary card (Achievements).

  const totalCourses = allEnrollments.length;
  // Count 'attested' or 'completed' as completed for metrics
  const completedCourses = allEnrollments.filter(
    (e) => e.status === 'attested' || e.status === 'completed',
  ).length;
  // Badge count represents fully attested courses (or just completed if that's the metric, but typically badges = attested)
  // For now, let's say badges = completed count as shown in the card "You have earned ... badges"
  const badgeCount = completedCourses;

  // Calculate Average Grade
  const enrollmentsWithScores = allEnrollments.filter((e) => e.score !== null);
  const averageGrade =
    enrollmentsWithScores.length > 0
      ? Math.round(
          enrollmentsWithScores.reduce((sum, e) => sum + (e.score || 0), 0) /
            enrollmentsWithScores.length,
        )
      : 0;

  // Map to component props
  const courses = allEnrollments.map((e) => ({
    id: e.courseId,
    enrollmentId: e.id,
    title: e.course.title,
    status: e.status,
    progress: e.progress,
    deadline: null,
    duration: e.course.duration || undefined,
    quizAttempts: e.quizAttempts,
    retakeOf: e.retakeOf,
  }));

  // Check if completely empty (onboarding state)
  const showWelcomeModal = allEnrollments.length === 0;

  // Check for any progress to intelligently hide welcome modal
  const hasProgress = allEnrollments.some(
    (e) => (e.progress || 0) > 0 || e.status === 'completed' || e.status === 'attested',
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
        completedCourses={allEnrollments
          .filter((e) => e.status === 'attested' || e.status === 'completed')
          .map((e) => ({ id: e.courseId, title: e.course.title }))}
      />

      {showWelcomeModal && <WorkerEmptyState />}

      <WorkerWelcomeModal
        courseCount={allEnrollments.length}
        firstCourseId={allEnrollments[0]?.courseId}
        hasProgress={hasProgress}
      />
    </div>
  );
}
