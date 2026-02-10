import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import styles from './learner.module.css';
import Link from 'next/link';
import WorkerWelcomeModal from '@/components/dashboard/learner/WorkerWelcomeModal';

export default async function LearnerDashboard() {
    const session = await auth();
    const allEnrollments = await prisma.enrollment.findMany({
        where: { userId: session?.user?.id },
        include: { course: true }
    });

    // Separate enrollments
    const activeCourses = allEnrollments.filter(e => e.status !== 'attested' && e.status !== 'failed');
    const earnedBadges = allEnrollments.filter(e => e.status === 'attested');

    // Sort active: in_progress first, then assigned
    activeCourses.sort((a, b) => {
        if (a.status === 'in_progress' && b.status !== 'in_progress') return -1;
        if (a.status !== 'in_progress' && b.status === 'in_progress') return 1;
        return 0;
    });

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div>
                    <h1 className={styles.welcome}>Welcome back, {session?.user?.name || 'Learner'}</h1>
                    <p className={styles.sub}>You have {activeCourses.length} active courses.</p>
                </div>
            </header>

            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Assigned Courses</h2>
                <div className={styles.courseList}>
                    {activeCourses.map(enrollment => (
                        <div key={enrollment.id} className={styles.courseCard}>
                            <div className={styles.courseContent}>
                                <div className={styles.courseInfo}>
                                    <div className={styles.courseHeader}>
                                        <h3 className={styles.courseTitle}>{enrollment.course.title}</h3>
                                        <span className={`${styles.statusBadge} ${styles[enrollment.status]}`}>
                                            {enrollment.status === 'assigned' ? 'Not Started' :
                                                enrollment.status === 'in_progress' ? 'In Progress' :
                                                    enrollment.status === 'completed' ? 'Passed - Needs Signature' : enrollment.status}
                                        </span>
                                    </div>
                                    <div className={styles.meta}>
                                        <span>Duration: {enrollment.course.duration || 30} mins</span>
                                    </div>

                                    <div className={styles.progressBarContainer}>
                                        <div
                                            className={styles.progressBar}
                                            style={{ width: `${enrollment.progress}%` }}
                                        />
                                    </div>
                                    <span className={styles.progressText}>{enrollment.progress}% Complete</span>
                                </div>

                                <div className={styles.cardActions}>
                                    <Link href={`/learn/${enrollment.courseId}`} className={styles.actionBtn}>
                                        {enrollment.status === 'completed' ? 'Sign Attestation' :
                                            enrollment.progress > 0 ? 'Continue' : 'Start'}
                                    </Link>
                                </div>
                            </div>
                        </div>
                    ))}

                    {activeCourses.length === 0 && (
                        <div className={styles.emptyState}>
                            <p>No active courses assigned.</p>
                        </div>
                    )}
                </div>
            </section>

            {earnedBadges.length > 0 && (
                <section className={styles.section}>
                    <h2 className={styles.sectionTitle}>Badges Earned</h2>
                    <div className={styles.badgesGrid}>
                        {earnedBadges.map(badge => (
                            <div key={badge.id} className={styles.badgeCard}>
                                <div className={styles.badgeIcon}>
                                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-yellow-500">
                                        <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="#F6E05E" stroke="#D69E2E" />
                                    </svg>
                                </div>
                                <div className={styles.badgeInfo}>
                                    <h4 className={styles.badgeName}>{badge.course.title}</h4>
                                    <p className={styles.badgeDate}>Issued: {new Date(badge.attestedAt || badge.completedAt || new Date()).toLocaleDateString()}</p>
                                    <button className={styles.verifyBtn}>Verify</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            <WorkerWelcomeModal
                courseCount={allEnrollments.length}
                firstCourseId={allEnrollments[0]?.courseId}
            />
        </div>
    );
}
