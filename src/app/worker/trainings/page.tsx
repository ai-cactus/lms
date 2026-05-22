import { auth } from '@/auth.worker';
import { prisma } from '@/lib/prisma';
import styles from '@/components/worker/WorkerDashboard.module.css';
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

  const courses = allEnrollments.map((e) => ({
    id: e.courseId,
    enrollmentId: e.id,
    title: e.course.title,
    status: e.status,
    progress: e.progress,
    deadline: null,
    duration: e.course.duration || undefined,
    category: e.course.category,
    retakeOf: e.retakeOf,
    quizAttempts: e.quizAttempts,
  }));

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.welcome}>Assigned Courses</h1>
        </div>
      </header>

      <WorkerTrainingList courses={courses} />
    </div>
  );
}
