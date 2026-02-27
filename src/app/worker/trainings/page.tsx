import { auth } from '@/auth.worker';
import { prisma } from '@/lib/prisma';
import styles from '@/components/worker/WorkerDashboard.module.css';
import WorkerTrainingList from '@/components/worker/WorkerTrainingList';

export default async function WorkerTrainingsPage() {
    const session = await auth();
    const allEnrollments = await prisma.enrollment.findMany({
        where: { userId: session?.user?.id },
        include: { course: true }
    });

    const activeCoursesData = allEnrollments.filter(e => e.status !== 'attested');

    const activeCourses = activeCoursesData.map(e => ({
        id: e.courseId,
        title: e.course.title,
        status: e.status,
        progress: e.progress,
        deadline: null,
        duration: e.course.duration || undefined,
        category: e.course.category
    }));

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div>
                    <h1 className={styles.welcome}>Assigned Courses</h1>
                </div>
            </header>

            <WorkerTrainingList courses={activeCourses} />
        </div>
    );
}
