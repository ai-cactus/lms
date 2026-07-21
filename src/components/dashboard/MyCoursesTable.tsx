'use client';

import { useState, useMemo } from 'react';
import { Search, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import EmptyTableState from '@/components/ui/EmptyTableState';
import CourseTypeIcon from '@/components/dashboard/courses/CourseTypeIcon';
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
  type?: string; // 'video' | 'text'
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
    <div className="flex min-w-0 max-w-full flex-1 flex-col rounded-xl border border-[#e2e8f0] bg-white p-6 shadow-sm">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h3 className="text-lg font-bold text-[#1a202c]">My Courses</h3>
        <div className="w-full sm:w-80">
          <Input
            placeholder="Search for courses..."
            className="h-11"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            startIcon={<Search aria-hidden="true" />}
          />
        </div>
      </div>

      {/* Table — secondary columns collapse on mobile, leaving the course name + level */}
      <Table>
        <TableHeader>
          <TableRow className="border-0 hover:bg-transparent">
            <TableHead className="w-full md:w-[34%]">Course Name</TableHead>
            <TableHead className="hidden md:table-cell">Type</TableHead>
            <TableHead className="hidden md:table-cell">Assigned Staff</TableHead>
            <TableHead className="hidden md:table-cell">Completion Rate</TableHead>
            <TableHead className="hidden md:table-cell">Date Created</TableHead>
            <TableHead className="hidden text-right md:table-cell">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {displayCourses.length > 0 ? (
            displayCourses.map((course) => (
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
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-semibold text-[#0f172a]">{course.title}</span>
                      {course.level && (
                        <span className="text-xs font-normal text-text-secondary md:hidden">
                          {course.level}
                        </span>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <CourseTypeIcon type={course.type} />
                </TableCell>
                <TableCell className="hidden md:table-cell">{course.enrollmentsCount}</TableCell>
                <TableCell className="hidden md:table-cell">
                  <span className="font-semibold text-[#0f172a]">{course.completionRate}%</span>
                </TableCell>
                <TableCell className="hidden whitespace-nowrap text-[#718096] md:table-cell">
                  {new Date(course.createdAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: '2-digit',
                    year: 'numeric',
                  })}
                </TableCell>
                <TableCell
                  className="hidden text-right md:table-cell"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Link
                    href={`/dashboard/training/courses/${course.id}`}
                    className="text-sm font-semibold text-primary hover:underline"
                  >
                    View Course
                  </Link>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <EmptyTableState
              message="No courses found."
              subMessage="Create a course to get started."
              colSpan={6}
              asTableRow
            />
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
  );
}
