import React from 'react';
import styles from './page.module.css';
import { Button } from '@/components/ui';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import DashboardCharts from '@/components/dashboard/DashboardCharts';
import MyCoursesTable from '@/components/dashboard/MyCoursesTable';
import Link from 'next/link';
import { getCourses } from '@/app/actions/course';
import DashboardEmptyState from '@/components/dashboard/DashboardEmptyState';

export default async function DashboardPage() {
    const session = await auth();
    if (!session?.user) redirect('/login');

    const role = session.user.role;

    // Fetch courses for the current user
    let courses: any[] = [];
    try {
        courses = await getCourses();
    } catch (error) {
        console.error('Error fetching courses:', error);
    }

    // Calculate real metrics from courses data
    const totalCourses = courses.length;
    const totalStaffAssigned = courses.reduce((sum, c) => sum + c.enrollmentsCount, 0);
    const averageGrade = courses.length > 0
        ? Math.round(courses.reduce((sum, c) => sum + c.completionRate, 0) / courses.length)
        : 0;

    return (
        <div className={styles.container}>
            {/* Header */}
            <div className={styles.header}>
                <div className={styles.titleSection}>
                    <h1 className={styles.title}>Dashboard</h1>
                    <p className={styles.subtitle}>Here is an overview of your courses</p>
                </div>
                <Link href="/dashboard/courses/create">
                    <Button variant="primary">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8 }}>
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                        Create Course
                    </Button>
                </Link>
            </div>

            {/* Metrics Options */}
            <div className={styles.metricsGrid}>
                {/* Total Courses - Green */}
                <div className={styles.metricCard} style={{ background: '#ECFDF5' }}>
                    <div>
                        <div className={styles.metricIcon} style={{ backgroundColor: '#10B981' }}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                            </svg>
                        </div>
                        <p className={styles.metricLabel}>Total Courses</p>
                    </div>
                    <p className={styles.metricValue}>{totalCourses}</p>
                </div>

                {/* Total Staff - Blue */}
                <div className={styles.metricCard} style={{ background: '#EEF2FF' }}>
                    <div>
                        <div className={styles.metricIcon} style={{ backgroundColor: '#4730F7' }}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                <circle cx="9" cy="7" r="4"></circle>
                                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                            </svg>
                        </div>
                        <p className={styles.metricLabel}>Total Staff Assigned</p>
                    </div>
                    <p className={styles.metricValue}>{totalStaffAssigned}</p>
                </div>

                {/* Average Grade - Red */}
                <div className={styles.metricCard} style={{ background: '#FEF2F2' }}>
                    <div>
                        <div className={styles.metricIcon} style={{ backgroundColor: '#EF4444' }}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                                <polyline points="22 4 12 14.01 9 11.01"></polyline>
                            </svg>
                        </div>
                        <p className={styles.metricLabel}>Average Grade</p>
                    </div>
                    <p className={styles.metricValue}>{averageGrade}%</p>
                </div>
            </div>

            {/* Charts */}
            <DashboardCharts />

            {/* My Courses Table */}
            <MyCoursesTable courses={courses} maxItems={5} />

            {/* Empty State Modal */}
            <DashboardEmptyState isOpen={totalCourses === 0} />
        </div>
    );
}
