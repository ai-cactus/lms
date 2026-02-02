'use client';

import React, { useState } from 'react';
import styles from './StaffProfile.module.css';
import { Button, Input } from '@/components/ui';
import Link from 'next/link';
import Image from 'next/image';

interface StaffProfileClientProps {
    staff: {
        user: {
            id: string;
            name: string;
            email: string;
            avatarUrl: string | null;
            role: string;
            jobTitle: string;
        };
        stats: {
            totalCourses: number;
            completedCourses: number;
            failedCourses: number;
            activeCourses: number;
        };
        enrollments: any[];
    };
}

export default function StaffProfileClient({ staff }: StaffProfileClientProps) {
    const { user, stats, enrollments } = staff;
    const [searchQuery, setSearchQuery] = useState('');

    // Filter enrollments
    const filteredEnrollments = enrollments.filter(e =>
        e.courseName.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className={styles.container}>
            {/* Breadcrumb */}
            <Link href="/dashboard/staff" className={styles.backLink}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="19" y1="12" x2="5" y2="12"></line>
                    <polyline points="12 19 5 12 12 5"></polyline>
                </svg>
                Go Back
                <span>/</span>
                Staff Details
                <span>/</span>
                <span className={styles.activeCrumb}>Staff Profile</span>
            </Link>

            {/* Header */}
            <div className={styles.headerProfile}>
                <div className={styles.profileInfo}>
                    <div className={styles.avatarLarge}>
                        {/* Using the same image for demo if available, or initials */}
                        {user.avatarUrl ? (
                            <img src={user.avatarUrl} alt={user.name} className={styles.avatarImage} />
                        ) : (
                            // Fallback image matching the design (dark abstract or just initials)
                            // For now using initials centered like other parts
                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', fontWeight: 600 }}>
                                {(user.name.charAt(0) || 'U').toUpperCase()}
                            </div>
                        )}
                    </div>
                    <div className={styles.infoContent}>
                        <h1 className={styles.name}>{user.name}</h1>
                        <div className={styles.emailLine}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                <circle cx="12" cy="7" r="4"></circle>
                            </svg>
                            {user.email}
                        </div>
                        <div className={styles.roleBadge}>
                            {user.jobTitle || 'Direct Support Professional (DSP)'}
                        </div>
                    </div>
                </div>

                <div className={styles.headerActions}>
                    <button className={styles.btnOutline}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                            <circle cx="8.5" cy="7" r="4"></circle>
                            <line x1="20" y1="8" x2="20" y2="14"></line>
                            <line x1="23" y1="11" x2="17" y2="11"></line>
                        </svg>
                        Assign Retake
                    </button>
                    <button className={styles.btnPrimary}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                        Assign Course
                    </button>
                </div>
            </div>

            <div className={styles.layoutGrid}>
                {/* Left Column: Bio & Background & Courses */}
                <div className={styles.leftColumn}>

                    {/* Bio Card */}
                    <div className={styles.infoCard}>
                        <div className={styles.cardHeader}>
                            <h3 className={styles.cardTitle}>Bio</h3>
                            <button className={styles.editButton}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                </svg>
                            </button>
                        </div>
                        <p className={styles.bioText}>
                            3 years of experience in residential behavioral programs.
                        </p>
                        <p className={styles.bioText}>
                            I'm passionate about helping healthcare grow, improve their policies, and to raise venture capital through good policies.
                        </p>
                    </div>

                    {/* Background Card */}
                    <div className={styles.infoCard}>
                        <div className={styles.cardHeader}>
                            <h3 className={styles.cardTitle}>Background</h3>
                            <button className={styles.editButton}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                                </svg>
                            </button>
                        </div>

                        <div className={styles.sectionRow}>
                            <div className={styles.sectionLabel}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#718096" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"></path>
                                </svg>
                                Competencies
                            </div>
                            <div className={styles.tagsWrapper}>
                                <span className={styles.tag}>Client Safety & Emergency Response</span>
                                <span className={styles.tag}>Documentation Accuracy</span>
                                <span className={styles.tag}>Infection Control</span>
                            </div>
                        </div>

                        <div className={styles.sectionRow}>
                            <div className={styles.sectionLabel}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#718096" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                                </svg>
                                Strength
                            </div>
                            <div className={styles.tagsWrapper}>
                                <span className={styles.tag}>Teamwork</span>
                                <span className={styles.tag}>Communication</span>
                                <span className={styles.tag} style={{ background: '#EDF2F7', border: '1px solid #E2E8F0' }}>Excellent documentation and ethical practice.</span>
                            </div>
                        </div>

                        <div className={styles.sectionRow}>
                            <div className={styles.sectionLabel}>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#718096" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="3" y="7" width="18" height="13" rx="2" ry="2"></rect>
                                    <path d="M16 3H8L8 7H16V3Z"></path>
                                </svg>
                                Weakness
                            </div>
                            <div className={styles.weaknessBox}>
                                Needs improvement in emergency procedures and infection control.
                            </div>
                        </div>
                    </div>

                    {/* Courses Table */}
                    <div className={styles.coursesSection}>
                        <div className={styles.coursesHeader}>
                            <h3 className={styles.coursesTitle}>Courses</h3>
                            <div className={styles.searchWrapper}>
                                <Input
                                    className=""
                                    style={{ width: '250px' }}
                                    placeholder="Search for courses..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    leftIcon={
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A0AEC0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <circle cx="11" cy="11" r="8"></circle>
                                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                                        </svg>
                                    }
                                />
                            </div>
                        </div>

                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th style={{ width: '40%' }}>Name</th>
                                    <th style={{ width: '30%' }}>Progress</th>
                                    <th style={{ width: '15%' }}>Quiz Status</th>
                                    <th style={{ width: '15%' }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredEnrollments.map(enrollment => (
                                    <tr key={enrollment.id}>
                                        <td>
                                            <div className={styles.courseItem}>
                                                <div className={styles.courseThumb}>
                                                    {/* Icon or Image */}
                                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
                                                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
                                                    </svg>
                                                </div>
                                                <div>
                                                    <span className={styles.courseName}>{enrollment.courseName}</span>
                                                    <span className={styles.courseLvl}>{enrollment.difficulty || 'Advanced'}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td>
                                            <div className={styles.progressWrapper}>
                                                <div className={styles.bgBar}>
                                                    <div className={styles.fillBar} style={{ width: `${enrollment.progress || 0}%` }}></div>
                                                </div>
                                                <span className={styles.pctText}>{enrollment.progress || 0}%</span>
                                            </div>
                                        </td>
                                        <td>
                                            {/* Logic for badges based on screenshots */}
                                            {enrollment.status === 'completed' && enrollment.score >= 70 ? (
                                                <span className={`${styles.badge} ${styles.badgePassed}`}>
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                        <polyline points="20 6 9 17 4 12"></polyline>
                                                    </svg>
                                                    Passed
                                                </span>
                                            ) : enrollment.status === 'completed' ? (
                                                <span className={`${styles.badge} ${styles.badgeFailed}`}>
                                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                        <line x1="18" y1="6" x2="6" y2="18"></line>
                                                        <line x1="6" y1="6" x2="18" y2="18"></line>
                                                    </svg>
                                                    Failed
                                                </span>
                                            ) : (
                                                <span style={{ fontSize: '12px', color: '#718096' }}>In Progress</span>
                                            )}
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            <button className={styles.viewBtn}>View</button>
                                        </td>
                                    </tr>
                                ))}
                                {filteredEnrollments.length === 0 && (
                                    <tr>
                                        <td colSpan={4} style={{ textAlign: 'center', color: '#718096', padding: '24px' }}>No courses found.</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                </div>

                {/* Right Column: Stats */}
                <div className={styles.rightColumn}>
                    <div className={`${styles.statsCard} ${styles.statsBlue}`}>
                        <div className={`${styles.statsIcon} ${styles.iconBlue}`}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                            </svg>
                        </div>
                        <div className={styles.statsInfo}>
                            <span className={styles.statsLabel}>Total Courses Assigned</span>
                            <span className={styles.statsValue}>{stats.totalCourses}</span>
                        </div>
                    </div>

                    <div className={`${styles.statsCard} ${styles.statsGreen}`}>
                        <div className={`${styles.statsIcon} ${styles.iconGreen}`}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                            </svg>
                        </div>
                        <div className={styles.statsInfo}>
                            <span className={styles.statsLabel}>Courses Completed</span>
                            <span className={styles.statsValue}>{stats.completedCourses}</span>
                        </div>
                    </div>

                    <div className={`${styles.statsCard} ${styles.statsRed}`}>
                        <div className={`${styles.statsIcon} ${styles.iconRed}`}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                            </svg>
                        </div>
                        <div className={styles.statsInfo}>
                            <span className={styles.statsLabel}>Failed / Retake Needed</span>
                            <span className={styles.statsValue}>{stats.failedCourses}</span>
                        </div>
                    </div>

                    <div className={`${styles.statsCard} ${styles.statsYellow}`}>
                        <div className={`${styles.statsIcon} ${styles.iconYellow}`}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                            </svg>
                        </div>
                        <div className={styles.statsInfo}>
                            <span className={styles.statsLabel}>Active / Due Soon</span>
                            <span className={styles.statsValue}>{stats.activeCourses}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
