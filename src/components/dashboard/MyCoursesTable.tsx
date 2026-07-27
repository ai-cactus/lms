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

const headCls = 'h-10 px-[18px] text-[15.5px] font-medium tracking-[0.31px] text-[#666d80]';
const cellCls = 'h-[71px] px-5 text-[17.5px] font-medium tracking-[0.35px] text-[#0d0d12]';

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
    <div className="flex min-w-0 max-w-full flex-1 flex-col gap-6 rounded-[17px] border border-[#dfe1e6] bg-white px-4 pb-4 pt-4 md:px-[21px] md:pt-[21px] shadow-[0px_1px_2px_0px_rgba(228,229,231,0.24)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold leading-[1.5] tracking-[0.4px] text-[#0d0d12] md:text-xl">
          My Courses
        </h3>
        <div className="w-full sm:w-1/2 sm:max-w-[506px]">
          <Input
            placeholder="Search for courses..."
            className="h-9 rounded-[8.5px] border-[#dfe1e6] pl-9 text-[15px] shadow-[0px_1px_2px_0px_rgba(228,229,231,0.24)] placeholder:text-[#a4abb8]"
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
            <TableHead className={`${headCls} w-full rounded-l-[9px] md:w-[34%]`}>
              Course Name
            </TableHead>
            <TableHead className={`${headCls} hidden md:table-cell`}>Type</TableHead>
            <TableHead className={`${headCls} hidden md:table-cell`}>Assigned Staff</TableHead>
            <TableHead className={`${headCls} hidden md:table-cell`}>Completion Rate</TableHead>
            <TableHead className={`${headCls} hidden md:table-cell`}>Date Created</TableHead>
            <TableHead className={`${headCls} hidden rounded-r-[9px] text-right md:table-cell`}>
              Action
            </TableHead>
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
                <TableCell className={`${cellCls} px-[18px]`}>
                  <div className="flex items-center gap-[18px]">
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
                      <span className="truncate text-[17.5px] font-semibold tracking-[0.35px] text-[#0d0d12]">
                        {course.title}
                      </span>
                      {course.level && (
                        <span className="text-xs font-normal text-text-secondary md:hidden">
                          {course.level}
                        </span>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell className={`${cellCls} hidden md:table-cell`}>
                  <CourseTypeIcon type={course.type} />
                </TableCell>
                <TableCell className={`${cellCls} hidden md:table-cell`}>
                  {course.enrollmentsCount}
                </TableCell>
                <TableCell className={`${cellCls} hidden md:table-cell`}>
                  {course.completionRate}%
                </TableCell>
                <TableCell className={`${cellCls} hidden whitespace-nowrap md:table-cell`}>
                  {new Date(course.createdAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: '2-digit',
                    year: 'numeric',
                  })}
                </TableCell>
                <TableCell
                  className={`${cellCls} hidden text-right md:table-cell`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Link
                    href={`/dashboard/training/courses/${course.id}`}
                    className="text-[16.5px] font-semibold text-primary hover:underline"
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

      <div className="flex justify-end">
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
