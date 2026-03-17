'use client';

import Image from 'next/image';
import styles from './auditor-pack.module.css';
import type { AuditorOverviewStats, AuditorCourseRow } from '@/app/actions/auditor';

interface Props {
  stats: AuditorOverviewStats;
  courses: AuditorCourseRow[];
}

export default function AuditorOverviewTab({ stats, courses }: Props) {
  const handleExport = () => {
    window.location.href = '/api/auditor/export';
  };

  return (
    <div>
      {/* Stat Cards */}
      <div className={styles.statsGrid}>
        {/* All Courses */}
        <div className={styles.statCard}>
          <div className={styles.statCardIcon}>
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
              <path d="M6 12v5c3 3 9 3 12 0v-5" />
            </svg>
          </div>
          <span
            className={styles.statCardInfo}
            title="Total published courses in your organization"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </span>
          <p className={styles.statLabel}>All Courses</p>
          <p className={styles.statValue}>{stats.totalCourses}</p>
        </div>

        {/* Staff Assigned */}
        <div className={styles.statCard}>
          <div className={styles.statCardIcon}>
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="8.5" cy="7" r="4" />
              <line x1="20" y1="8" x2="20" y2="14" />
              <line x1="23" y1="11" x2="17" y2="11" />
            </svg>
          </div>
          <span
            className={styles.statCardInfo}
            title="Total active staff members in your organization"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </span>
          <p className={styles.statLabel}>Staff Assigned</p>
          <p className={styles.statValue}>{stats.totalStaffAssigned.toLocaleString()}</p>
        </div>

        {/* Completion Rate */}
        <div className={styles.statCard}>
          <div className={styles.statCardIcon}>
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <span
            className={styles.statCardInfo}
            title="Percentage of completed enrollments across all org courses"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </span>
          <p className={styles.statLabel}>Completion Rate</p>
          <p className={styles.statValue}>{stats.completionRate}%</p>
        </div>
      </div>

      {/* Recent Assigned Courses Table */}
      <div className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Recent Assigned Courses</h2>
          <div className={styles.sectionControls}>
            <button className={styles.exportBtn} onClick={handleExport} title="Download CSV export">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export
            </button>
          </div>
        </div>

        {courses.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIllustration}>
              <svg width="40" height="40" viewBox="0 0 48 48" fill="none">
                <rect x="8" y="14" width="24" height="5" rx="2.5" fill="#C7D2FE" />
                <rect x="8" y="25" width="18" height="5" rx="2.5" fill="#C7D2FE" />
                <circle cx="38" cy="30" r="7" stroke="#4731F7" strokeWidth="2" fill="none" />
                <line
                  x1="43.5"
                  y1="35.5"
                  x2="47"
                  y2="39"
                  stroke="#4731F7"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <p className={styles.emptyTitle}>No course yet.</p>
            <p className={styles.emptyDesc}>
              Courses will appear here once staff finish assigned courses.
            </p>
          </div>
        ) : (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Course Name</th>
                  <th>Assigned Staff</th>
                  <th>Completion Rate</th>
                  <th>Assigned Date</th>
                </tr>
              </thead>
              <tbody>
                {courses.map((course) => (
                  <tr key={course.id}>
                    <td>
                      <div className={styles.courseCell}>
                        <div className={styles.courseThumb}>
                          {course.thumbnail ? (
                            <Image
                              src={course.thumbnail}
                              alt={course.title}
                              width={36}
                              height={36}
                            />
                          ) : (
                            <svg
                              width="18"
                              height="18"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="#94A3B8"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
                            </svg>
                          )}
                        </div>
                        <span className={styles.courseName}>{course.title}</span>
                      </div>
                    </td>
                    <td>{course.assignedStaff}</td>
                    <td className={styles.completionRate}>{course.completionRate}%</td>
                    <td className={styles.dateText}>
                      {course.assignedDate.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
