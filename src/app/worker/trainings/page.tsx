import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import styles from '@/components/worker/WorkerDashboard.module.css';
import WorkerCourseList from '@/components/worker/WorkerCourseList';

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
        duration: e.course.duration || undefined
    }));

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div>
                    <h1 className={styles.welcome}>My Trainings</h1>
                    <p className={styles.sub}>View and access your assigned courses</p>
                </div>
            </header>

            <WorkerCourseList courses={activeCourses} />
        </div>
    );
}
