'use client';

import type { AuditorOverviewStats, AuditorCourseRow } from '@/app/actions/auditor';
import AuditorOverviewTab from './AuditorOverviewTab';
import AuditorCoursesTab from './AuditorCoursesTab';
import AuditorStaffTab from './AuditorStaffTab';
import AuditorExportTab from './AuditorExportTab';
import AuditDateRangeFilter from './AuditDateRangeFilter';
import { AuditFilterProvider, useAuditFilter } from './AuditFilterProvider';
import { useState } from 'react';
import { cn } from '@/lib/utils';

type TabKey = 'overview' | 'courses' | 'staff' | 'export';

interface AuditorPackClientProps {
  initialStats: AuditorOverviewStats;
  initialCourses: AuditorCourseRow[];
}

const TABS: { key: TabKey; label: string; title: string; description: string }[] = [
  {
    key: 'overview',
    label: 'Overview',
    title: 'Overview',
    description: 'Real-time compliance monitoring and audit reporting.',
  },
  {
    key: 'courses',
    label: 'Courses',
    title: 'Courses',
    description:
      'Review evidence for each course, including documents used, course content, quiz rules, and staff performance.',
  },
  {
    key: 'staff',
    label: 'Staff',
    title: 'Staff',
    description:
      'View training transcripts per worker, including course results, attempts, and retakes.',
  },
  {
    key: 'export',
    label: 'Export',
    title: 'Exports',
    description: 'Generate scannable audit reports and keep a history of exports for verification.',
  },
];

export default function AuditorPackClient({
  initialStats,
  initialCourses,
}: AuditorPackClientProps) {
  return (
    <AuditFilterProvider>
      <AuditorPackTabs initialStats={initialStats} initialCourses={initialCourses} />
    </AuditFilterProvider>
  );
}

function AuditorPackTabs({ initialStats, initialCourses }: AuditorPackClientProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const { range, setRange } = useAuditFilter();

  const active = TABS.find((tab) => tab.key === activeTab) ?? TABS[0];

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <nav
          className="-mx-1 flex items-center gap-6 overflow-x-auto px-1 sm:gap-[38px]"
          aria-label="Audit Reports tabs"
        >
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={cn(
                'cursor-pointer whitespace-nowrap border-b-2 pb-2.5 text-[15px] font-medium transition-colors',
                activeTab === tab.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-[#4a5568] hover:text-foreground',
              )}
              onClick={() => setActiveTab(tab.key)}
              aria-current={activeTab === tab.key ? 'page' : undefined}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <AuditDateRangeFilter value={range} onChange={setRange} className="shrink-0" />
      </div>

      <div className="flex flex-col gap-10">
        <div className="flex flex-col gap-[5px]">
          <h1 className="text-[28px] font-semibold leading-[1.31] tracking-[-0.04em] text-[#272b30] sm:text-[33.5px]">
            {active.title}
          </h1>
          <p className="text-[14px] font-medium leading-[1.4] text-[#a0aec0]">
            {active.description}
          </p>
        </div>

        {activeTab === 'overview' && (
          <AuditorOverviewTab stats={initialStats} courses={initialCourses} />
        )}
        {activeTab === 'courses' && <AuditorCoursesTab />}
        {activeTab === 'staff' && <AuditorStaffTab />}
        {activeTab === 'export' && <AuditorExportTab />}
      </div>
    </div>
  );
}
