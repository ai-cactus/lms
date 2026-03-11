'use client';

import React, { useState } from 'react';
import styles from './WorkerDashboard.module.css';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import EmptyTableState from '@/components/ui/EmptyTableState';

interface Course {
    id: string;
    title: string;
    category?: string | null;
    status: string;
    progress: number;
    deadline?: Date | string | null;
    duration?: number;
    quizAttempts?: any[];
    retakeOf?: string | null;
    enrollmentId?: string;
}

interface WorkerCourseListProps {
    courses: Course[];
}

export default function WorkerCourseList({ courses }: WorkerCourseListProps) {
    const router = useRouter();
    const [search, setSearch] = useState('');

    const filtered = courses.filter(c =>
        c.title.toLowerCase().includes(search.toLowerCase())
    );

    const handleStartClick = (courseId: string) => {
        router.push(`/worker/courses/${courseId}`);
    };

    const handleViewResultClick = (courseId: string) => {
        router.push(`/worker/courses/${courseId}`);
    };

    const getStatusBadge = (status: string, progress: number, quizAttempts?: any[]) => {
        if (status === 'attested') {
            return <span className={`${styles.statusBadge} ${styles.statusAttested}`}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                Attested
            </span>;
        }
        if (status === 'completed') {
            return <span className={`${styles.statusBadge} ${styles.statusCompleted}`}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                Completed
            </span>;
        }
        if (status === 'failed') {
            return <span className={`${styles.statusBadge} ${styles.statusFailed}`}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                Failed
            </span>;
        }

        if (status === 'locked') {
            return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span className={`${styles.statusBadge} ${styles.statusFailed}`} style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                        Locked
                    </span>
                    <span style={{ fontSize: '10px', color: '#EF4444' }}>Max attempts reached</span>
                </div>
            );
        }

        // Default to In Progress or Assigned
        const isStarted = progress > 0 || status === 'in_progress';
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span className={`${styles.statusBadge} ${isStarted ? styles.statusInProgress : styles.statusAssigned}`}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                    {isStarted ? 'In progress' : 'Assigned'}
                </span>
                {isStarted && quizAttempts && (
                    <span style={{ fontSize: '10px', color: '#A0AEC0', paddingLeft: '4px' }}>
                        Attempt {quizAttempts[0]
                            ? (quizAttempts[0].timeTaken === null
                                ? quizAttempts[0].attemptCount
                                : quizAttempts[0].attemptCount + 1)
                            : 1}
                    </span>
                )}
            </div>
        );
    };

    const formatDate = (date: Date | string | null | undefined) => {
        if (!date) return <span className={styles.noDeadline}>No deadline</span>;
        const d = new Date(date);
        const isOverdue = d < new Date();
        const text = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

        if (isOverdue) {
            return <span className={styles.deadlineRed}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                Due {text}
            </span>;
        }
        return <span className={styles.deadlineNormal}>
            {isOverdue ? `Due ${text}` : text}
        </span>;
    };

    return (
        <section>
            <div className={styles.courseListHeader}>
                <h2 className={styles.sectionTitle}>My Courses</h2>
                <div className={styles.searchBox}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                    <input
                        type="text"
                        placeholder="Search for courses..."
                        className={styles.searchInput}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
            </div>

            <div className={styles.tableWrapper}>
                <table className={styles.courseTable}>
                    <thead>
                        <tr>
                            <th style={{ width: '35%' }}>Name</th>
                            <th style={{ width: '20%' }}>Progress</th>
                            <th style={{ width: '15%' }}>Deadline</th>
                            <th style={{ width: '15%' }}>Status</th>

                        </tr>
                    </thead>
                    <tbody>
                        {filtered.length > 0 ? (
                            filtered.map(course => {
                                const isCompleted = course.status === 'completed' || course.status === 'attested';
                                const isFailed = course.status === 'failed';
                                const isStarted = course.progress > 0;
                                return (
                                    <tr 
                                        key={course.id + '-' + course.enrollmentId} 
                                        onClick={() => {
                                            if (course.status === 'locked') return;
                                            isCompleted ? handleViewResultClick(course.id) : handleStartClick(course.id);
                                        }} 
                                        style={{ cursor: course.status === 'locked' ? 'not-allowed' : 'pointer', opacity: course.status === 'locked' ? 0.7 : 1 }}
                                    >
                                        <td>
                                            <div className={styles.courseInfo}>
                                                <div className={styles.courseIconSmall}>
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                                                    </svg>
                                                </div>
                                                <span className={styles.courseTitleSmall}>
                                                    {course.retakeOf ? <span style={{ color: '#E53E3E', fontWeight: 600, marginRight: 8 }}>Retake:</span> : null}
                                                    {course.title}
                                                </span>
                                            </div>
                                        </td>
                                        <td>
                                            <div className={styles.progressContainer}>
                                                <div className={styles.progressBarTrack}>
                                                    <div
                                                        className={styles.progressBarFill}
                                                        style={{
                                                            width: `${course.progress}%`,
                                                            backgroundColor: isCompleted ? '#4730F7' : '#4730F7'
                                                        }}
                                                    />
                                                </div>
                                                <span className={styles.progressText}>{course.progress}%</span>
                                            </div>
                                        </td>
                                        <td>
                                            {formatDate(course.deadline)}
                                        </td>
                                        <td>
                                            {getStatusBadge(course.status, course.progress, course.quizAttempts)}
                                        </td>

                                    </tr>
                                );
                            })
                        ) : (
                            <EmptyTableState
                                message="No courses found."
                                subMessage="You haven't been assigned any courses yet."
                                colSpan={4}
                                asTableRow
                            />
                        )}
                    </tbody>
                </table>
            </div>
        </section>
    );
}
