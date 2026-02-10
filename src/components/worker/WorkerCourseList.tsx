'use client';

import React from 'react';
import styles from './WorkerDashboard.module.css';
import Link from 'next/link';

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
    if (courses.length === 0) return null;

    return (
        <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h2 className={styles.sectionTitle}>My Courses</h2>
                <div style={{ position: 'relative' }}>
                    <input
                        type="text"
                        placeholder="Search for courses..."
                        style={{
                            padding: '8px 12px 8px 36px',
                            borderRadius: '6px',
                            border: '1px solid #E2E8F0',
                            fontSize: '14px',
                            width: '240px'
                        }}
                    />
                    <svg
                        width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A0AEC0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }}
                    >
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                </div>
            </div>

            <div className={styles.tableContainer}>
                {/* Header */}
                <div className={styles.tableHeader}>
                    <div className={styles.colName}>Name</div>
                    <div className={styles.colProgress}>Progress</div>
                    <div className={styles.colDeadline}>Deadline</div>
                    <div className={styles.colStatus}>Status</div>
                    <div className={styles.colAction}>Action</div>
                </div>

                {/* Rows */}
                {courses.map(course => (
                    <div key={course.id} className={styles.tableRow}>
                        {/* Name */}
                        <div className={styles.colName}>
                            <div className={styles.courseIcon}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
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
                                        style={{ width: `${course.progress}%` }}
                                    />
                                </div>
                                <span className={styles.progressText}>{course.progress}%</span>
                            </div>
                        </div>

                        {/* Deadline */}
                        <div className={styles.colDeadline}>
                            {course.deadline ? (
                                <>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="12" r="10"></circle>
                                        <polyline points="12 6 12 12 16 14"></polyline>
                                    </svg>
                                    {new Date(course.deadline).toLocaleDateString()}
                                </>
                            ) : (
                                <span style={{ color: '#A0AEC0' }}>No Deadline</span>
                            )}
                        </div>

                        {/* Status */}
                        <div className={styles.colStatus}>
                            <span className={`${styles.statusBadge} ${course.status === 'in_progress' ? styles.statusInProgress :
                                    course.status === 'completed' ? styles.statusCompleted :
                                        course.status === 'attested' ? styles.statusAttested :
                                            course.status === 'failed' ? styles.statusFailed : ''
                                }`}>
                                {course.status === 'in_progress' && (
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}>
                                        <circle cx="12" cy="12" r="10"></circle>
                                        <polyline points="12 6 12 12 16 14"></polyline>
                                    </svg>
                                )}
                                {course.status === 'attested' ? 'Attested' :
                                    course.status === 'in_progress' ? 'In progress' :
                                        course.status.charAt(0).toUpperCase() + course.status.slice(1).replace('_', ' ')}
                            </span>
                        </div>

                        {/* Action */}
                        <div className={styles.colAction}>
                            {course.status === 'failed' ? (
                                <Link href={`/learn/${course.id}`} className={styles.retryLink}>Retry</Link>
                            ) : (
                                <Link href={`/learn/${course.id}`} className={styles.viewLink}>
                                    {course.progress > 0 && course.status !== 'attested' ? 'Continue' : 'View'}
                                </Link>
                            )}

                            {/* Simple kebab menu icon placeholder */}
                            <button style={{ background: 'none', border: 'none', cursor: 'pointer', marginLeft: '12px', color: '#A0AEC0' }}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="1"></circle>
                                    <circle cx="12" cy="5" r="1"></circle>
                                    <circle cx="12" cy="19" r="1"></circle>
                                </svg>
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </section>
    );
}
