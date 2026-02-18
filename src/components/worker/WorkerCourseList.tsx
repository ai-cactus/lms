'use client';

import React, { useState } from 'react';
import styles from './WorkerDashboard.module.css';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';

interface Course {
    id: string;
    title: string;
    category?: string;
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

    const handleStartClick = (courseId: string) => {
        router.push(`/learn/${courseId}`);
    };

    const handleViewResultClick = (courseId: string) => {
        // Route to the worker course details page which acts as the "Result/Completion" view
        router.push(`/worker/courses/${courseId}`);
    };

    return (
        <section>
            <div className={styles.courseListHeader}>
                <h2 className={styles.sectionTitle}>Assigned Courses</h2>
                {/* Search could be here if needed */}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {filtered.length > 0 ? (
                    filtered.map(course => {
                        const isCompleted = course.status === 'completed' || course.status === 'attested';

                        return (
                            <div
                                key={course.id}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    background: 'white',
                                    border: '1px solid #E2E8F0',
                                    borderRadius: '12px',
                                    padding: '24px',
                                    boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                    {/* Icon Box */}
                                    <div style={{
                                        width: '48px',
                                        height: '48px',
                                        borderRadius: '8px',
                                        background: '#1E293B', // Dark background for icon as in image
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: 'white'
                                    }}>
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                                        </svg>
                                    </div>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        <h3 style={{
                                            margin: 0,
                                            fontSize: '16px',
                                            fontWeight: 600,
                                            color: '#1A202C'
                                        }}>
                                            {course.title}
                                        </h3>
                                        <span style={{
                                            fontSize: '14px',
                                            color: '#718096'
                                        }}>
                                            {course.category || 'General'}
                                        </span>
                                    </div>
                                </div>

                                <div>
                                    {isCompleted ? (
                                        <Button
                                            variant="outline"
                                            onClick={() => handleViewResultClick(course.id)}
                                            style={{ minWidth: '120px' }}
                                        >
                                            View Result
                                        </Button>
                                    ) : (
                                        <Button
                                            variant="primary"
                                            onClick={() => handleStartClick(course.id)}
                                            style={{ minWidth: '120px', backgroundColor: '#4F46E5' }} // Indigo/Purple
                                        >
                                            Start Course
                                        </Button>
                                    )}
                                </div>
                            </div>
                        );
                    })
                ) : (
                    <div className={styles.emptyTable}>
                        <p>No courses assigned yet.</p>
                    </div>
                )}
            </div>
        </section>
    );
}
