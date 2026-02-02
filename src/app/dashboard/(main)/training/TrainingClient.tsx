'use client';

import React from 'react';
// We can import the same CSS module
import styles from './page.module.css';
import { Button } from '@/components/ui';
import Image from 'next/image';

import TrainingDashboard, { DashboardStats } from '@/components/dashboard/training/TrainingDashboard';
import { CourseWithStats } from '@/app/actions/course';

interface TrainingClientProps {
    stats: DashboardStats;
    courses: CourseWithStats[];
}

import { useRouter } from 'next/navigation';

// ... imports

export default function TrainingClient({ stats, courses }: TrainingClientProps) {
    const router = useRouter();
    // If user has courses, default to showing the dashboard.
    // Otherwise show the empty state / onboarding.
    const [showDashboard, setShowDashboard] = React.useState(courses.length > 0);

    const handleCreateCourse = () => {
        router.push('/dashboard/courses/create');
    };

    if (showDashboard) {
        return (
            <TrainingDashboard
                onCreateCourse={handleCreateCourse}
                stats={stats}
                courses={courses}
            />
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.onboardingCard}>
                <button className={styles.closeButton} onClick={() => setShowDashboard(true)}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>

                <div className={styles.cardContent}>
                    {/* Left Column: Illustration & CTA */}
                    <div className={styles.illustrationColumn}>
                        {/* ... (illustration code unchanged) ... */}
                        <div className={styles.illustrationWrapper}>
                            <div className={styles.imageContainer}>
                                <Image
                                    src="/assets/training-illustration.svg"
                                    alt="Training Center Illustration"
                                    width={345}
                                    height={257}
                                    priority
                                />
                            </div>
                        </div>

                        <h2 className={styles.cardTitle}>
                            Turn Your Healthcare Policies into Interactive Training in Minutes.
                        </h2>

                        <p className={styles.cardDescription}>
                            Operationalize your policies and procedures by training your staff
                        </p>

                        <Button
                            variant="primary"
                            size="lg"
                            className={styles.createButton}
                            onClick={handleCreateCourse}
                        >
                            Create your first course
                        </Button>
                    </div>

                    {/* Right Column: Steps */}
                    <div className={styles.stepsColumn}>
                        <h3 className={styles.stepsHeader}>How to get started</h3>

                        <div className={styles.stepsList}>
                            <div className={styles.stepItem}>
                                <h4 className={styles.stepTitle}>1. Select Type of Training</h4>
                                <p className={styles.stepDesc}>
                                    Choose whether the training is based on compliance, safety, HR, or any internal policy area.
                                </p>
                            </div>

                            <div className={styles.stepItem}>
                                <h4 className={styles.stepTitle}>2. Upload Policies</h4>
                                <p className={styles.stepDesc}>
                                    Upload your organization's documents. Theraptly will analyze and prepare a draft training automatically.
                                </p>
                            </div>

                            <div className={styles.stepItem}>
                                <h4 className={styles.stepTitle}>3. Configure Course & Assessment</h4>
                                <p className={styles.stepDesc}>
                                    Define course structure, quiz settings, difficulty level, and deadlines.
                                </p>
                            </div>

                            <div className={styles.stepItem}>
                                <h4 className={styles.stepTitle}>4. Review & Publish Course</h4>
                                <p className={styles.stepDesc}>
                                    Review AI-generated lessons and quizzes, make adjustments, and approve for publishing. Instantly make your training available for your team to access and complete.
                                </p>
                            </div>

                            <div className={styles.stepItem}>
                                <h4 className={styles.stepTitle}>5. Invite Workers to Course</h4>
                                <p className={styles.stepDesc}>
                                    Assign courses to individuals or departments and track progress directly from your dashboard.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
