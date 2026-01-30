'use client';

import React from 'react';
import styles from './TrainingDashboard.module.css';
import { Button, Input } from '@/components/ui';
import Image from 'next/image';

interface TrainingDashboardProps {
    onCreateCourse: () => void;
}

export default function TrainingDashboard({ onCreateCourse }: TrainingDashboardProps) {
    const monthlyData = [
        { month: 'Jan', value: 65 },
        { month: 'Feb', value: 40 },
        { month: 'Mar', value: 80 },
        { month: 'Apr', value: 55 },
        { month: 'May', value: 70 },
        { month: 'Jun', value: 60 },
        { month: 'Jul', value: 55 },
        { month: 'Aug', value: 90 }, // Higher bar
        { month: 'Sep', value: 75 },
        { month: 'Oct', value: 45 },
        { month: 'Nov', value: 70 },
        { month: 'Dec', value: 50 },
    ];

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div>
                    <div className={styles.breadcrumbs}>Home / Training</div>
                    <h1 className={styles.title}>Dashboard</h1>
                    <p className={styles.subtitle}>Here is an overview of your courses</p>
                </div>
                <Button onClick={onCreateCourse} className={styles.createButton}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    Create Course
                </Button>
            </div>

            {/* Stats Cards */}
            <div className={styles.statsGrid}>
                {/* Courses Card */}
                <div className={`${styles.statCard} ${styles.green}`}>
                    <div>
                        <div className={styles.iconWrapper}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                            </svg>
                        </div>
                        <div className={styles.statLabel}>Total Courses</div>
                        <div className={styles.statValue}>15</div>
                    </div>
                </div>

                {/* Staff Card */}
                <div className={`${styles.statCard} ${styles.blue}`}>
                    <div>
                        <div className={styles.iconWrapper}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                <circle cx="9" cy="7" r="4"></circle>
                                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                            </svg>
                        </div>
                        <div className={styles.statLabel}>Total Staff Assigned</div>
                        <div className={styles.statValue}>220</div>
                    </div>
                </div>

                {/* Avg Grade Card */}
                <div className={`${styles.statCard} ${styles.red}`}>
                    <div>
                        <div className={styles.iconWrapper}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                                <polyline points="22 4 12 14.01 9 11.01"></polyline>
                            </svg>
                        </div>
                        <div className={styles.statLabel}>Average Grade</div>
                        <div className={styles.statValue}>40%</div>
                    </div>
                </div>
            </div>

            {/* Charts Section */}
            <div className={styles.chartsGrid}>
                {/* Bar Chart */}
                <div className={styles.chartCard}>
                    <div className={styles.chartHeader}>
                        <h3 className={styles.chartTitle}>Performance of Learners</h3>
                        <div className={styles.filterSelect}>Monthly</div>
                    </div>

                    <div className={styles.barChartContainer}>
                        {/* Y-Axis Labels */}
                        <div className={styles.yAxis}>
                            <span>100</span>
                            <span>80</span>
                            <span>60</span>
                            <span>40</span>
                            <span>20</span>
                            <span>0</span>
                        </div>

                        {/* Bars */}
                        {monthlyData.map((d, i) => (
                            <div key={i} className={styles.barGroup}>
                                <div
                                    className={styles.bar}
                                    style={{ height: `${d.value}%` }}
                                    title={`${d.month}: ${d.value}%`}
                                />
                                <span className={styles.monthLabel}>{d.month}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Pie Chart */}
                <div className={styles.chartCard}>
                    <h3 className={styles.chartTitle} style={{ marginBottom: '24px' }}>Training Coverage</h3>

                    <div className={styles.pieChartContainer}>
                        <div className={styles.pieChart}>
                            {/* Simulated Tooltip */}
                            <div className={styles.tooltip}>
                                <div className={styles.tooltipHeader}>T Number</div>
                                <div>% of staff currently enrolled (in progress): 34%</div>
                            </div>
                        </div>

                        <div className={styles.legend}>
                            <div className={styles.legendItem}>
                                <div className={styles.legendLeft}>
                                    <div className={`${styles.dot} ${styles.red}`}></div>
                                    <span>% of staff who have completed</span>
                                </div>
                                <span className={styles.legendPercent}>30%</span>
                            </div>
                            <div className={styles.legendItem}>
                                <div className={styles.legendLeft}>
                                    <div className={`${styles.dot} ${styles.lightBlue}`}></div>
                                    <span>% of staff currently enrolled</span>
                                </div>
                                <span className={styles.legendPercent}>34%</span>
                            </div>
                            <div className={styles.legendItem}>
                                <div className={styles.legendLeft}>
                                    <div className={`${styles.dot} ${styles.blue}`}></div>
                                    <span>% of staff yet to begin any course</span>
                                </div>
                                <span className={styles.legendPercent}>36%</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {/* My Courses Widget */}
            <div className={styles.coursesSection}>
                <div className={styles.coursesHeader}>
                    <h3 className={styles.coursesTitle}>My Courses</h3>
                    <div className={styles.coursesControls}>
                        <Input
                            placeholder="Search for courses..."
                            className={styles.searchInput}
                            leftIcon={
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: '#A0AEC0' }}>
                                    <circle cx="11" cy="11" r="8"></circle>
                                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                                </svg>
                            }
                        />
                        <Button variant="outline" size="md" className={styles.exportButton}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                            Export
                        </Button>
                    </div>
                </div>

                <table className={styles.coursesTable}>
                    <thead>
                        <tr>
                            <th className={styles.colName}>Course Name</th>
                            <th className={styles.colStaff}>Assigned Staff</th>
                            <th className={styles.colCompletion}>Completion %</th>
                            <th className={styles.colDate}>Date Created</th>
                            <th className={styles.colAction}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {[
                            { id: 1, name: 'HIPAA Privacy Training', level: 'Advanced', icon: '/images/icon-course-dark.svg' },
                            { id: 2, name: 'HIPAA Privacy Training', level: 'Advanced', icon: '/images/icon-course-blue.svg' },
                            { id: 3, name: 'HIPAA Privacy Training', level: 'Advanced', icon: '/images/icon-course-blue.svg' },
                            { id: 4, name: 'HIPAA Privacy Training', level: 'Advanced', icon: '/images/icon-course-dark.svg' },
                            { id: 5, name: 'HIPAA Privacy Training', level: 'Advanced', icon: '/images/icon-course-blue.svg' },
                        ].map((course) => (
                            <tr key={course.id}>
                                <td>
                                    <div className={styles.courseInfo}>
                                        <div className={styles.courseIcon}>
                                            <Image
                                                src={course.icon}
                                                alt={course.name}
                                                width={40}
                                                height={40}
                                            />
                                        </div>
                                        <div>
                                            <span className={styles.courseName}>{course.name}</span>
                                            <div className={styles.courseSub}>{course.level}</div>
                                        </div>
                                    </div>
                                </td>
                                <td>8</td>
                                <td>80%</td>
                                <td>Dec 23, 2023</td>
                                <td>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#A0AEC0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ cursor: 'pointer' }}>
                                        <polyline points="9 18 15 12 9 6"></polyline>
                                    </svg>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                <div className={styles.viewAllContainer}>
                    <Button variant="outline" size="sm" className={styles.viewAllButton}>
                        View all
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: '4px' }}>
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                            <polyline points="15 3 21 3 21 9"></polyline>
                            <line x1="10" y1="14" x2="21" y2="3"></line>
                        </svg>
                    </Button>
                </div>
            </div>
        </div>
    );
}
