'use client';

import React, { useState, useMemo } from 'react';
import styles from './MyCoursesTable.module.css';
import { Input } from '@/components/ui';
import EmptyTableState from '@/components/ui/EmptyTableState';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Course {
  id: string;
  title: string;
  thumbnail?: string | null;
  level?: string | null;
  enrollmentsCount: number;
  completionRate: number;
  createdAt: Date;
}

interface MyCoursesTableProps {
  courses: Course[];
  maxItems?: number;
}

export default function MyCoursesTable({ courses, maxItems = 5 }: MyCoursesTableProps) {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');

  // Filter Logic
  // ⚡ Bolt: Memoize filtered courses to avoid re-evaluating on every re-render.
  // Useful as the list of courses grows.
  const filteredCourses = useMemo(() => {
    return courses.filter((course) =>
      course.title.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [courses, searchQuery]);

  // Limit to maxItems for dashboard view
  const displayCourses = filteredCourses.slice(0, maxItems);

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <h3 className={styles.title}>My Courses</h3>
        <div className={styles.searchContainer}>
          <Input
            placeholder="Search for courses..."
            className={styles.searchInput}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            leftIcon={
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ color: '#A0AEC0' }}
              >
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
            }
          />
        </div>
      </div>

      {/* Table */}
      <div className={styles.tableWrapper}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th style={{ width: '45%' }}>Course Name</th>
              <th style={{ width: '15%' }}>Assigned Staff</th>
              <th style={{ width: '20%' }}>Completion %</th>
              <th style={{ width: '20%' }}>Date Created</th>
            </tr>
          </thead>
          <tbody>
            {displayCourses.length > 0 ? (
              displayCourses.map((course) => (
                <tr
                  key={course.id}
                  onClick={() => router.push(`/dashboard/training/courses/${course.id}`)}
                  className={styles.clickableRow}
                >
                  <td>
                    <div className={styles.courseInfo}>
                      <div className={styles.courseIcon}>
                        <Image
                          src={course.thumbnail || '/images/icon-course-blue.svg'}
                          alt={course.title}
                          width={40}
                          height={40}
                        />
                      </div>
                      <div className={styles.courseText}>
                        <span className={styles.courseName}>{course.title}</span>
                      </div>
                    </div>
                  </td>
                  <td>{course.enrollmentsCount}</td>
                  <td>
                    <span className={styles.completionRate}>{course.completionRate}%</span>
                  </td>
                  <td>
                    {new Date(course.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>
                </tr>
              ))
            ) : (
              <EmptyTableState
                message="No courses found."
                subMessage="Create a course to get started."
                colSpan={4}
                asTableRow
              />
            )}
          </tbody>
        </table>
      </div>

      {/* View All Button */}
      {
        // Show View All if there are more items than displayed OR if we are just showing the default list
        // User's image shows "View all" at bottom right.
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginTop: '16px',
            paddingRight: '24px',
          }}
        >
          <Link
            href="/dashboard/courses"
            style={{
              color: '#4C6EF5',
              fontSize: '14px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            View all
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
          </Link>
        </div>
      }
    </div>
  );
}
