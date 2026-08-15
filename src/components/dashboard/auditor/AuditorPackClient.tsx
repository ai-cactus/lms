'use client';

import { useState } from 'react';
import { CheckCircle2, GraduationCap, Info, UserPlus } from 'lucide-react';
import type { AuditorOverviewStats } from '@/app/actions/auditor';
import AuditorCoursesTab from './AuditorCoursesTab';
import AuditorStaffTab from './AuditorStaffTab';
import AuditExportBanner from './AuditExportBanner';
import { auditPageSubtitle, auditPageTitle } from './audit-ui';
import { cn } from '@/lib/utils';

type TabKey = 'courses' | 'staff';

interface AuditorPackClientProps {
  stats: AuditorOverviewStats;
}

const TABS: { key: TabKey; label: string }[] = [
  { key: 'courses', label: 'Courses' },
  { key: 'staff', label: 'Staffs' },
];

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}

function StatCard({ icon, label, value, hint }: StatCardProps) {
  return (
    <div className="relative rounded-[12px] border border-[#e2e8f0] bg-white p-4 sm:p-6">
      <div className="flex size-9 items-center justify-center rounded-[8px] bg-[#f8fafc] text-[#475569] [&_svg]:size-5">
        {icon}
      </div>
      <span className="absolute right-4 top-4 text-[#cbd5e1] sm:right-6 sm:top-6" title={hint}>
        <Info className="size-3" />
        <span className="sr-only">{hint}</span>
      </span>
      <p className="mt-5 text-[14px] font-medium leading-5 text-[#64748b]">{label}</p>
      <p className="mt-1.5 text-[26px] font-bold leading-[1.2] text-[#0f172a] sm:text-[28px]">
        {value}
      </p>
    </div>
  );
}

export default function AuditorPackClient({ stats }: AuditorPackClientProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('courses');

  return (
    <div>
      <AuditExportBanner />

      <div className="flex flex-col gap-[5px]">
        <h1 className={auditPageTitle}>Audit Reports</h1>
        <p className={auditPageSubtitle}>
          Access real-time compliance monitoring and audit reporting.
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
        <StatCard
          icon={<GraduationCap />}
          label="All Courses"
          value={String(stats.totalCourses)}
          hint="Total published courses in your organization"
        />
        <StatCard
          icon={<UserPlus />}
          label="Staff Assigned"
          value={stats.totalStaffAssigned.toLocaleString()}
          hint="Total active staff members in your organization"
        />
        <StatCard
          icon={<CheckCircle2 />}
          label="Completion Rate"
          value={`${stats.completionRate}%`}
          hint="Percentage of completed enrollments across all org courses"
        />
      </div>

      <nav
        className="-mx-1 mt-7 flex items-center gap-6 overflow-x-auto border-b border-[#e2e8f0] px-1 sm:gap-[38px]"
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

      <div className="mt-8">
        {activeTab === 'courses' ? (
          <AuditorCoursesTab totalCourses={stats.totalCourses} />
        ) : (
          <AuditorStaffTab totalStaff={stats.totalStaffAssigned} />
        )}
      </div>
    </div>
  );
}
