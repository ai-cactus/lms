/**
 * The preview page's side of the detail/preview split. The dark hero, the
 * Course Overview card and the Table of Content rail all moved here from the
 * detail page, and "View Course" came with them — the preview is now the only
 * screen that opens the player.
 *
 * Worker mode shares this component (/worker/courses/[id]), so each admin-only
 * assertion has a worker-mode counterpart: the worker gets its own
 * Start/Continue button there, never "View Course".
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/app/actions/course', () => ({ startCourse: vi.fn() }));
vi.mock('@/app/actions/enrollment', () => ({ requestCourseRetry: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (email: string) => email,
}));

import CoursePreview from './CoursePreview';
import type { CourseWithRelations } from '@/types/course';

function baseCourse(overrides: Record<string, unknown> = {}): CourseWithRelations {
  return {
    id: 'course-1',
    title: 'Infection Control',
    description: 'A short course on hand hygiene.',
    overview: '<p>Everything you need to know.</p>',
    type: 'document',
    duration: 45,
    status: 'published',
    reviewRequired: false,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    objectives: ['Wash your hands'],
    skillLevel: 'beginner',
    previewVideoStorageUri: null,
    modules: [],
    quiz: null,
    lessons: [
      { id: 'lesson-1', title: 'Why hygiene matters', videoStorageUri: null, quiz: null },
      { id: 'lesson-2', title: 'Washing technique', videoStorageUri: null, quiz: null },
    ],
    enrollments: [],
    creator: {
      userId: 'u-author',
      organizationId: 'org-1',
      role: 'admin',
      user: { email: 'author@example.com', fullName: 'Ada Author' },
    },
    approvedBy: null,
    ...overrides,
  } as unknown as CourseWithRelations;
}

describe('CoursePreview — hero', () => {
  it('renders the "Course / {title}" breadcrumb, with Course linking back to the detail page', () => {
    render(<CoursePreview course={baseCourse()} />);

    expect(screen.getByRole('link', { name: 'Course' })).toHaveAttribute(
      'href',
      '/dashboard/training/courses/course-1',
    );
    // Title appears twice: once in the breadcrumb, once as the <h1>.
    expect(screen.getAllByText('Infection Control').length).toBeGreaterThanOrEqual(2);
  });

  it('opens THIS course from "View Course"', () => {
    render(<CoursePreview course={baseCourse({ id: 'course-42' })} />);

    expect(screen.getByRole('link', { name: 'View Course' })).toHaveAttribute(
      'href',
      '/learn/course-42',
    );
  });

  it('points the breadcrumb at the worker route, and offers Start Course instead of View Course, in worker mode', () => {
    render(<CoursePreview course={baseCourse()} mode="worker" />);

    expect(screen.getByRole('link', { name: 'Course' })).toHaveAttribute(
      'href',
      '/worker/courses/course-1',
    );
    expect(screen.getByRole('button', { name: 'Start Course' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View Course' })).not.toBeInTheDocument();
  });
});

describe('CoursePreview — Course Overview and Table of Content', () => {
  it('renders the Course Overview card', () => {
    render(<CoursePreview course={baseCourse()} />);

    expect(screen.getByText('Course Overview')).toBeInTheDocument();
    expect(screen.getByText('Everything you need to know.')).toBeInTheDocument();
    expect(screen.getByText(/What You.ll Learn/)).toBeInTheDocument();
  });

  it('renders the Table of Content rail with every lesson and its metadata', () => {
    render(<CoursePreview course={baseCourse()} />);

    expect(screen.getByText('Table of Content')).toBeInTheDocument();
    expect(screen.getByText('Why hygiene matters')).toBeInTheDocument();
    expect(screen.getByText('Washing technique')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('45 mins')).toBeInTheDocument();
    expect(screen.getByText('Last Updated')).toBeInTheDocument();
  });

  it('collapses the list past four lessons behind "View all"', () => {
    render(
      <CoursePreview
        course={baseCourse({
          lessons: Array.from({ length: 6 }, (_, i) => ({
            id: `lesson-${i}`,
            title: `Lesson ${i}`,
            videoStorageUri: null,
            quiz: null,
          })),
        })}
      />,
    );

    expect(screen.getByRole('button', { name: 'View all' })).toBeInTheDocument();
    expect(screen.getByText('Lesson 3')).toBeInTheDocument();
    expect(screen.queryByText('Lesson 4')).not.toBeInTheDocument();
  });

  it('still renders the metadata rows for a course with no lessons yet', () => {
    render(<CoursePreview course={baseCourse({ lessons: [] })} />);

    expect(screen.getByText('Table of Content')).toBeInTheDocument();
    expect(screen.getByText('Last Updated')).toBeInTheDocument();
  });
});
