'use client';

import React, { useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
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

// Tab values are kept stable for deep-linking (?tab=...) even though the
// visible labels are more descriptive.
const TAB_VALUES = ['mine', 'video', 'available'] as const;
type TabValue = (typeof TAB_VALUES)[number];

const TAB_LABELS: { value: TabValue; label: string }[] = [
  { value: 'mine', label: 'My Courses' },
  { value: 'video', label: 'Offered Video Courses' },
  { value: 'available', label: 'Available Video Courses' },
];

function isTabValue(value: string | null): value is TabValue {
  return value != null && (TAB_VALUES as readonly string[]).includes(value);
}

export default function CoursesPageTabs({
  courses,
  hasBilling,
  availableCourses,
  offeredCourses,
}: CoursesPageTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Active tab is driven by the URL (?tab=…) so the dashboard "View all"
  // links can deep-link straight into a specific tab.
  const tabParam = searchParams.get('tab');
  const activeTab: TabValue = isTabValue(tabParam) ? tabParam : 'mine';

  const handleTabChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === 'mine') {
        params.delete('tab');
      } else {
        params.set('tab', value);
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
      <TabsList className="mb-6 h-auto w-full flex-wrap justify-start gap-2 bg-transparent p-0">
        {TAB_LABELS.map(({ value, label }) => (
          <TabsTrigger
            key={value}
            value={value}
            className="flex-none rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-semibold text-foreground/70 shadow-sm transition-colors hover:bg-muted data-[state=active]:border-primary! data-[state=active]:bg-primary! data-[state=active]:text-white! data-[state=active]:shadow"
          >
            {label}
          </TabsTrigger>
        ))}
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
