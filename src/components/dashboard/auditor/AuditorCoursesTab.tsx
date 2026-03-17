'use client';

import Image from 'next/image';
import { useState, useEffect, useTransition } from 'react';
import styles from './auditor-pack.module.css';
import { getAuditorCourses } from '@/app/actions/auditor';
import type { AuditorCourseRow } from '@/app/actions/auditor';

export default function AuditorCoursesTab() {
  const [courses, setCourses] = useState<AuditorCourseRow[]>([]);
  const [search, setSearch] = useState('');
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const timer = setTimeout(() => {
      startTransition(async () => {
        const data = await getAuditorCourses(search || undefined);
        setCourses(data);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const handleExport = () => {
    window.location.href = '/api/auditor/export';
  };

  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>All Courses</h2>
        <div className={styles.sectionControls}>
          <div className={styles.searchWrapper}>
            <span className={styles.searchIcon}>
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
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </span>
            <input
              className={styles.searchInput}
              type="search"
              placeholder="Search courses..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search courses"
            />
          </div>
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

      {isPending && courses.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyDesc}>Loading courses&hellip;</p>
        </div>
      ) : courses.length === 0 ? (
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
          <p className={styles.emptyTitle}>No courses found.</p>
          <p className={styles.emptyDesc}>
            {search
              ? 'No courses match your search.'
              : 'No published courses in your organization yet.'}
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
                          <Image src={course.thumbnail} alt={course.title} width={36} height={36} />
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
  );
}
