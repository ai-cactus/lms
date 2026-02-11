import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import styles from '@/components/worker/WorkerDashboard.module.css';
import Link from 'next/link';
import WorkerWelcomeModal from '@/components/dashboard/learner/WorkerWelcomeModal';
import WorkerDashboardMetrics from '@/components/worker/WorkerDashboardMetrics';
import WorkerCourseList from '@/components/worker/WorkerCourseList';
import WorkerBadges from '@/components/worker/WorkerBadges';
import WorkerEmptyState from '@/components/worker/WorkerEmptyState';

export default async function LearnerDashboard() {
    const session = await auth();
    const allEnrollments = await prisma.enrollment.findMany({
        where: { userId: session?.user?.id },
        include: { course: true }
    });

    // Separate enrollments
    // "active" means not fully attested yet. "completed" status in database means they finished content but maybe not attested.
    // For this dashboard, we treat 'attested' as fully done (Badge Earned). 
    // 'completed' means they passed the quiz but might need to sign.
    // However, the design implies 'completed' courses show up in Badges list if they are done.

    // Let's iterate:
    // Active List: Assigned, In Progress, Failed, Completed (waiting for attestation).
    // Badges List: Attested (or Completed if no attestation flow required, but typically Attested).

    const activeCoursesData = allEnrollments.filter(e => e.status !== 'attested');
    const earnedBadgesData = allEnrollments.filter(e => e.status === 'attested');

    const totalCourses = allEnrollments.length;
    const completedCourses = earnedBadgesData.length;

    // Calculate Average Grade
    // User might have scores in enrollments. 
    // Filter for those with scores.
    const enrollmentsWithScores = allEnrollments.filter(e => e.score !== null);
    const averageGrade = enrollmentsWithScores.length > 0
        ? Math.round(enrollmentsWithScores.reduce((sum, e) => sum + (e.score || 0), 0) / enrollmentsWithScores.length)
        : 0;

    // Map to component props
    const activeCourses = activeCoursesData.map(e => ({
        id: e.courseId,
        title: e.course.title,
        status: e.status,
        progress: e.progress,
        deadline: null, // Schema doesn't have deadline on Enrollment yet, could be on Course or derived. Leaving null for now.
        duration: e.course.duration || undefined
    }));

    const badges = earnedBadgesData.map(e => ({
        id: e.id,
        courseTitle: e.course.title,
        completedAt: e.attestedAt || e.completedAt || new Date(),
        status: e.status
    }));

    // Check if completely empty (onboarding state)
    // If no enrollments at all, show empty state MODAL on top of the dashboard.
    const showWelcomeModal = allEnrollments.length === 0;

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div>
                    <h1 className={styles.welcome}>Welcome back, {session?.user?.name || 'Learner'}</h1>
                    <p className={styles.sub}>Here is an overview of your courses</p>
                </div>
            </header>

            <WorkerDashboardMetrics
                totalCourses={totalCourses}
                completedCourses={completedCourses}
                averageGrade={averageGrade}
            />

            <WorkerCourseList courses={activeCourses} />

            <WorkerBadges badges={badges} />

            {showWelcomeModal && <WorkerEmptyState />}

            <WorkerWelcomeModal
                courseCount={allEnrollments.length}
                firstCourseId={allEnrollments[0]?.courseId}
            />
        </div>
    );
}
