'use client';

import React from 'react';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    Label
} from 'recharts';
import styles from '@/app/dashboard/(main)/page.module.css';

interface DashboardChartsProps {
    stats?: {
        coursePerformance?: {
            name: string;
            score: number;
            passingScore: number;
        }[];
        trainingCoverage?: {
            completed: number;
            inProgress: number;
            notStarted: number;
            totalStaff?: number;
        };
    };
}

const COLORS = {
    complete: '#F59E0B',     // Yellow/Orange from ref
    inProgress: '#10B981',   // Teal/Green from ref
    notStarted: '#EF4444',   // Red from ref
    // The reference image has:
    // Red section (large), Yellow (medium), Teal (medium)
    // Legend says:
    // Tea/Green: Completed (30%)
    // Blue: Enrolled (34%) -> Wait, image shows Yellow/Red/Teal?
    // Let's look at the image again.
    // Image:
    // Left Chart (Bar): Red bars and Yellow bars. Red < Green? No.
    // The user said: "green is pass above pass mark and red is below pass mark".
    // So for Bar chart: Score >= Passing ? Green : Red.

    // Right Chart (Donut):
    // Colors in donut: Red, Yellow, Teal.
    // Legend in image:
    // Teal dot: Staff who have completed required courses
    // Blue dot: Staff currently enrolled (BUT donut has Yellow segment?)
    // Purple dot: Staff yet to begin (BUT donut has Red segment?)

    // User Instructions: "make it what is in that ref image"
    // "barchart must be green and red"
    // "donut chart"

    // I will stick to the Legend text but map to the colors seen in the Donut ring if possible, or standard semantic colors.
    // Let's use:
    // Completed: Teal (#10B981) - matches "Teal" in image ring?
    // Enrolled: Yellow (#F59E0B) - matches "Yellow" in image ring?
    // Not Started: Red (#EF4444) - matches "Red" in image ring?
};

const truncateLabel = (value: string) => {
    if (value.length > 15) return value.substring(0, 15) + '...';
    return value;
};

export default function DashboardCharts({ stats }: DashboardChartsProps) {
    if (!stats) return null;

    const { coursePerformance = [], trainingCoverage } = stats;

    // Overriding colors to match the Donut Ring in the image more closely:
    const donutData = [
        { name: 'Completed', value: trainingCoverage?.completed || 0, color: '#14B8A6' },
        { name: 'Enrolled', value: trainingCoverage?.inProgress || 0, color: '#F59E0B' },
        { name: 'Not Started', value: trainingCoverage?.notStarted || 0, color: '#EF4444' },
    ];

    const activeDonutData = donutData.filter(d => d.value > 0);

    return (
        <div className={styles.chartsGrid}>
            {/* Performance Chart */}
            <div className={styles.chartCard}>
                <div className={styles.chartHeader}>
                    <h3 className={styles.chartTitle}>Performance of Learners</h3>
                    <button className={styles.periodSelect}>Courses</button>
                </div>

                <div style={{ width: '100%', height: 300, position: 'relative' }}>
                    <div style={{ position: 'absolute', top: '50%', left: -30, transform: 'rotate(-90deg)', fontSize: 12, color: '#4A5568', fontWeight: 500 }}>
                        Scores (%)
                    </div>

                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                            data={coursePerformance}
                            margin={{ top: 10, right: 10, left: 10, bottom: 60 }}
                            barSize={32}
                        >
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                            <XAxis
                                dataKey="name"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fontSize: 10, fill: '#718096' }}
                                dy={10}
                                angle={-45}
                                textAnchor="end"
                                interval={0}
                                tickFormatter={truncateLabel}
                            />
                            <YAxis
                                axisLine={false}
                                tickLine={false}
                                tick={{ fontSize: 10, fill: '#718096' }}
                                domain={[0, 100]}
                                ticks={[0, 20, 40, 60, 80, 100]}
                            />
                            <Tooltip
                                cursor={{ fill: '#F7FAFC' }}
                                contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                            />
                            <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                                {coursePerformance.map((entry, index) => (
                                    <Cell
                                        key={`cell-${index}`}
                                        fill={entry.score >= entry.passingScore ? '#10B981' : '#EF4444'}
                                    />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Coverage Donut Chart */}
            <div className={styles.chartCard}>
                <div className={styles.chartHeader}>
                    <h3 className={styles.chartTitle}>Training Coverage</h3>
                </div>

                <div style={{ width: '100%', height: 220, position: 'relative' }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={donutData}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={85}
                                paddingAngle={0}
                                dataKey="value"
                            >
                                {donutData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                                ))}
                                <Label
                                    value={trainingCoverage?.totalStaff || 0}
                                    position="center"
                                    dy={0}
                                    style={{
                                        fontSize: '24px',
                                        fontWeight: 'bold',
                                        fill: '#1F2937',
                                    }}
                                />
                                <Label
                                    value="Total Staff"
                                    position="center"
                                    dy={-20}
                                    style={{
                                        fontSize: '12px',
                                        fill: '#6B7280',
                                    }}
                                />
                            </Pie>
                        </PieChart>
                    </ResponsiveContainer>
                </div>

                <div className={styles.legend} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '12px 16px', alignItems: 'center' }}>
                    {/* Header Row could be here if needed, but simple list is better */}

                    {/* Item 1 */}
                    <div className={styles.legendDot} style={{ background: '#14B8A6' }}></div>
                    <div style={{ fontSize: '14px', color: '#4A5568' }}>Staff who have completed required courses</div>
                    <div className={styles.legendValue}>{trainingCoverage?.completed}%</div>

                    {/* Item 2 */}
                    <div className={styles.legendDot} style={{ background: '#F59E0B' }}></div>
                    <div style={{ fontSize: '14px', color: '#4A5568' }}>Staff currently enrolled (in progress)</div>
                    <div className={styles.legendValue}>{trainingCoverage?.inProgress}%</div>

                    {/* Item 3 */}
                    <div className={styles.legendDot} style={{ background: '#EF4444' }}></div>
                    <div style={{ fontSize: '14px', color: '#4A5568' }}>Staff yet to begin any course</div>
                    <div className={styles.legendValue}>{trainingCoverage?.notStarted}%</div>
                </div>
            </div>
        </div>
    );
}
