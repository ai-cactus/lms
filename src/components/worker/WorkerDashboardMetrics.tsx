import React from 'react';
import styles from './WorkerDashboard.module.css';

interface WorkerDashboardMetricsProps {
    totalCourses: number;
    completedCourses: number;
    averageGrade: number;
}

export default function WorkerDashboardMetrics({
    totalCourses,
    completedCourses,
    averageGrade
}: WorkerDashboardMetricsProps) {
    return (
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

            {/* Courses Completed - Blue */}
            <div className={styles.metricCard} style={{ background: '#EEF2FF' }}>
                <div>
                    <div className={styles.metricIcon} style={{ backgroundColor: '#4730F7' }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                            <polyline points="22 4 12 14.01 9 11.01"></polyline>
                        </svg>
                    </div>
                    <p className={styles.metricLabel}>Courses Completed</p>
                </div>
                <p className={styles.metricValue}>{completedCourses}</p>
            </div>

            {/* Average Grade - Red */}
            <div className={styles.metricCard} style={{ background: '#FEF2F2' }}>
                <div>
                    <div className={styles.metricIcon} style={{ backgroundColor: '#EF4444' }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 20V10"></path>
                            <path d="M18 20V4"></path>
                            <path d="M6 20v-4"></path>
                        </svg>
                    </div>
                    <p className={styles.metricLabel}>Average Grade</p>
                </div>
                <p className={styles.metricValue}>{averageGrade}%</p>
            </div>
        </div>
    );
}
