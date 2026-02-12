'use client';

import React, { useState } from 'react';
import styles from './CoursePreview.module.css';
import { Button } from '@/components/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface CoursePreviewProps {
    course: any;
}

export default function CoursePreview({ course }: CoursePreviewProps) {
    const [activeTab, setActiveTab] = useState('About');

    return (
        <div className={styles.container}>
            {/* Dark Header Section */}
            <div className={styles.heroSection}>
                <div className={styles.heroContent}>
                    <div className={styles.breadcrumbs}>
                        <Link href={`/dashboard/training/courses/${course.id}`} className={styles.breadcrumbLink}>Course</Link>
                        <span className={styles.separator}>/</span>
                        <span className={styles.currentBreadcrumb}>{course.title}</span>
                    </div>

                    <h1 className={styles.title}>{course.title}</h1>
                    <p className={styles.description}>
                        {course.description || "Mandatory annual training aligned with CARF 1.H 4. a-b"}
                    </p>
                    <p className={styles.author}>
                        By {course.creator?.profile?.fullName || course.creator?.email || "Unknown Author"}
                    </p>

                    <div className={styles.metaRow}>
                        <span className={`${styles.badge} ${styles.badgeActive}`}>Active</span>
                        <div className={styles.metaItem}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                            {course.duration || 0} min read
                        </div>
                        {course.lessons?.some((l: any) => l.quiz) && (
                            <div className={styles.metaItem}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                                Pass mark: {course.lessons.find((l: any) => l.quiz)?.quiz?.passingScore || 70}%
                            </div>
                        )}
                    </div>

                    <div className={styles.heroActions}>
                        <Button className={styles.startCourseButton}>View Course</Button>
                    </div>
                </div>
            </div>

            {/* Main Content */}
            <div className={styles.mainLayout}>
                {/* Left Column */}
                <div className={styles.contentColumn}>
                    <div className={styles.mainCard}>
                        {/* Tabs */}
                        <div className={styles.tabs}>
                            {['About'].map(tab => (
                                <button
                                    key={tab}
                                    className={`${styles.tab} ${activeTab === tab ? styles.activeTab : ''}`}
                                    onClick={() => setActiveTab(tab)}
                                >
                                    {tab}
                                </button>
                            ))}
                        </div>

                        {activeTab === 'About' && (
                            <div className={styles.tabContent}>
                                <h2 className={styles.sectionTitle}>Course Overview</h2>
                                <p className={styles.text}>
                                    This course ensures all personnel understand and apply CARF-aligned safety principles in daily operations. It covers essential workplace safety measures, emergency response protocols, and staff responsibilities in maintaining a safe therapeutic environment.
                                    <br /><br />
                                    Designed to meet CARF Standards 1.H.4.a-b, this training is a mandatory annual requirement for all staff.
                                </p>


                            </div>
                        )}
                    </div>
                </div>

                {/* Right Column (Sidebar) */}
                <div className={styles.sidebarColumn}>
                    <div className={styles.sidebarCard}>
                        <h3 className={styles.sidebarTitle}>Course Content</h3>
                        <div className={styles.lessonsList}>
                            {course.lessons && course.lessons.length > 0 ? (
                                course.lessons.map((lesson: any, i: number) => (
                                    <div key={lesson.id} className={styles.lessonItem}>
                                        <span className={styles.lessonTitle}>{lesson.title}</span>
                                    </div>
                                ))
                            ) : (
                                <div className={styles.lessonItem} style={{ color: '#718096', fontStyle: 'italic' }}>
                                    No content available yet.
                                </div>
                            )}
                        </div>

                        <div className={styles.divider}></div>

                        <div className={styles.courseMeta}>
                            {/* Skill Level - Try to get from quiz or hide */}
                            {course.lessons?.some((l: any) => l.quiz?.difficulty) && (
                                <div className={styles.metaRowSidebar}>
                                    <span className={styles.metaLabel}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#A0AEC0' }}>
                                            <path d="M12 20V10"></path><path d="M18 20V4"></path><path d="M6 20v-4"></path>
                                        </svg>
                                        Skill Level
                                    </span>
                                    <span className={styles.metaValue} style={{ textTransform: 'capitalize' }}>
                                        {course.lessons.find((l: any) => l.quiz?.difficulty)?.quiz?.difficulty || 'General'}
                                    </span>
                                </div>
                            )}

                            <div className={styles.metaRowSidebar}>
                                <span className={styles.metaLabel}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#A0AEC0' }}>
                                        <circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>
                                    </svg>
                                    Duration
                                </span>
                                <span className={styles.metaValue}>{course.duration || 0} mins</span>
                            </div>
                            <div className={styles.metaRowSidebar}>
                                <span className={styles.metaLabel}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#A0AEC0' }}>
                                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>
                                    </svg>
                                    Last Updated
                                </span>
                                <span className={styles.metaValue}>
                                    {new Date(course.updatedAt).toLocaleDateString(undefined, {
                                        year: 'numeric',
                                        month: 'long',
                                        day: 'numeric'
                                    })}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
