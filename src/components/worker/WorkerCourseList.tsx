'use client';

import React, { useState } from 'react';
import styles from './WorkerDashboard.module.css';
import { useRouter } from 'next/navigation';

interface Course {
    id: string;
    title: string;
    status: string;
    progress: number;
    deadline?: Date | string | null;
    duration?: number;
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

    const getStatusLabel = (status: string) => {
        switch (status) {
            case 'in_progress': return 'In Progress';
            case 'completed': return 'Completed';
            case 'attested': return 'Attested';
            case 'assigned': return 'Not Started';
            default: return status.charAt(0).toUpperCase() + status.slice(1).replace('_', ' ');
        }
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'in_progress':
                return (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                    </svg>
                );
            case 'completed':
                return (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                    </svg>
                );
            case 'attested':
                return (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                        <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                );
            case 'assigned':
                return (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                    </svg>
                );
            default: return null;
        }
    };

    const getProgressColor = (progress: number) => {
        if (progress >= 100) return '#10B981';
        if (progress >= 50) return '#3B82F6';
        if (progress > 0) return '#F59E0B';
        return '#CBD5E1';
    };

    return (
        <section>
            <div className={styles.courseListHeader}>
                <h2 className={styles.sectionTitle}>My Courses</h2>
                <div className={styles.searchBox}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94A3B8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                        type="text"
                        placeholder="Search courses..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className={styles.searchInput}
                    />
                </div>
            </div>

            <div className={styles.tableContainer}>
                {/* Header */}
                <div className={styles.tableHeader}>
                    <div className={styles.colName}>Course</div>
                    <div className={styles.colProgress}>Progress</div>
                    <div className={styles.colDeadline}>Deadline</div>
                    <div className={styles.colStatus}>Status</div>
                </div>

                {/* Rows */}
                {filtered.length > 0 ? (
                    filtered.map(course => (
                        <div
                            key={course.id}
                            className={styles.tableRow}
                            onClick={() => router.push(`/worker/courses/${course.id}`)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={e => e.key === 'Enter' && router.push(`/worker/courses/${course.id}`)}
                        >
                            {/* Course Name */}
                            <div className={styles.colName}>
                                <div className={styles.courseIcon}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                                    </svg>
                                </div>
                                <span className={styles.courseNameText}>{course.title}</span>
                            </div>

                            {/* Progress */}
                            <div className={styles.colProgress}>
                                <div className={styles.progressContainer}>
                                    <div className={styles.progressBarTrack}>
                                        <div
                                            className={styles.progressBarFill}
                                            style={{
                                                width: `${course.progress}%`,
                                                background: getProgressColor(course.progress)
                                            }}
                                        />
                                    </div>
                                    <span className={styles.progressText}>{course.progress}%</span>
                                </div>
                            </div>

                            {/* Deadline */}
                            <div className={styles.colDeadline}>
                                {course.deadline ? (
                                    <>
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                            <line x1="16" y1="2" x2="16" y2="6" />
                                            <line x1="8" y1="2" x2="8" y2="6" />
                                            <line x1="3" y1="10" x2="21" y2="10" />
                                        </svg>
                                        <span>{new Date(course.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                                    </>
                                ) : (
                                    <span className={styles.noDeadline}>—</span>
                                )}
                            </div>

                            {/* Status */}
                            <div className={styles.colStatus}>
                                <span className={`${styles.statusBadge} ${course.status === 'in_progress' ? styles.statusInProgress :
                                        course.status === 'completed' ? styles.statusCompleted :
                                            course.status === 'attested' ? styles.statusAttested :
                                                course.status === 'assigned' ? styles.statusAssigned :
                                                    ''
                                    }`}>
                                    {getStatusIcon(course.status)}
                                    {getStatusLabel(course.status)}
                                </span>
                            </div>
                        </div>
                    ))
                ) : (
                    <div className={styles.emptyTable}>
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                        </svg>
                        <p>{search ? 'No courses match your search.' : 'No courses assigned yet.'}</p>
                    </div>
                )}
            </div>
        </section>
    );
}
