'use client';

import React, { useState, useEffect } from 'react';
import {

    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    Label
} from 'recharts';
import styles from '@/app/dashboard/(main)/page.module.css';
import Button from '@/components/ui/Button';

interface DashboardChartsProps {
    stats?: {
        coursePerformance?: {
            name: string;
            score: number;
            passingScore: number;
            passCount: number;
            failCount: number;
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

    // Safe parser for percentages or numbers
    const parseChartValue = (val: any) => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
            return parseFloat(val.replace('%', '')) || 0;
        }
        return 0;
    };

    // Overriding colors to match the Donut Ring in the image more closely:
    const donutData = [
        { name: 'Completed', value: parseChartValue(trainingCoverage?.completed), color: '#14B8A6' },
        { name: 'Enrolled', value: parseChartValue(trainingCoverage?.inProgress), color: '#F59E0B' },
        { name: 'Not Started', value: parseChartValue(trainingCoverage?.notStarted), color: '#EF4444' },
    ];

    // Filter out zero values to avoid clutter, but keep at least one if all are zero? 
    // Actually Recharts handles 0 fine, it just doesn't render a slice.
    // But we want to ensure we don't pass empty array if something is weird.
    const activeDonutData = donutData.filter(d => d.value > 0);

    const [mounted, setMounted] = useState(false);
    const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

    useEffect(() => {
        setMounted(true);
    }, []);

    // Verify data in console
    console.log('DashboardCharts Data:', { trainingCoverage, activeDonutData });

    // Helper to check if we have any data
    const hasData = activeDonutData.length > 0;

    // Placeholder for chartData, maxVal, ticks as they are not defined in the original snippet
    // and seem to belong to a different chart type (bar chart) not fully provided.
    // For the purpose of making the provided snippet syntactically correct,
    // we'll define minimal versions if they are used in the provided edit.
    const chartData = coursePerformance.map(cp => ({
        name: cp.name,
        passCount: cp.passCount,
        failCount: cp.failCount
    }));
    const maxVal = Math.max(...chartData.map(d => Math.max(d.passCount || 0, d.failCount || 0)), 5);
    const ticks = Array.from({ length: 6 }, (_, i) => Math.round((maxVal / 5) * i)).reverse();


    return (
        <div className={styles.chartsGrid}>
            {/* Performance Chart */}
            <div className={styles.chartCard} style={{ minHeight: '440px', flex: 1 }}>

                <div className={styles.chartHeader}>
                    <h3 className={styles.chartTitle}>Performance of Learners</h3>
                </div>

                {/* Legend */}
                {/* ... (Performance Chart Content) ... */}
                <div style={{
                    display: 'flex',
                    gap: '24px',
                    marginBottom: '24px',
                    paddingBottom: '16px',
                    borderBottom: '1px solid #EDF2F7',
                    marginTop: '16px'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{
                            width: '12px',
                            height: '12px',
                            borderRadius: '4px',
                            background: 'linear-gradient(180deg, #34D399 0%, #10B981 100%)'
                        }} />
                        <span style={{ fontSize: '13px', fontWeight: '500', color: '#64748B' }}>
                            Passed
                        </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{
                            width: '12px',
                            height: '12px',
                            borderRadius: '4px',
                            background: 'linear-gradient(180deg, #F87171 0%, #EF4444 100%)'
                        }} />
                        <span style={{ fontSize: '13px', fontWeight: '500', color: '#64748B' }}>
                            Failed
                        </span>
                    </div>
                </div>

                <div style={{ height: 300, position: 'relative', marginTop: 10 }}>
                    {/* ... (Performance Chart Bars/Axis) ... */}
                    {/* Y-Axis */}
                    <div style={{
                        position: 'absolute',
                        left: '0',
                        top: '0',
                        bottom: '60px',
                        width: '40px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        paddingTop: '5px'
                    }}>
                        {ticks.map((tick, i) => (
                            <div key={i} style={{
                                fontSize: '11px',
                                color: '#A0AEC0',
                                fontWeight: '500',
                                textAlign: 'right'
                            }}>
                                {tick}
                            </div>
                        ))}
                    </div>

                    {/* Grid Lines */}
                    <div style={{
                        position: 'absolute',
                        left: '50px',
                        right: '0',
                        top: '12px',
                        bottom: '60px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        zIndex: 0
                    }}>
                        {ticks.map((_, i) => (
                            <div key={i} style={{
                                height: '1px',
                                background: '#EDF2F7',
                                width: '100%'
                            }} />
                        ))}
                    </div>

                    {/* Bars Container */}
                    <div style={{
                        position: 'absolute',
                        left: '50px',
                        right: '0',
                        bottom: '60px',
                        top: '12px',
                        display: 'flex',
                        gap: '4px',
                        alignItems: 'flex-end',
                        zIndex: 1
                    }}>

                        {chartData.map((item, idx) => {
                            // Calculate heights relative to maxVal
                            const passHeight = maxVal > 0 ? ((item.passCount || 0) / maxVal) * 100 : 0;
                            const failHeight = maxVal > 0 ? ((item.failCount || 0) / maxVal) * 100 : 0;

                            return (
                                <div
                                    key={idx}
                                    style={{
                                        flex: '1',
                                        display: 'flex',
                                        gap: '4px',
                                        alignItems: 'flex-end',
                                        justifyContent: 'center',
                                        height: '100%',
                                        cursor: 'pointer',
                                        transform: hoveredIndex === idx ? 'translateY(-4px)' : 'translateY(0)',
                                        transition: 'transform 0.2s ease'
                                    }}
                                    onMouseEnter={() => setHoveredIndex(idx)}
                                    onMouseLeave={() => setHoveredIndex(null)}
                                >
                                    {/* Pass Bar */}
                                    <div style={{
                                        flex: '1',
                                        maxWidth: '20px',
                                        height: mounted ? `${passHeight}%` : '0%',
                                        background: 'linear-gradient(180deg, #34D399 0%, #10B981 100%)',
                                        borderRadius: '4px 4px 0 0',
                                        transition: 'height 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease',
                                        transitionDelay: `${idx * 0.05}s`,
                                        boxShadow: hoveredIndex === idx
                                            ? '0 4px 12px rgba(16, 185, 129, 0.3)'
                                            : 'none',
                                        position: 'relative'
                                    }}>
                                        <div style={{
                                            position: 'absolute',
                                            bottom: '100%',
                                            left: '50%',
                                            transform: 'translateX(-50%) translateY(-6px)',
                                            fontSize: '10px',
                                            fontWeight: '700',
                                            color: '#1a1a1a',
                                            background: 'white',
                                            padding: '2px 6px',
                                            borderRadius: '4px',
                                            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                                            opacity: hoveredIndex === idx ? 1 : 0,
                                            transition: 'opacity 0.2s ease',
                                            pointerEvents: 'none',
                                            whiteSpace: 'nowrap',
                                            zIndex: 10
                                        }}>
                                            {item.passCount || 0}
                                        </div>
                                    </div>

                                    {/* Fail Bar */}
                                    <div style={{
                                        flex: '1',
                                        maxWidth: '20px',
                                        height: mounted ? `${failHeight}%` : '0%',
                                        background: 'linear-gradient(180deg, #F87171 0%, #EF4444 100%)',
                                        borderRadius: '4px 4px 0 0',
                                        transition: 'height 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease',
                                        transitionDelay: `${idx * 0.05 + 0.1}s`,
                                        boxShadow: hoveredIndex === idx
                                            ? '0 4px 12px rgba(239, 68, 68, 0.3)'
                                            : 'none',
                                        position: 'relative'
                                    }}>
                                        <div style={{
                                            position: 'absolute',
                                            bottom: '100%',
                                            left: '50%',
                                            transform: 'translateX(-50%) translateY(-6px)',
                                            fontSize: '10px',
                                            fontWeight: '700',
                                            color: '#1a1a1a',
                                            background: 'white',
                                            padding: '2px 6px',
                                            borderRadius: '4px',
                                            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                                            opacity: hoveredIndex === idx ? 1 : 0,
                                            transition: 'opacity 0.2s ease',
                                            pointerEvents: 'none',
                                            whiteSpace: 'nowrap',
                                            zIndex: 10
                                        }}>
                                            {item.failCount || 0}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* X-Axis Labels */}
                    <div style={{
                        position: 'absolute',
                        left: '50px',
                        right: '0',
                        bottom: '0',
                        height: '60px',
                        display: 'flex',
                        gap: '4px'
                    }}>

                        {chartData.map((item, idx) => (
                            <div key={idx} style={{
                                flex: '1',
                                fontSize: '10px',
                                color: hoveredIndex === idx ? '#2D3748' : '#A0AEC0',
                                fontWeight: hoveredIndex === idx ? '600' : '500',
                                textAlign: 'center',
                                transform: 'rotate(-45deg)',
                                transformOrigin: 'top center',
                                paddingTop: '8px',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                transition: 'color 0.2s ease, font-weight 0.2s ease'
                            }} title={item.name}>
                                {item.name.length > 15 ? item.name.substring(0, 15) + '...' : item.name}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Coverage Donut Chart */}
            <div className={styles.chartCard} style={{ display: 'flex', flexDirection: 'column' }}>
                <div className={styles.chartHeader}>
                    <h3 className={styles.chartTitle}>Training Coverage</h3>
                </div>

                <div style={{ width: '100%', height: 260, position: 'relative', flexShrink: 0 }}>
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={hasData ? activeDonutData : [{ name: 'Empty', value: 1 }]}
                                cx="50%"
                                cy="50%"
                                innerRadius="65%"
                                outerRadius="90%"
                                paddingAngle={0}
                                dataKey="value"
                            >

                                {activeDonutData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                                ))}
                                {/* If no data, show gray ring */}
                                {!hasData && <Cell key="cell-empty" fill="#F1F5F9" stroke="none" />}

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

                <div className={styles.legend} style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    marginTop: 'auto',
                    paddingTop: '16px'
                }}>
                    {/* Item 1 */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div className={styles.legendDot} style={{ background: '#14B8A6', width: '12px', height: '12px', borderRadius: '50%', flexShrink: 0 }}></div>
                            <span style={{ fontSize: '13px', color: '#4A5568' }}>Completed</span>
                        </div>
                        <div className={styles.legendValue} style={{ fontWeight: 600 }}>{trainingCoverage?.completed}%</div>
                    </div>

                    {/* Item 2 */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div className={styles.legendDot} style={{ background: '#F59E0B', width: '12px', height: '12px', borderRadius: '50%', flexShrink: 0 }}></div>
                            <span style={{ fontSize: '13px', color: '#4A5568' }}>Enrolled</span>
                        </div>
                        <div className={styles.legendValue} style={{ fontWeight: 600 }}>{trainingCoverage?.inProgress}%</div>
                    </div>

                    {/* Item 3 */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div className={styles.legendDot} style={{ background: '#EF4444', width: '12px', height: '12px', borderRadius: '50%', flexShrink: 0 }}></div>
                            <span style={{ fontSize: '13px', color: '#4A5568' }}>Not Started</span>
                        </div>
                        <div className={styles.legendValue} style={{ fontWeight: 600 }}>{trainingCoverage?.notStarted}%</div>
                    </div>
                </div>
            </div>
        </div >
    );
}
