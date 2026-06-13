'use client';

import React from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import CoursesListClient from '@/components/dashboard/courses/CoursesListClient';
import AvailableCoursesClient from '@/components/dashboard/courses/AvailableCoursesClient';
import OfferedCoursesClient from '@/components/dashboard/courses/OfferedCoursesClient';
import type { CourseWithStats } from '@/types/course';
import type { VideoCourseAvailabilityRow, OfferedVideoCourseRow } from '@/app/actions/offering';

interface CoursesPageTabsProps {
  courses: CourseWithStats[];
  hasBilling: boolean;
  availableCourses: VideoCourseAvailabilityRow[];
  offeredCourses: OfferedVideoCourseRow[];
}

export default function CoursesPageTabs({
  courses,
  hasBilling,
  availableCourses,
  offeredCourses,
}: CoursesPageTabsProps) {
  return (
    <Tabs defaultValue="mine" className="w-full">
      <TabsList className="mb-6">
        <TabsTrigger value="mine">My Courses</TabsTrigger>
        <TabsTrigger value="video">Video Courses</TabsTrigger>
        <TabsTrigger value="available">Available</TabsTrigger>
      </TabsList>

      <TabsContent value="mine">
        <CoursesListClient courses={courses} hasBilling={hasBilling} />
      </TabsContent>

      <TabsContent value="video">
        <OfferedCoursesClient courses={offeredCourses} />
      </TabsContent>

      <TabsContent value="available">
        <AvailableCoursesClient courses={availableCourses} />
      </TabsContent>
    </Tabs>
  );
}
