'use client';

import React, { useState, useMemo } from 'react';
import styles from './MyCoursesTable.module.css';
import { Input } from '@/components/ui';
import EmptyTableState from '@/components/ui/EmptyTableState';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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

  const filteredCourses = useMemo(() => {
    return courses.filter((course) =>
      course.title.toLowerCase().includes(searchQuery.toLowerCase()),
    );
  }, [courses, searchQuery]);

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
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-0">
              <TableHead style={{ width: '45%' }}>Course Name</TableHead>
              <TableHead style={{ width: '15%' }}>Assigned Staff</TableHead>
              <TableHead style={{ width: '20%' }}>Completion %</TableHead>
              <TableHead style={{ width: '20%' }}>Date Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayCourses.length > 0 ? (
              displayCourses.map((course) => (
                <TableRow
                  key={course.id}
                  onClick={() => router.push(`/dashboard/training/courses/${course.id}`)}
                  className={`cursor-pointer ${styles.clickableRow}`}
                >
                  <TableCell>
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
                  </TableCell>
                  <TableCell>{course.enrollmentsCount}</TableCell>
                  <TableCell>
                    <span className={styles.completionRate}>{course.completionRate}%</span>
                  </TableCell>
                  <TableCell>
                    {new Date(course.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <EmptyTableState
                message="No courses found."
                subMessage="Create a course to get started."
                colSpan={4}
                asTableRow
              />
            )}
          </TableBody>
        </Table>
      </div>

      {/* View All Link */}
      <div className="flex justify-end mt-4 pr-6">
        <Link
          href="/dashboard/courses"
          className="text-[#4C6EF5] text-sm font-semibold flex items-center gap-1"
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
    </div>
  );
}
