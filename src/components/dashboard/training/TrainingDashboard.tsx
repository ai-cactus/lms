'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import Image from 'next/image';
import { CourseWithStats } from '@/types/course';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import EmptyTableState from '@/components/ui/EmptyTableState';
import { Plus, Search, BookOpen, Users, Activity, ChevronRight } from 'lucide-react';

export interface DashboardStats {
  totalCourses: number;
  totalStaffAssigned: number;
  averageGrade: number;
  monthlyPerformance: { month: string; value: number }[];
  coursePerformance?: {
    name: string;
    score: number;
    passingScore: number;
    passCount: number;
    failCount: number;
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

// Interactive Donut Chart with hover tooltips
function DonutChartWithTooltip({ coverage }: { coverage: DashboardStats['trainingCoverage'] }) {
  const [activeSegment, setActiveSegment] = useState<string | null>(null);

  // Safe parse helper
  const parseVal = (v: number | string | undefined | null) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') return parseFloat(v.replace('%', '')) || 0;
    return 0;
  };

  const segments = [
    {
      id: 'completed',
      label: 'Staff who have completed required courses',
      value: parseVal(coverage.completed),
      color: '#14B8A6',
      hoverColor: '#2DD4BF',
      position: 'right' as const,
    },
    {
      id: 'enrolled',
      label: 'Staff currently enrolled (in progress)',
      value: parseVal(coverage.inProgress),
      color: '#F59E0B',
      hoverColor: '#FBBF24',
      position: 'bottom' as const,
    },
    {
      id: 'notStarted',
      label: 'Staff yet to begin any course',
      value: parseVal(coverage.notStarted),
      color: '#EF4444',
      hoverColor: '#F87171',
      position: 'left' as const,
    },
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

  const paths = segments.map((segment) => {
    // Handle 360 degree case for SVG Arc
    const angle = (segment.value / 100) * 360;
    const endAngle = startAngle + angle;

    let path = '';

    if (angle >= 360) {
      // For a full circle, we need to use two 180-degree arcs because
      // a single arc command with same start/end points won't render.
      const startRad = (startAngle - 90) * (Math.PI / 180);
      const midRad = (startAngle + 180 - 90) * (Math.PI / 180);

      // Outer points
      const x1 = center + radius * Math.cos(startRad);
      const y1 = center + radius * Math.sin(startRad);
      const xm = center + radius * Math.cos(midRad);
      const ym = center + radius * Math.sin(midRad);

      // Inner points
      const x3 = center + innerRadius * Math.cos(startRad);
      const y3 = center + innerRadius * Math.sin(startRad);
      const xim = center + innerRadius * Math.cos(midRad);
      const yim = center + innerRadius * Math.sin(midRad);

      // Path: outer circle, then jump to inner circle and draw it in reverse
      path = `
        M ${x1} ${y1}
        A ${radius} ${radius} 0 0 1 ${xm} ${ym}
        A ${radius} ${radius} 0 0 1 ${x1} ${y1}
        M ${x3} ${y3}
        A ${innerRadius} ${innerRadius} 0 0 0 ${xim} ${yim}
        A ${innerRadius} ${innerRadius} 0 0 0 ${x3} ${y3}
        Z
      `;
    } else {
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
      path = `
        M ${x1} ${y1}
        A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}
        L ${x3} ${y3}
        A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x4} ${y4}
        Z
      `;
    }

    startAngle = endAngle;

    return { ...segment, path };
  });

  const handleSegmentInteraction = (segmentId: string) => {
    setActiveSegment((prev) => (prev === segmentId ? null : segmentId));
  };

  const activeData = segments.find((s) => s.id === activeSegment);

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
        className="cursor-pointer block"
        onMouseLeave={() => setActiveSegment(null)}
      >
        {/* Donut Logic */}
        {hasData &&
          paths.map((segment) => (
            <path
              key={segment.id}
              d={segment.path}
              fill={activeSegment === segment.id ? segment.hoverColor : segment.color}
              onMouseEnter={() => setActiveSegment(segment.id)}
              onClick={() => handleSegmentInteraction(segment.id)}
              onTouchStart={() => handleSegmentInteraction(segment.id)}
              style={{
                transition: 'all 0.2s ease',
                filter:
                  activeSegment === segment.id
                    ? 'brightness(1.2) drop-shadow(0 2px 4px rgba(0,0,0,0.3))'
                    : 'brightness(1)',
                transformOrigin: 'center center',
              }}
              opacity={activeSegment && activeSegment !== segment.id ? 0.4 : 1}
            />
          ))}

        {/* Central Text */}
        <text
          x="50%"
          y="45%"
          textAnchor="middle"
          dy=".3em"
          fontSize="12"
          fill="#6B7280"
          fontWeight="500"
        >
          Total Staff
        </text>
        <text
          x="50%"
          y="55%"
          textAnchor="middle"
          dy=".3em"
          fontSize="24"
          fill="#1F2937"
          fontWeight="bold"
        >
          {coverage.totalStaff || 0}
        </text>
      </svg>

      {/* Smart positioned tooltip */}
      {activeData && (
        <div
          style={{
            position: 'absolute',
            ...getTooltipPosition(activeData.position),
            width: '180px',
            zIndex: 100,
          }}
        >
          <div className="bg-white border border-[#E2E8F0] p-3 rounded-lg shadow-[0_4px_12px_rgba(0,0,0,0.15)] text-[13px]">
            <div
              style={{
                background: activeData.color,
              }}
              className="text-white px-2.5 py-1 rounded inline-block font-semibold mb-2"
            >
              {activeData.value}%
            </div>
            <div className="text-[#4A5568] leading-normal">{activeData.label}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// Main Dashboard Component
export default function TrainingDashboard({
  onCreateCourse,
  stats,
  courses,
}: TrainingDashboardProps) {
  const router = useRouter();
  // Use real data from props
  const coverage = stats.trainingCoverage;
  const [mounted, setMounted] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydration guard
    setMounted(true);
  }, []);

  // Process data for the chart
  const chartData = React.useMemo(() => {
    return [...(stats.coursePerformance || [])];
  }, [stats.coursePerformance]);

  // Calculate max value for Y-axis scaling
  const maxVal = Math.max(...chartData.map((d) => Math.max(d.passCount, d.failCount)), 5); // Minimum 5 for scale

  // Generate ticks (0, 20%, 40%... or just counts?)
  // User's snippet used percentages. But here we have counts.
  // I will use counts: 0 to maxVal.
  // Let's make 5 ticks.
  const ticks = Array.from({ length: 6 }, (_, i) => Math.round((maxVal / 5) * i)).reverse();

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 xl:gap-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 max-sm:flex-col">
        <div>
          <h1 className="text-2xl font-bold text-[#1a202c]">Training Dashboard</h1>
          <p className="text-base text-[#718096]">Here is an overview of your courses</p>
        </div>
        <Button onClick={onCreateCourse}>
          <Plus className="size-5" />
          Create Course
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
        {/* Total Courses - Blue */}
        <div className="flex min-h-[160px] flex-col justify-between rounded-2xl p-6 shadow-sm bg-[#EEF2FF]">
          <div>
            <div className="mb-6 flex size-12 items-center justify-center rounded-xl text-white bg-[#4730F7]">
              <BookOpen className="size-6" />
            </div>
            <p className="mb-1 text-sm font-semibold text-[#4a5568]">Total Courses</p>
          </div>
          <p className="text-[28px] font-bold text-[#1a202c] xl:text-4xl">{stats.totalCourses}</p>
        </div>

        {/* Total Staff Assigned - Green */}
        <div className="flex min-h-[160px] flex-col justify-between rounded-2xl p-6 shadow-sm bg-[#ECFDF5]">
          <div>
            <div className="mb-6 flex size-12 items-center justify-center rounded-xl text-white bg-[#10B981]">
              <Users className="size-6" />
            </div>
            <p className="mb-1 text-sm font-semibold text-[#4a5568]">Total Staff Assigned</p>
          </div>
          <p className="text-[28px] font-bold text-[#1a202c] xl:text-4xl">
            {stats.totalStaffAssigned}
          </p>
        </div>

        {/* Average Grade - Red */}
        <div className="flex min-h-[160px] flex-col justify-between rounded-2xl p-6 shadow-sm bg-[#FEF2F2]">
          <div>
            <div className="mb-6 flex size-12 items-center justify-center rounded-xl text-white bg-[#EF4444]">
              <Activity className="size-6" />
            </div>
            <p className="mb-1 text-sm font-semibold text-[#4a5568]">Average Grade</p>
          </div>
          <p className="text-[28px] font-bold text-[#1a202c] xl:text-4xl">{stats.averageGrade}%</p>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        {/* Performance Chart */}
        <div className="flex min-h-[400px] flex-col rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-[#1a202c]">Performance of Learners</h3>
          </div>

          {/* Legend */}
          <div className="flex gap-6 mb-6 pb-4 border-b border-[#EDF2F7] mt-4">
            <div className="flex items-center gap-2">
              <div
                style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '4px',
                  background: 'linear-gradient(180deg, #34D399 0%, #10B981 100%)',
                }}
              />
              <span className="text-[13px] font-medium text-slate-500">Passed</span>
            </div>
            <div className="flex items-center gap-2">
              <div
                style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '4px',
                  background: 'linear-gradient(180deg, #F87171 0%, #EF4444 100%)',
                }}
              />
              <span className="text-[13px] font-medium text-slate-500">Failed</span>
            </div>
          </div>

          <div style={{ height: 320, position: 'relative', marginTop: 10 }}>
            {/* Y-Axis */}
            <div
              style={{
                position: 'absolute',
                left: '0',
                top: '0',
                bottom: '60px',
                width: '40px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                paddingTop: '5px',
              }}
            >
              {ticks.map((tick, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: '11px',
                    color: '#A0AEC0',
                    fontWeight: '500',
                    textAlign: 'right',
                  }}
                >
                  {tick}
                </div>
              ))}
            </div>

            {/* Grid Lines */}
            <div
              style={{
                position: 'absolute',
                left: '50px',
                right: '0',
                top: '12px',
                bottom: '60px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                zIndex: 0,
              }}
            >
              {ticks.map((_, i) => (
                <div
                  key={i}
                  style={{
                    height: '1px',
                    background: '#EDF2F7',
                    width: '100%',
                  }}
                />
              ))}
            </div>

            {/* Bars Container */}
            <div
              style={{
                position: 'absolute',
                left: '50px',
                right: '0',
                bottom: '60px',
                top: '12px',
                display: 'flex',
                gap: '12px',
                alignItems: 'flex-end',
                zIndex: 1,
              }}
            >
              {chartData.map((item, idx) => {
                // Calculate heights relative to maxVal
                const passHeight = maxVal > 0 ? (item.passCount / maxVal) * 100 : 0;
                const failHeight = maxVal > 0 ? (item.failCount / maxVal) * 100 : 0;

                return (
                  <div
                    key={idx}
                    style={{
                      flex: '1',
                      display: 'flex',
                      gap: '4px', // Gap between pass and fail bars
                      alignItems: 'flex-end',
                      justifyContent: 'center',
                      height: '100%',
                      cursor: 'pointer',
                      transform: hoveredIndex === idx ? 'translateY(-4px)' : 'translateY(0)',
                      transition: 'transform 0.2s ease',
                    }}
                    onMouseEnter={() => setHoveredIndex(idx)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  >
                    {/* Pass Bar */}
                    <div
                      style={{
                        flex: '1',
                        maxWidth: '20px',
                        height: mounted ? `${passHeight}%` : '0%',
                        background: 'linear-gradient(180deg, #34D399 0%, #10B981 100%)',
                        borderRadius: '4px 4px 0 0',
                        transition:
                          'height 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease',
                        transitionDelay: `${idx * 0.05}s`,
                        boxShadow:
                          hoveredIndex === idx ? '0 4px 12px rgba(16, 185, 129, 0.3)' : 'none',
                        position: 'relative',
                      }}
                    >
                      {/* Tooltip on Hover */}
                      <div
                        style={{
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
                          zIndex: 10,
                        }}
                      >
                        {item.passCount}
                      </div>
                    </div>

                    {/* Fail Bar */}
                    <div
                      style={{
                        flex: '1',
                        maxWidth: '20px',
                        height: mounted ? `${failHeight}%` : '0%',
                        background: 'linear-gradient(180deg, #F87171 0%, #EF4444 100%)',
                        borderRadius: '4px 4px 0 0',
                        transition:
                          'height 0.8s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease',
                        transitionDelay: `${idx * 0.05 + 0.1}s`,
                        boxShadow:
                          hoveredIndex === idx ? '0 4px 12px rgba(239, 68, 68, 0.3)' : 'none',
                        position: 'relative',
                      }}
                    >
                      {/* Tooltip on Hover */}
                      <div
                        style={{
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
                          zIndex: 10,
                        }}
                      >
                        {item.failCount}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* X-Axis Labels */}
            <div
              style={{
                position: 'absolute',
                left: '50px',
                right: '0',
                bottom: '0',
                height: '60px',
                display: 'flex',
                gap: '12px',
              }}
            >
              {chartData.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    flex: '1',
                    fontSize: '10px',
                    color: hoveredIndex === idx ? '#2D3748' : '#A0AEC0',
                    fontWeight: hoveredIndex === idx ? '600' : '500',
                    textAlign: 'center',
                    // Rotate and position carefully
                    transform: 'rotate(-45deg)',
                    transformOrigin: 'top center',
                    paddingTop: '8px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    transition: 'color 0.2s ease, font-weight 0.2s ease',
                  }}
                  title={item.name}
                >
                  {item.name.length > 15 ? item.name.substring(0, 15) + '...' : item.name}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Donut Coverage Chart */}
        <div className="flex min-h-[400px] flex-col rounded-2xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-[#1a202c] mb-6">Training Coverage</h3>

          <div className="flex flex-col items-center gap-6 py-5">
            <DonutChartWithTooltip coverage={coverage} />

            <div className="grid grid-cols-[auto_1fr_auto] gap-y-3 gap-x-4 items-center w-full">
              {/* Item 1 */}
              <div className="size-3 rounded-full" style={{ background: '#14B8A6' }}></div>
              <div className="text-sm text-[#4A5568]">% of staff who have completed</div>
              <span className="font-semibold text-[#1a202c]">{coverage.completed}%</span>

              {/* Item 2 */}
              <div className="size-3 rounded-full" style={{ background: '#F59E0B' }}></div>
              <div className="text-sm text-[#4A5568]">% of staff currently enrolled</div>
              <span className="font-semibold text-[#1a202c]">{coverage.inProgress}%</span>

              {/* Item 3 */}
              <div className="size-3 rounded-full" style={{ background: '#EF4444' }}></div>
              <div className="text-sm text-[#4A5568]">% of staff yet to begin any course</div>
              <span className="font-semibold text-[#1a202c]">{coverage.notStarted}%</span>
            </div>
          </div>
        </div>
      </div>

      {/* My Courses Widget */}
      <div className="rounded-xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <h3 className="text-lg font-bold text-[#1a202c]">My Courses</h3>
          <div className="w-full sm:w-80">
            <Input
              placeholder="Search for courses..."
              className="h-11"
              startIcon={<Search aria-hidden="true" />}
            />
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-0">
              <TableHead className="w-full md:w-[40%]">Course Name</TableHead>
              <TableHead className="hidden md:table-cell">Assigned Staff</TableHead>
              <TableHead className="hidden md:table-cell">Completion %</TableHead>
              <TableHead className="hidden md:table-cell">Date Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {courses.length === 0 ? (
              <EmptyTableState
                message="No courses found."
                subMessage="Create your first course above."
                colSpan={4}
                asTableRow
              />
            ) : (
              courses.map((course) => (
                <TableRow
                  key={course.id}
                  onClick={() => router.push(`/dashboard/training/courses/${course.id}`)}
                  className="cursor-pointer"
                >
                  <TableCell>
                    <div className="flex items-center gap-4">
                      <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#f1f5f9]">
                        <Image
                          src={course.thumbnail || '/images/icon-course-blue.svg'}
                          alt={course.title}
                          width={40}
                          height={40}
                          className="object-cover"
                        />
                      </div>
                      <div>
                        <span className="font-semibold text-[#0f172a]">{course.title}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{course.enrollmentsCount}</TableCell>
                  <TableCell className="hidden md:table-cell">{course.completionRate}%</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {new Date(course.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <div className="mt-4 flex justify-end">
          <Link
            href="/dashboard/courses"
            className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
          >
            View all
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  );
}
