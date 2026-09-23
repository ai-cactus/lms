/**
 * The course-list redesign swapped TrainingDashboard's hand-rolled thumbnail
 * for the shared `CourseThumbnail`, keyed off `course.type`. This pins that
 * the courses table renders the reading tile vs. the video frame per row.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TrainingDashboard, { type DashboardStats } from './TrainingDashboard';
import type { CourseWithStats } from '@/types/course';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
}));

const STATS: DashboardStats = {
  totalCourses: 2,
  totalStaffAssigned: 5,
  averageGrade: 88,
  monthlyPerformance: [],
  trainingCoverage: { completed: 40, inProgress: 30, notStarted: 30 },
};

const BASE_COURSE: Omit<CourseWithStats, 'id' | 'title' | 'type'> = {
  description: null,
  thumbnail: null,
  status: 'published',
  duration: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  lessonsCount: 3,
  enrollmentsCount: 4,
  completionRate: 60,
};

describe('TrainingDashboard — courses table thumbnail per type', () => {
  it('renders the dark reading tile for a text course and the video frame for a video course', () => {
    const courses: CourseWithStats[] = [
      { ...BASE_COURSE, id: 'c1', title: 'Reading Course', type: 'text' },
      { ...BASE_COURSE, id: 'c2', title: 'Video Course', type: 'video' },
    ];

    render(
      <TrainingDashboard
        onCreateCourse={vi.fn()}
        stats={STATS}
        courses={courses}
        canCreateCourses
      />,
    );

    const readingRow = screen.getByText('Reading Course').closest('tr')!;
    expect(readingRow.querySelector('[class*="bg-[#1c213d]"]')).not.toBeNull();
    expect(readingRow.querySelector('img')).toBeNull();

    const videoRow = screen.getByText('Video Course').closest('tr')!;
    expect(videoRow.querySelector('img')).not.toBeNull();
    expect(videoRow.querySelector('[class*="bg-[#1c213d]"]')).toBeNull();
  });
});
