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
    Cell
} from 'recharts';
import styles from '@/app/dashboard/(main)/page.module.css';

const performanceData = [
    { name: 'Jan', score: 65 },
    { name: 'Feb', score: 38 },
    { name: 'Mar', score: 80 },
    { name: 'Apr', score: 55 },
    { name: 'May', score: 70 },
    { name: 'Jun', score: 60 },
    { name: 'Jul', score: 58 },
    { name: 'Aug', score: 95 }, // Highest bar in ref image
    { name: 'Sep', score: 75 },
    { name: 'Oct', score: 50 },
    { name: 'Nov', score: 70 },
    { name: 'Dec', score: 50 },
];

const coverageData = [
    { name: 'Completed', value: 30, color: '#A5B4FC' }, // Light Blue
    { name: 'Enrolled', value: 34, color: '#4730F7' }, // Primary Blue
    { name: 'Not Started', value: 36, color: '#EF4444' }, // Red
];

export default function DashboardCharts() {
    return (
        <div className={styles.chartsGrid}>
            {/* Performance Chart */}
            <div className={styles.chartCard}>
                <div className={styles.chartHeader}>
                    <h3 className={styles.chartTitle}>Performance of Learners</h3>
                    <button className={styles.periodSelect}>Monthly</button>
                </div>

                <div style={{ width: '100%', height: 300, position: 'relative' }}>
                    {/* Y-Axis Label simulated with CSS or Recharts label */}
                    <div style={{ position: 'absolute', top: '50%', left: -40, transform: 'rotate(-90deg)', fontSize: 12, color: '#4A5568' }}>
                        Scores (%)
                    </div>

                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                            data={performanceData}
                            margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
                            barSize={12}
                        >
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                            <XAxis
                                dataKey="name"
                                axisLine={false}
                                tickLine={false}
                                tick={{ fontSize: 10, fill: '#718096' }}
                                dy={10}
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
                            <Bar dataKey="score" fill="#34D399" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {/* Coverage Pie Chart */}
            <div className={styles.chartCard}>
                <div className={styles.chartHeader}>
                    <h3 className={styles.chartTitle}>Training Coverage</h3>
                </div>

                <div style={{ width: '100%', height: 200, display: 'flex', justifyContent: 'center' }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={coverageData}
                                cx="50%"
                                cy="50%"
                                innerRadius={0}
                                outerRadius={80}
                                paddingAngle={0}
                                dataKey="value"
                            >
                                {coverageData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                                ))}
                            </Pie>
                        </PieChart>
                    </ResponsiveContainer>
                </div>

                <div className={styles.legend}>
                    <div className={styles.legendItem}>
                        <div className={styles.legendLabel}>
                            <div className={styles.legendDot} style={{ background: '#A5B4FC' }}></div>
                            % of staff who have completed required courses
                        </div>
                        <span className={styles.legendValue}>30%</span>
                    </div>
                    <div className={styles.legendItem}>
                        <div className={styles.legendLabel}>
                            <div className={styles.legendDot} style={{ background: '#4730F7' }}></div>
                            % of staff currently enrolled (in progress)
                        </div>
                        <span className={styles.legendValue}>34%</span>
                    </div>
                    <div className={styles.legendItem}>
                        <div className={styles.legendLabel}>
                            <div className={styles.legendDot} style={{ background: '#EF4444' }}></div>
                            % of staff yet to begin any course
                        </div>
                        <span className={styles.legendValue}>36%</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
