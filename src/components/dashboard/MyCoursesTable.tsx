'use client';

import React, { useState } from 'react';
import styles from './MyCoursesTable.module.css';
import { Input } from '@/components/ui';
import Image from 'next/image';
import Link from 'next/link';

interface Course {
    id: string;
    title: string;
    thumbnail?: string | null;
    level?: string | null;
    enrollmentsCount: number;
    completionRate: number;
    createdAt: Date;
}

interface MyCoursesTableProps {
    courses: Course[];
    maxItems?: number;
}

export default function MyCoursesTable({ courses, maxItems = 5 }: MyCoursesTableProps) {
    const [searchQuery, setSearchQuery] = useState('');

    // Filter Logic
    const filteredCourses = courses.filter((course) =>
        course.title.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Limit to maxItems for dashboard view
    const displayCourses = filteredCourses.slice(0, maxItems);

    return (
        <div className={styles.container}>
            {/* Header */}
            <div className={styles.header}>
                <h3 className={styles.title}>My Courses</h3>
                <div className={styles.searchContainer}>
                    <Input
                        placeholder="Search for courses..."
                        className={styles.searchInput}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        leftIcon={
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#A0AEC0' }}>
                                <circle cx="11" cy="11" r="8"></circle>
                                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                            </svg>
                        }
                    />
                </div>
            </div>

            {/* Table */}
            <table className={styles.table}>
                <thead>
                    <tr>
                        <th style={{ width: '50%' }}>Course Name</th>
                        <th style={{ width: '25%' }}>Assigned Staff</th>
                        <th style={{ width: '25%' }}>Date Created</th>
                    </tr>
                </thead>
                <tbody>
                    {displayCourses.length > 0 ? (
                        displayCourses.map((course) => (
                            <tr
                                key={course.id}
                                onClick={() => window.location.href = `/dashboard/training/courses/${course.id}`}
                                className={styles.clickableRow}
                            >
                                <td>
                                    <div className={styles.courseInfo}>
                                        <div className={styles.courseIcon}>
                                            <Image
                                                src={course.thumbnail || '/images/icon-course-blue.svg'}
                                                alt={course.title}
                                                width={40}
                                                height={40}
                                            />
                                        </div>
                                        <div>
                                            <span className={styles.courseName}>{course.title}</span>
                                            {course.level && (
                                                <span className={styles.courseLevel}>{course.level}</span>
                                            )}
                                        </div>
                                    </div>
                                </td>
                                <td>{course.enrollmentsCount}</td>
                                <td>
                                    {new Date(course.createdAt).toLocaleDateString('en-US', {
                                        month: 'short',
                                        day: 'numeric',
                                        year: 'numeric',
                                    })}
                                </td>
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td colSpan={3} className={styles.emptyState}>
                                No courses found.
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>

            {/* View All Button */}
            {filteredCourses.length > maxItems && (
                <div className={styles.viewAllContainer}>
                    <Link href="/dashboard/courses" className={styles.viewAllButton}>
                        View all
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                            <polyline points="15 3 21 3 21 9"></polyline>
                            <line x1="10" y1="14" x2="21" y2="3"></line>
                        </svg>
                    </Link>
                </div>
            )}
        </div>
    );
}
