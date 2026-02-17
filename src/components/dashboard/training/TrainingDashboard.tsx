'use client';

import React, { useState } from 'react';
import styles from './TrainingDashboard.module.css';
import { Button, Input } from '@/components/ui';
import Image from 'next/image';
import { CourseWithStats } from '@/app/actions/course';
import { useRouter } from 'next/navigation';
import { BarChart as Chart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';

export interface DashboardStats {
    totalCourses: number;
    totalStaffAssigned: number;
    averageGrade: number;
    monthlyPerformance: { month: string; value: number }[];
    coursePerformance?: {
        name: string;
        score: number;
        passingScore: number;
    }[];
    trainingCoverage: {
        completed: number;
        inProgress: number;
        notStarted: number;
        totalStaff?: number;
    };
}

interface TrainingDashboardProps {
    onCreateCourse: () => void;
    stats: DashboardStats;
    courses: CourseWithStats[];
}

// ... imports remain the same ...
// Interactive Donut Chart with hover tooltips
function DonutChartWithTooltip({ coverage }: { coverage: DashboardStats['trainingCoverage'] }) {
    const [activeSegment, setActiveSegment] = useState<string | null>(null);

    const segments = [
        { id: 'completed', label: 'Staff who have completed required courses', value: coverage.completed, color: '#14B8A6', hoverColor: '#2DD4BF', position: 'right' as const },
        { id: 'enrolled', label: 'Staff currently enrolled (in progress)', value: coverage.inProgress, color: '#F59E0B', hoverColor: '#FBBF24', position: 'bottom' as const },
        { id: 'notStarted', label: 'Staff yet to begin any course', value: coverage.notStarted, color: '#EF4444', hoverColor: '#F87171', position: 'left' as const },
    ];

    // Calculate SVG arc paths
    const size = 200;
    const center = size / 2;
    const radius = 85;
    const innerRadius = 60; // Donut hole radius

    let startAngle = 0;

    // Check if we have any data to show
    const totalValue = segments.reduce((acc, curr) => acc + curr.value, 0);
    const hasData = totalValue > 0;

    const paths = segments.map(segment => {
        // If no data, render empty gray ring? Or just don't render. 
        // Logic assumes percentage values sum to 100 roughly.
        const angle = (segment.value / 100) * 360;
        const endAngle = startAngle + angle;

        const startRad = (startAngle - 90) * (Math.PI / 180);
        const endRad = (endAngle - 90) * (Math.PI / 180);

        // Outer Arc
        const x1 = center + radius * Math.cos(startRad);
        const y1 = center + radius * Math.sin(startRad);
        const x2 = center + radius * Math.cos(endRad);
        const y2 = center + radius * Math.sin(endRad);

        // Inner Arc (reverse direction for hole)
        const x3 = center + innerRadius * Math.cos(endRad);
        const y3 = center + innerRadius * Math.sin(endRad);
        const x4 = center + innerRadius * Math.cos(startRad);
        const y4 = center + innerRadius * Math.sin(startRad);

        const largeArc = angle > 180 ? 1 : 0;

        // Path command: Move to start outer, Arc to end outer, Line to end inner, Arc to start inner, Close
        const path = `
            M ${x1} ${y1} 
            A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} 
            L ${x3} ${y3} 
            A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x4} ${y4} 
            Z
        `;

        startAngle = endAngle;

        return { ...segment, path };
    });

    const handleSegmentInteraction = (segmentId: string) => {
        setActiveSegment(prev => prev === segmentId ? null : segmentId);
    };

    const activeData = segments.find(s => s.id === activeSegment);

    // Get tooltip position styles based on segment
    const getTooltipPosition = (position: 'left' | 'right' | 'top' | 'bottom') => {
        switch (position) {
            case 'right':
                return { right: '-20px', top: '-110px' };
            case 'left':
                return { right: '210px', top: '50%', transform: 'translateY(-50%)' };
            case 'top':
                return { left: '50%', bottom: '210px', transform: 'translateX(-50%)' };
            case 'bottom':
                return { left: '50%', top: '210px', transform: 'translateX(-50%)' };
        }
    };

    return (
        <div style={{ position: 'relative', display: 'inline-block' }}>
            <svg
                width={size}
                height={size}
                style={{ cursor: 'pointer', display: 'block' }}
                onMouseLeave={() => setActiveSegment(null)}
            >
                {/* Donut Logic */}
                {hasData && paths.map((segment) => (
                    <path
                        key={segment.id}
                        d={segment.path}
                        fill={activeSegment === segment.id ? segment.hoverColor : segment.color}
                        onMouseEnter={() => setActiveSegment(segment.id)}
                        onClick={() => handleSegmentInteraction(segment.id)}
                        onTouchStart={() => handleSegmentInteraction(segment.id)}
                        style={{
                            transition: 'all 0.2s ease',
                            filter: activeSegment === segment.id
                                ? 'brightness(1.2) drop-shadow(0 2px 4px rgba(0,0,0,0.3))'
                                : 'brightness(1)',
                            transformOrigin: 'center center',
                        }}
                        opacity={activeSegment && activeSegment !== segment.id ? 0.4 : 1}
                    />
                ))}

                {/* Central Text */}
                <text x="50%" y="45%" textAnchor="middle" dy=".3em" fontSize="12" fill="#6B7280" fontWeight="500">
                    Total Staff
                </text>
                <text x="50%" y="55%" textAnchor="middle" dy=".3em" fontSize="24" fill="#1F2937" fontWeight="bold">
                    {coverage.totalStaff || 0}
                </text>
            </svg>

            {/* Smart positioned tooltip */}
            {activeData && (
                <div style={{
                    position: 'absolute',
                    ...getTooltipPosition(activeData.position),
                    width: '180px',
                    zIndex: 100,
                }}>
                    <div style={{
                        background: 'white',
                        border: '1px solid #E2E8F0',
                        padding: '12px',
                        borderRadius: '8px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                        fontSize: '13px',
                    }}>
                        <div style={{
                            background: activeData.color,
                            color: 'white',
                            padding: '4px 10px',
                            borderRadius: '4px',
                            display: 'inline-block',
                            fontWeight: 600,
                            marginBottom: '8px',
                        }}>
                            {activeData.value}%
                        </div>
                        <div style={{
                            color: '#4A5568',
                            lineHeight: 1.5,
                        }}>
                            {activeData.label}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Main Dashboard Component
export default function TrainingDashboard({ onCreateCourse, stats, courses }: TrainingDashboardProps) {
    const router = useRouter();
    // Use real data from props
    const coverage = stats.trainingCoverage;
    const coursePerformance = stats.coursePerformance || [];

    // Filter defaults
    const [viewMode, setViewMode] = useState<'Courses'>('Courses');

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div>
                    <div className={styles.breadcrumbs}>Home / Training</div>
                    <h2 className={styles.title}>Training Dashboard</h2>
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
                <div className={`${styles.statCard} ${styles.cardBlue}`}>
                    <div>
                        <div className={styles.iconWrapper}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
                                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
                            </svg>
                        </div>
                        <div className={styles.statLabel}>Total Courses</div>
                        <div className={styles.statValue}>{stats.totalCourses}</div>
                    </div>
                </div>

                <div className={`${styles.statCard} ${styles.cardGreen}`}>
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
                        <div className={styles.statValue}>{stats.totalStaffAssigned}</div>
                    </div>
                </div>

                <div className={`${styles.statCard} ${styles.cardRed}`}>
                    <div>
                        <div className={styles.iconWrapper}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                                <polyline points="22 4 12 14.01 9 11.01"></polyline>
                            </svg>
                        </div>
                        <div className={styles.statLabel}>Average Grade</div>
                        <div className={styles.statValue}>{stats.averageGrade}%</div>
                    </div>
                </div>
            </div>

            {/* Charts Section */}
            <div className={styles.chartsGrid}>
                {/* Performance Chart */}
                <div className={styles.chartCard}>
                    <div className={styles.chartHeader}>
                        <h3 className={styles.chartTitle}>Performance of Learners</h3>
                        <div className={styles.filterContainer}>
                            <button className={`${styles.filterButton} ${styles.active}`}>
                                Courses
                            </button>
                        </div>
                    </div>

                    <div className={styles.barChartContainer} style={{ height: 300, position: 'relative', marginTop: 10 }}>
                        <div style={{ position: 'absolute', top: '50%', left: -30, transform: 'rotate(-90deg)', fontSize: 12, color: '#A0AEC0', zIndex: 1 }}>
                            Scores (%)
                        </div>
                        <ResponsiveContainer width="100%" height="100%">
                            <Chart
                                data={coursePerformance}
                                margin={{ top: 10, right: 10, left: 10, bottom: 60 }}
                                barSize={24}
                            >
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EDF2F7" />
                                <XAxis
                                    dataKey="name"
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#A0AEC0', fontSize: 10 }}
                                    angle={-45}
                                    textAnchor="end"
                                    interval={0}
                                    dy={10}
                                    tickFormatter={(val) => val.length > 15 ? val.substring(0, 15) + '...' : val}
                                />
                                <YAxis
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#A0AEC0', fontSize: 12 }}
                                    domain={[0, 100]}
                                    ticks={[0, 20, 40, 60, 80, 100]}
                                />
                                {/* Custom Bar with Cell coloring */}
                                <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                                    {coursePerformance.map((entry, index) => (
                                        <Cell
                                            key={`cell-${index}`}
                                            fill={entry.score >= entry.passingScore ? '#10B981' : '#EF4444'}
                                        />
                                    ))}
                                </Bar>
                                <Tooltip
                                    cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                                />
                            </Chart>
                        </ResponsiveContainer>
                    </div>

                </div>

                {/* Donut Coverage Chart */}
                <div className={styles.chartCard}>
                    <h3 className={styles.chartTitle} style={{ marginBottom: '24px' }}>Training Coverage</h3>

                    <div className={styles.pieChartContainer}>
                        <DonutChartWithTooltip coverage={coverage} />

                        <div className={styles.legend} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '12px 16px', alignItems: 'center' }}>
                            {/* Item 1 */}
                            <div className={styles.dot} style={{ background: '#14B8A6' }}></div>
                            <div style={{ fontSize: '14px', color: '#4A5568' }}>% of staff who have completed</div>
                            <span className={styles.legendPercent}>{coverage.completed}%</span>

                            {/* Item 2 */}
                            <div className={styles.dot} style={{ background: '#F59E0B' }}></div>
                            <div style={{ fontSize: '14px', color: '#4A5568' }}>% of staff currently enrolled</div>
                            <span className={styles.legendPercent}>{coverage.inProgress}%</span>

                            {/* Item 3 */}
                            <div className={styles.dot} style={{ background: '#EF4444' }}></div>
                            <div style={{ fontSize: '14px', color: '#4A5568' }}>% of staff yet to begin any course</div>
                            <span className={styles.legendPercent}>{coverage.notStarted}%</span>
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
                    </div>
                </div>

                <table className={styles.coursesTable}>
                    <thead>
                        <tr>
                            <th className={styles.colName}>Course Name</th>
                            <th className={styles.colStaff}>Assigned Staff</th>
                            <th className={styles.colCompletion}>Completion %</th>
                            <th className={styles.colDate}>Date Created</th>
                        </tr>
                    </thead>
                    <tbody>
                        {courses.length === 0 ? (
                            <tr>
                                <td colSpan={4} style={{ textAlign: 'center', color: '#718096' }}>
                                    No courses found. Create your first course above.
                                </td>
                            </tr>
                        ) : (
                            courses.map((course) => (
                                <tr
                                    key={course.id}
                                    onClick={() => router.push(`/dashboard/training/courses/${course.id}`)}
                                    style={{ cursor: 'pointer' }}
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

                                            </div>
                                        </div>
                                    </td>
                                    <td>{course.enrollmentsCount}</td>
                                    <td>{course.completionRate}%</td>
                                    <td>
                                        {new Date(course.createdAt).toLocaleDateString('en-US', {
                                            month: 'short',
                                            day: 'numeric',
                                            year: 'numeric',
                                        })}
                                    </td>
                                </tr>
                            ))
                        )}
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
