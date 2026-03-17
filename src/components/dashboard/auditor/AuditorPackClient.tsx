'use client';

import styles from './auditor-pack.module.css';
import type { AuditorOverviewStats, AuditorCourseRow } from '@/app/actions/auditor';
import AuditorOverviewTab from './AuditorOverviewTab';
import AuditorCoursesTab from './AuditorCoursesTab';
import AuditorStaffTab from './AuditorStaffTab';
import AuditorExportTab from './AuditorExportTab';
import { useState } from 'react';

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
      <nav className={styles.tabNav} aria-label="Auditor Pack tabs">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`${styles.tabBtn} ${activeTab === tab.key ? styles.tabBtnActive : ''}`}
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
