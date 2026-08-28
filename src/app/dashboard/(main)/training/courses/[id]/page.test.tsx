/**
 * Thin wiring test: this page now delegates access entirely to
 * `loadCourseDetail` (its retry/rethrow contract is fully covered in
 * src/lib/course/load-course-detail.test.ts) — here we only pin that the page
 * calls notFound() on a null result and renders on a real course, replacing
 * the old inline try/catch/try/catch.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLoadCourseDetail, mockNotFound } = vi.hoisted(() => ({
  mockLoadCourseDetail: vi.fn(),
  mockNotFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/lib/course/load-course-detail', () => ({ loadCourseDetail: mockLoadCourseDetail }));
vi.mock('next/navigation', () => ({ notFound: mockNotFound }));
vi.mock('@/components/dashboard/training/TrainingDetails', () => ({
  default: () => <div data-testid="training-details" />,
}));

import CourseDetailsPage from './page';

const params = Promise.resolve({ id: 'course-1' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CourseDetailsPage', () => {
  it('calls notFound() when loadCourseDetail resolves null', async () => {
    mockLoadCourseDetail.mockResolvedValue(null);

    await expect(CourseDetailsPage({ params })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('renders TrainingDetails when a course is returned', async () => {
    mockLoadCourseDetail.mockResolvedValue({ id: 'course-1' });

    const element = await CourseDetailsPage({ params });
    render(element);

    expect(screen.getByTestId('training-details')).toBeInTheDocument();
  });

  it('a non-access failure from loadCourseDetail propagates rather than becoming notFound()', async () => {
    const dbError = new Error('connection terminated unexpectedly');
    mockLoadCourseDetail.mockRejectedValue(dbError);

    await expect(CourseDetailsPage({ params })).rejects.toBe(dbError);
    expect(mockNotFound).not.toHaveBeenCalled();
  });
});
