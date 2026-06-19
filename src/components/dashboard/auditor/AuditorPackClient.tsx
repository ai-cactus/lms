'use client';

import type { AuditorOverviewStats, AuditorCourseRow } from '@/app/actions/auditor';
import AuditorOverviewTab from './AuditorOverviewTab';
import AuditorCoursesTab from './AuditorCoursesTab';
import AuditorStaffTab from './AuditorStaffTab';
import AuditorExportTab from './AuditorExportTab';
import { useState } from 'react';
import { cn } from '@/lib/utils';

type TabKey = 'overview' | 'courses' | 'staff' | 'export';

interface AuditorPackClientProps {
  initialStats: AuditorOverviewStats;
  initialCourses: AuditorCourseRow[];
}

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'courses', label: 'Courses' },
  { key: 'staff', label: 'Staff' },
  { key: 'export', label: 'Export' },
];

export default function AuditorPackClient({
  initialStats,
  initialCourses,
}: AuditorPackClientProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  return (
    <div>
      {/* Tab Navigation */}
      <nav className="mb-7 flex gap-0 border-b-2 border-border" aria-label="Audit Reports tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={cn(
              '-mb-0.5 cursor-pointer border-b-2 px-5 py-3 text-sm transition-colors',
              activeTab === tab.key
                ? 'border-primary font-semibold text-primary'
                : 'border-transparent font-medium text-text-secondary hover:text-foreground',
            )}
            onClick={() => setActiveTab(tab.key)}
            aria-current={activeTab === tab.key ? 'page' : undefined}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Tab Panels */}
      {activeTab === 'overview' && (
        <AuditorOverviewTab stats={initialStats} courses={initialCourses} />
      )}
      {activeTab === 'courses' && <AuditorCoursesTab />}
      {activeTab === 'staff' && <AuditorStaffTab />}
      {activeTab === 'export' && <AuditorExportTab />}
    </div>
  );
}
