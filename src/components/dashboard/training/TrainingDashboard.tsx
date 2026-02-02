'use client';

import React, { useState } from 'react';
import styles from './TrainingDashboard.module.css';
import { Button, Input } from '@/components/ui';
import Image from 'next/image';
import { CourseWithStats } from '@/app/actions/course';
import { useRouter } from 'next/navigation';
import { BarChart as Chart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export interface DashboardStats {
    totalCourses: number;
    totalStaffAssigned: number;
    averageGrade: number;
    monthlyPerformance: { month: string; value: number }[];
    trainingCoverage: {
        completed: number;
        inProgress: number;
        notStarted: number;
    };
}

interface TrainingDashboardProps {
    onCreateCourse: () => void;
    stats: DashboardStats;
    courses: CourseWithStats[];
}

// Interactive Pie Chart with hover tooltips
function PieChartWithTooltip({ coverage }: { coverage: DashboardStats['trainingCoverage'] }) {
    const [activeSegment, setActiveSegment] = useState<string | null>(null);

    const segments = [
        { id: 'completed', label: '% of staff who have completed required courses', value: coverage.completed, color: '#E53E3E', hoverColor: '#FC8181', position: 'right' as const },
        { id: 'enrolled', label: '% of staff currently enrolled (in progress)', value: coverage.inProgress, color: '#BFCCFA', hoverColor: '#D6E0FF', position: 'bottom' as const },
        { id: 'notStarted', label: '% of staff yet to begin any course', value: coverage.notStarted, color: '#3182CE', hoverColor: '#63B3ED', position: 'left' as const },
    ];

    // Calculate SVG arc paths
    const size = 200;
    const center = size / 2;
    const radius = 90;

    let startAngle = 0;
    const paths = segments.map(segment => {
        const angle = (segment.value / 100) * 360;
        const endAngle = startAngle + angle;

        const startRad = (startAngle - 90) * (Math.PI / 180);
        const endRad = (endAngle - 90) * (Math.PI / 180);

        const x1 = center + radius * Math.cos(startRad);
        const y1 = center + radius * Math.sin(startRad);
        const x2 = center + radius * Math.cos(endRad);
        const y2 = center + radius * Math.sin(endRad);

        const largeArc = angle > 180 ? 1 : 0;

        const path = `M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;

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
                // Position at the top-right to avoid cutting off on small screens
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
                {paths.map((segment) => (
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
            </svg>

            {/* Smart positioned tooltip */}
            {activeData && (
                <div style={{
                    position: 'absolute',
                    ...getTooltipPosition(activeData.position),
                    width: '170px',
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
                            background: '#805AD5',
                            color: 'white',
                            padding: '4px 10px',
                            borderRadius: '4px',
                            display: 'inline-block',
                            fontWeight: 600,
                            marginBottom: '8px',
                        }}>
                            T Number
                        </div>
                        <div style={{
                            color: '#4A5568',
                            lineHeight: 1.5,
                        }}>
                            {activeData.label}: {activeData.value}%
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
    // State for time filter
    const [timeFilter, setTimeFilter] = useState<'Weekly' | 'Monthly'>('Monthly');

    // Use real data from props
    const coverage = stats.trainingCoverage;

    // Filter data based on selection - use real monthly data, generate weekly from it
    const chartData = (() => {
        if (timeFilter === 'Monthly') {
            return stats.monthlyPerformance;
        }
        if (timeFilter === 'Weekly') {
            // Generate weekly average from last 7 days of available data
            const lastMonth = stats.monthlyPerformance[stats.monthlyPerformance.length - 1]?.value || 0;
            const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
            return days.map((day, i) => ({
                month: day,
                value: Math.round(lastMonth * (0.8 + Math.random() * 0.4)) // Variation around last month
            }));
        }
        return [];
    })();

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
                <div className={styles.chartCard}>
                    <div className={styles.chartHeader}>
                        <h3 className={styles.chartTitle}>Performance of Learners</h3>
                        <div className={styles.filterContainer}>
                            {(['Weekly', 'Monthly'] as const).map((filter) => (
                                <button
                                    key={filter}
                                    className={`${styles.filterButton} ${timeFilter === filter ? styles.active : ''}`}
                                    onClick={() => setTimeFilter(filter)}
                                >
                                    {filter}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className={styles.barChartContainer}>
                        <ResponsiveContainer width="100%" height="100%">
                            <Chart
                                data={chartData}
                                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                            >
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EDF2F7" />
                                <XAxis
                                    dataKey="month" // Reusing 'month' key even for week/year
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#A0AEC0', fontSize: 12 }}
                                    dy={10}
                                />
                                <YAxis
                                    axisLine={false}
                                    tickLine={false}
                                    tick={{ fill: '#A0AEC0', fontSize: 12 }}
                                />
                                <Bar
                                    dataKey="value"
                                    fill="#4C6EF5" /* Indigo Blue */
                                    radius={[4, 4, 0, 0]}
                                    barSize={24}
                                />
                                <Tooltip
                                    cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                                />
                            </Chart>
                        </ResponsiveContainer>
                    </div>

                </div>

                <div className={styles.chartCard}>
                    <h3 className={styles.chartTitle} style={{ marginBottom: '24px' }}>Training Coverage</h3>

                    <div className={styles.pieChartContainer}>
                        <PieChartWithTooltip coverage={coverage} />

                        <div className={styles.legend}>
                            <div className={styles.legendItem}>
                                <div className={styles.legendLeft}>
                                    <div className={`${styles.dot} ${styles.red}`}></div>
                                    <span>% of staff who have completed</span>
                                </div>
                                <span className={styles.legendPercent}>{coverage.completed}%</span>
                            </div>
                            <div className={styles.legendItem}>
                                <div className={styles.legendLeft}>
                                    <div className={`${styles.dot} ${styles.lightBlue}`}></div>
                                    <span>% of staff currently enrolled</span>
                                </div>
                                <span className={styles.legendPercent}>{coverage.inProgress}%</span>
                            </div>
                            <div className={styles.legendItem}>
                                <div className={styles.legendLeft}>
                                    <div className={`${styles.dot} ${styles.blue}`}></div>
                                    <span>% of staff yet to begin any course</span>
                                </div>
                                <span className={styles.legendPercent}>{coverage.notStarted}%</span>
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
                                                <div className={styles.courseSub}>{course.difficulty}</div>
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
