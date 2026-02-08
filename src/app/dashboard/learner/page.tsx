import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import styles from './learner.module.css';
import Link from 'next/link';

export default async function LearnerDashboard() {
    const session = await auth();
    const enrollments = await prisma.enrollment.findMany({
        where: { userId: session?.user?.id },
        include: { course: true }
    });

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <h1 className={styles.welcome}>Welcome back, {session?.user?.name || 'Learner'}</h1>
                <p className={styles.sub}>You have {enrollments.length} assigned courses.</p>
            </header>

            <div className={styles.courseList}>
                {enrollments.map(enrollment => (
                    <div key={enrollment.id} className={styles.courseCard}>
                        <div className={styles.courseInfo}>
                            <h3 className={styles.courseTitle}>{enrollment.course.title}</h3>
                            <div className="text-sm text-gray-500">Duration: {enrollment.course.duration || 30} mins</div>

                            <div className={styles.progressBarContainer}>
                                <div
                                    className={styles.progressBar}
                                    style={{ width: `${enrollment.progress}%` }}
                                />
                            </div>
                            <span className="text-xs text-gray-400 mt-1">{enrollment.progress}% Complete</span>
                        </div>

                        <Link href={`/dashboard/courses/${enrollment.courseId}/learn`} className={styles.actionBtn}>
                            {enrollment.progress > 0 ? 'Continue' : 'Start'}
                        </Link>
                    </div>
                ))}

                {enrollments.length === 0 && (
                    <div className="text-center py-10 bg-white rounded-lg border border-dashed">
                        <p>No active courses assigned.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
