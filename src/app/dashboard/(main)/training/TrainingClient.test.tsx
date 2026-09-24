/**
 * Founder ruling Q2 (2026-09-23) gates BOTH create-course affordances on
 * `course.create`: the Training Dashboard's "Create Course" button (via
 * `TrainingDashboard`'s own `canCreateCourses` prop) and this component's own
 * onboarding pitch ("Create your first course"), which is reachable only when
 * the org has zero courses.
 *
 * This is the second of the two affordances the orchestrator named in the
 * BUG-... job-title-removal review — `TrainingDashboard.test.tsx` already pins
 * the first one, but nothing previously covered this component's own branch:
 * a zero-course viewer who cannot create courses must land on the dashboard
 * (with no Create Course button) rather than the onboarding pitch, since that
 * pitch is entirely a create-course affordance a Finance/Supervisor viewer's
 * first click would refuse.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TrainingClient from './TrainingClient';
import type { DashboardStats } from '@/components/dashboard/training/TrainingDashboard';
import type { CourseWithStats } from '@/types/course';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) => <img alt={alt} src={src} />,
}));

const STATS: DashboardStats = {
  totalCourses: 0,
  totalStaffAssigned: 0,
  averageGrade: 0,
  monthlyPerformance: [],
  trainingCoverage: { completed: 0, inProgress: 0, notStarted: 0 },
};

const COURSE: CourseWithStats = {
  id: 'c1',
  title: 'Reading Course',
  type: 'text',
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

describe('TrainingClient — create-course affordances follow canCreateCourses', () => {
  it('shows the onboarding pitch with its Create-course affordance when the org has zero courses and the viewer can create', () => {
    render(<TrainingClient stats={STATS} courses={[]} canCreateCourses />);

    expect(screen.getByRole('button', { name: 'Create your first course' })).toBeInTheDocument();
    expect(screen.queryByText('Training Dashboard')).not.toBeInTheDocument();
  });

  it('skips the onboarding pitch and goes straight to the dashboard when the org has zero courses but the viewer cannot create', () => {
    render(<TrainingClient stats={STATS} courses={[]} canCreateCourses={false} />);

    expect(
      screen.queryByRole('button', { name: 'Create your first course' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Training Dashboard')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create Course' })).not.toBeInTheDocument();
  });

  it('hides the dashboard Create-course button for a non-creator even with existing courses', () => {
    render(<TrainingClient stats={STATS} courses={[COURSE]} canCreateCourses={false} />);

    expect(screen.getByText('Training Dashboard')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create Course' })).not.toBeInTheDocument();
  });

  it('shows the dashboard Create-course button for a creator with existing courses', () => {
    render(<TrainingClient stats={STATS} courses={[COURSE]} canCreateCourses />);

    expect(screen.getByRole('button', { name: 'Create Course' })).toBeInTheDocument();
  });
});
