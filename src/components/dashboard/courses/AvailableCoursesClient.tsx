'use client';

import React, { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import type { VideoCourseAvailabilityRow } from '@/app/actions/offering';
import { Search } from 'lucide-react';
import VideoCourseCard from './VideoCourseCard';

interface AvailableCoursesClientProps {
  courses: VideoCourseAvailabilityRow[];
}

export default function AvailableCoursesClient({ courses }: AvailableCoursesClientProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredCourses = useMemo(() => {
    if (!searchQuery.trim()) return courses;
    const q = searchQuery.toLowerCase();
    return courses.filter(
      (c) => c.title.toLowerCase().includes(q) || (c.category?.toLowerCase().includes(q) ?? false),
    );
  }, [courses, searchQuery]);

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col">
      <div className="mb-8 flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-start">
        <div>
          <div className="mb-2 text-sm text-[#718096]">Trainings / Courses</div>
          <h1 className="text-2xl font-bold text-[#1a202c]">Available Video Courses</h1>
        </div>
      </div>

      <div className="mb-6 w-full sm:w-[420px]">
        <Input
          className="h-11"
          placeholder="Search courses by title or category"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          startIcon={<Search aria-hidden="true" />}
        />
      </div>

      {filteredCourses.length > 0 ? (
        <div className="flex flex-col gap-4">
          {filteredCourses.map((course) => (
            <VideoCourseCard key={course.id} course={course} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border bg-white p-10 text-center">
          <p className="text-sm font-medium text-foreground">No video courses available yet.</p>
          <p className="mt-1 text-sm text-text-secondary">
            {searchQuery.trim()
              ? 'Try adjusting your search.'
              : 'Global video courses will appear here once published.'}
          </p>
        </div>
      )}
    </div>
  );
}
