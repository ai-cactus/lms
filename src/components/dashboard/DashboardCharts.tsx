'use client';

import React, { useState, useEffect } from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Label } from 'recharts';

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

const PASS_COLOR = '#16a34a';
const FAIL_COLOR = '#ec484b';

const COVERAGE_SEGMENTS = [
  { key: 'completed', label: 'Staff who have completed required courses', color: '#14b8a6' },
  { key: 'inProgress', label: 'Staff currently enrolled (in progress)', color: '#facc15' },
  { key: 'notStarted', label: 'Staff yet to begin any course', color: '#ec484b' },
] as const;

export default function DashboardCharts({ stats }: DashboardChartsProps) {
  const [mounted, setMounted] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydration guard
    setMounted(true);
  }, []);

  if (!stats) return null;

  const { coursePerformance = [], trainingCoverage } = stats;

  const parseChartValue = (val: string | number | undefined | null) => {
    if (val === undefined || val === null) return 0;
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      return parseFloat(val.replace('%', '')) || 0;
    }
    return 0;
  };

  const donutData = COVERAGE_SEGMENTS.map((segment) => ({
    name: segment.label,
    value: parseChartValue(trainingCoverage?.[segment.key]),
    color: segment.color,
  }));

  const activeDonutData = donutData.filter((d) => d.value > 0);
  const hasData = activeDonutData.length > 0;

  const chartData = coursePerformance.map((cp) => ({
    name: cp.name,
    passCount: cp.passCount,
    failCount: cp.failCount,
  }));
  const maxVal = Math.max(...chartData.map((d) => Math.max(d.passCount || 0, d.failCount || 0)), 5);
  const ticks = Array.from({ length: 6 }, (_, i) => Math.round((maxVal / 5) * i)).reverse();

  return (
    <div className="grid grid-cols-1 gap-[30px] lg:grid-cols-[minmax(0,1fr)_357px]">
      <div className="flex min-w-0 flex-col rounded-[17px] border border-[#dfe1e6] bg-white p-[10px] shadow-[0px_1px_2px_0px_rgba(228,229,231,0.24)]">
        <div className="flex flex-1 flex-col gap-7 rounded-[16px] bg-white p-4 md:p-[25px]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold leading-[1.5] tracking-[0.4px] text-[#0d0d12] md:text-xl">
              Performance of Learners
            </h3>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-2">
                <span
                  className="size-3 shrink-0 rounded-[4px]"
                  style={{ background: PASS_COLOR }}
                />
                <span className="text-[13px] font-medium text-[#667185]">Passed</span>
              </span>
              <span className="flex items-center gap-2">
                <span
                  className="size-3 shrink-0 rounded-[4px]"
                  style={{ background: FAIL_COLOR }}
                />
                <span className="text-[13px] font-medium text-[#667185]">Failed</span>
              </span>
            </div>
          </div>

          <div className="relative h-[300px]">
            <div className="absolute bottom-[66px] left-0 top-0 flex w-[38px] flex-col justify-between pt-[5px]">
              {ticks.map((tick, i) => (
                <div key={i} className="text-right text-[9.6px] leading-[1.45] text-[#475367]">
                  {tick}
                </div>
              ))}
            </div>

            <div className="absolute bottom-[66px] left-[46px] right-0 top-[12px] flex flex-col justify-between">
              {ticks.map((_, i) => (
                <div key={i} className="h-px w-full bg-[#e4e7ec]" />
              ))}
            </div>

            <div className="absolute bottom-[66px] left-[46px] right-0 top-[12px] z-[1] flex items-end">
              {chartData.map((item, idx) => {
                const passHeight = maxVal > 0 ? ((item.passCount || 0) / maxVal) * 100 : 0;
                const failHeight = maxVal > 0 ? ((item.failCount || 0) / maxVal) * 100 : 0;

                return (
                  <div
                    key={idx}
                    className="flex h-full flex-1 cursor-pointer items-end justify-center px-[6px]"
                    onMouseEnter={() => setHoveredIndex(idx)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  >
                    <div
                      className="relative w-full max-w-[20px] flex-1 transition-[height] duration-700 ease-out"
                      style={{
                        height: mounted ? `${failHeight}%` : '0%',
                        background: FAIL_COLOR,
                        transitionDelay: `${idx * 0.05}s`,
                      }}
                    >
                      <span
                        className="pointer-events-none absolute bottom-full left-1/2 z-10 -translate-x-1/2 -translate-y-1.5 whitespace-nowrap rounded bg-white px-1.5 py-0.5 text-[10px] font-bold text-[#1a1a1a] shadow-[0_2px_8px_rgba(0,0,0,0.1)] transition-opacity"
                        style={{ opacity: hoveredIndex === idx ? 1 : 0 }}
                      >
                        {item.failCount || 0} failed
                      </span>
                    </div>
                    <div
                      className="relative w-full max-w-[20px] flex-1 transition-[height] duration-700 ease-out"
                      style={{
                        height: mounted ? `${passHeight}%` : '0%',
                        background: PASS_COLOR,
                        transitionDelay: `${idx * 0.05 + 0.1}s`,
                      }}
                    >
                      <span
                        className="pointer-events-none absolute bottom-full left-1/2 z-10 -translate-x-1/2 -translate-y-1.5 whitespace-nowrap rounded bg-white px-1.5 py-0.5 text-[10px] font-bold text-[#1a1a1a] shadow-[0_2px_8px_rgba(0,0,0,0.1)] transition-opacity"
                        style={{ opacity: hoveredIndex === idx ? 1 : 0 }}
                      >
                        {item.passCount || 0} passed
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="absolute bottom-0 left-[46px] right-0 flex h-[66px]">
              {chartData.map((item, idx) => (
                <div key={idx} className="relative min-w-0 flex-1" title={item.name}>
                  <span
                    className="absolute left-1/2 top-[26px] block w-[60px] -translate-x-1/2 -translate-y-1/2 -rotate-60 truncate text-center text-[9.6px] font-medium leading-[1.45] text-[#667185] transition-colors"
                    style={{ color: hoveredIndex === idx ? '#2d3748' : undefined }}
                  >
                    {item.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-col rounded-[17px] border border-[#dfe1e6] bg-white shadow-[0px_1px_2px_0px_rgba(228,229,231,0.24)] lg:rounded-[12px] lg:border-0 lg:shadow-none">
        <div className="flex items-center px-4 pb-4 pt-4 md:px-6 md:pt-6">
          <h3 className="text-base font-semibold leading-[1.5] tracking-[0.38px] text-[#0d0d12] md:text-[19px]">
            Training Coverage
          </h3>
        </div>

        <div className="flex flex-col gap-[33px]">
          <div className="flex items-center justify-center px-7 py-3">
            <div className="relative size-[209px]">
              {/* Only render once mounted so ResponsiveContainer measures a real,
                  laid-out box — avoids the Recharts width(-1)/height(-1) warning that
                  fires when it measures during SSR / the first hydration paint. */}
              {mounted && (
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                  <PieChart>
                    <Pie
                      data={hasData ? activeDonutData : [{ name: 'Empty', value: 1 }]}
                      cx="50%"
                      cy="50%"
                      innerRadius="71%"
                      outerRadius="100%"
                      paddingAngle={0}
                      dataKey="value"
                    >
                      {activeDonutData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />
                      ))}
                      {!hasData && <Cell key="cell-empty" fill="#f1f5f9" stroke="none" />}

                      <Label
                        value="Total Staff"
                        position="center"
                        dy={-12}
                        style={{ fontSize: '13px', fill: '#737373', fontWeight: 500 }}
                      />
                      <Label
                        value={trainingCoverage?.totalStaff || 0}
                        position="center"
                        dy={10}
                        style={{ fontSize: '22px', fontWeight: 700, fill: '#0a0a0a' }}
                      />
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="flex flex-col px-4 pb-4 md:px-6 md:pb-6">
            <div className="h-px w-full bg-[#e4e7ec]" />
            {donutData.map((segment) => (
              <div key={segment.name} className="flex items-center gap-3 px-2 py-1.5">
                <span
                  className="size-3 shrink-0 rounded-full"
                  style={{ background: segment.color }}
                />
                <span className="min-w-0 flex-1 text-sm leading-5 text-[#404040]">
                  {segment.name}
                </span>
                <span className="w-[34px] text-right text-sm font-medium leading-5 text-[#0a0a0a]">
                  {segment.value}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
