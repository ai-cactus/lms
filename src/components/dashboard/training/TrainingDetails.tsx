'use client';

import React, { useState } from 'react';
import styles from './TrainingDetails.module.css';
import { Button, Input } from '@/components/ui';
import Link from 'next/link';
import ShareCourseModal from './ShareCourseModal';

interface TrainingDetailsProps {
    course: any; // Using any for complex return type from server for now
}

export default function TrainingDetails({ course }: TrainingDetailsProps) {
    const [searchQuery, setSearchQuery] = useState('');
    const [isShareModalOpen, setIsShareModalOpen] = useState(false);

    // Use real enrollments from database only
    const enrollments = course.enrollments || [];

    const totalLearners = enrollments.length;

    // Calculate Stats
    const completedCount = enrollments.filter((e: any) => e.status === 'completed').length;
    const completionRate = totalLearners > 0 ? Math.round((completedCount / totalLearners) * 100) : 0;

    // Average Score
    const scoredEnrollments = enrollments.filter((e: any) => e.score !== null);
    const averageScore = scoredEnrollments.length > 0
        ? Math.round(scoredEnrollments.reduce((sum: number, e: any) => sum + (e.score || 0), 0) / scoredEnrollments.length)
        : 0;

    // Filter Staff
    const filteredEnrollments = enrollments.filter((e: any) => {
        const name = e.user?.profile?.fullName || e.user?.email || '';
        return name.toLowerCase().includes(searchQuery.toLowerCase());
    });

    return (
        <div className={styles.container}>
            {/* Breadcrumbs & Header */}
            {/* Breadcrumbs & Header */}
            <div className={styles.headerContainer}>
                <div className={styles.breadcrumbs}>
                    <Link href="/dashboard/courses" className={styles.backButton}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="19" y1="12" x2="5" y2="12"></line>
                            <polyline points="12 19 5 12 12 5"></polyline>
                        </svg>
                        Go Back
                    </Link>
                    <span>Course</span> <span className={styles.separator}>/</span> <span className={styles.activeBreadcrumb}>Course Details</span>
                </div>

                <div className={styles.header}>
                    <div className={styles.titleSection}>
                        <h1 className={styles.title}>
                            {course.title}
                            <span className={`${styles.badge} ${styles.badgeActive}`}>Active</span>
                        </h1>
                        <p className={styles.metaLink}>
                            Linked Policy Document: <a href="#" className={styles.link}>CARF-Privacy-policy.pdf</a>
                        </p>
                    </div>
                    <div className={styles.actions}>
                        <Link href={`/dashboard/training/courses/${course.id}/preview`}>
                            <Button variant="primary" size="lg" style={{ backgroundColor: '#4C6EF5' }}>Preview</Button>
                        </Link>
                        <Button
                            variant="outline"
                            className={styles.outlineButton}
                            size="lg"
                            onClick={() => setIsShareModalOpen(true)}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8 }}>
                                <circle cx="18" cy="5" r="3"></circle>
                                <circle cx="6" cy="12" r="3"></circle>
                                <circle cx="18" cy="19" r="3"></circle>
                                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
                                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
                            </svg>
                            Share
                        </Button>
                    </div>
                </div>
            </div>

            {/* Stats Cards */}
            <div className={styles.statsGrid}>
                {/* Total Learners */}
                <div className={`${styles.statCard} ${styles.cardBlue}`}>
                    <div className={`${styles.iconBox} ${styles.iconBlue}`}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                            <circle cx="9" cy="7" r="4"></circle>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                        </svg>
                    </div>
                    <div className={styles.statInfo}>
                        <h4>Total Learners</h4>
                        <div className={styles.statValue}>{totalLearners}</div>
                    </div>
                </div>

                {/* Completion Rate */}
                <div className={`${styles.statCard} ${styles.cardGreen}`}>
                    <div className={`${styles.iconBox} ${styles.iconGreen}`}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                        </svg>
                    </div>
                    <div className={styles.statInfo}>
                        <h4>Completion Rate</h4>
                        <div className={styles.statValue}>{completionRate}%</div>
                    </div>
                </div>

                {/* Average Score */}
                <div className={`${styles.statCard} ${styles.cardRed}`}>
                    <div className={`${styles.iconBox} ${styles.iconRed}`}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="8" r="7"></circle>
                            <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline>
                        </svg>
                    </div>
                    <div className={styles.statInfo}>
                        <h4>Average Score</h4>
                        <div className={styles.statValue}>{averageScore}%</div>
                    </div>
                </div>

                {/* Duration */}
                <div className={`${styles.statCard} ${styles.cardYellow}`}>
                    <div className={`${styles.iconBox} ${styles.iconYellow}`}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <polyline points="12 6 12 12 16 14"></polyline>
                        </svg>
                    </div>
                    <div className={styles.statInfo}>
                        <h4>Average Duration</h4>
                        <div className={styles.statValue}>60 mins</div>
                    </div>
                </div>
            </div>

            {/* Staff Section */}
            <div className={styles.staffSection}>
                <div className={styles.searchContainer}>
                    <Input
                        placeholder="Search for staff..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className={styles.searchInput}
                        leftIcon={
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#aaa' }}>
                                <circle cx="11" cy="11" r="8"></circle>
                                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                            </svg>
                        }
                    />

                </div>

                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th style={{ width: '40%' }}>Staff Name</th>
                            <th style={{ width: '20%' }}>Score</th>
                            <th style={{ width: '20%' }}>Status</th>
                            <th style={{ width: '20%', textAlign: 'right' }}>Quiz result</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredEnrollments.map((enrollment: any) => (
                            <tr key={enrollment.id}>
                                <td>
                                    <div className={styles.staffProfile}>
                                        <div className={styles.avatar}>
                                            {(enrollment.user?.profile?.fullName?.[0] || enrollment.user?.email?.[0] || '?').toUpperCase()}
                                        </div>
                                        <div>
                                            <span className={styles.staffName}>{enrollment.user?.profile?.fullName || enrollment.user?.email}</span>
                                            <span className={styles.staffRole}>{enrollment.user?.profile?.role || 'Staff'}</span>
                                        </div>
                                    </div>
                                </td>
                                <td>
                                    <span className={styles.score}>
                                        {enrollment.status === 'completed' ? `${enrollment.score || 0}%` : '-'}
                                    </span>
                                </td>
                                <td>
                                    {enrollment.status === 'completed' && enrollment.score >= 70 ? (
                                        <span className={`${styles.statusBadge} ${styles.passed}`}>
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="20 6 9 17 4 12"></polyline>
                                            </svg>
                                            Passed
                                        </span>
                                    ) : enrollment.status === 'completed' ? (
                                        <span className={`${styles.statusBadge} ${styles.failed}`}>
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                                <line x1="6" y1="6" x2="18" y2="18"></line>
                                            </svg>
                                            Failed
                                        </span>
                                    ) : enrollment.status === 'in_progress' ? (
                                        <span className={`${styles.statusBadge} ${styles.inProgress}`}>
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <circle cx="12" cy="12" r="10"></circle>
                                                <polyline points="12 6 12 12 16 14"></polyline>
                                            </svg>
                                            In Progress
                                        </span>
                                    ) : (
                                        <span className={`${styles.statusBadge} ${styles.notStarted}`}>
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <circle cx="12" cy="12" r="10"></circle>
                                            </svg>
                                            Not Started
                                        </span>
                                    )}
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, alignItems: 'center' }}>
                                        {enrollment.status === 'completed' ? (
                                            <Link href={`/dashboard/training/courses/${course.id}/results/${enrollment.id}`}>
                                                <button className={styles.viewButton}>View</button>
                                            </Link>
                                        ) : (
                                            <button className={`${styles.viewButton} ${styles.viewButtonDisabled}`} disabled>
                                                View
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {filteredEnrollments.length === 0 && (
                            <tr>
                                <td colSpan={4} style={{ textAlign: 'center', color: '#718096', padding: 24 }}>
                                    No staff enrolled yet.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
            <ShareCourseModal isOpen={isShareModalOpen} onClose={() => setIsShareModalOpen(false)} courseId={course.id} />
        </div>
    );
}
