/**
 * Same wiring change as the sibling management page — delegates entirely to
 * `loadCourseDetail` (fully covered in
 * src/lib/course/load-course-detail.test.ts). Pins only that this page's
 * notFound()/render/rethrow wiring is correct.
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
vi.mock('@/components/dashboard/training/CoursePreview', () => ({
  default: () => <div data-testid="course-preview" />,
}));

import CoursePreviewPage from './page';

const params = Promise.resolve({ id: 'course-1' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CoursePreviewPage', () => {
  it('calls notFound() when loadCourseDetail resolves null', async () => {
    mockLoadCourseDetail.mockResolvedValue(null);

    await expect(CoursePreviewPage({ params })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('renders CoursePreview when a course is returned', async () => {
    mockLoadCourseDetail.mockResolvedValue({ id: 'course-1' });

    const element = await CoursePreviewPage({ params });
    render(element);

    expect(screen.getByTestId('course-preview')).toBeInTheDocument();
  });

  it('a non-access failure from loadCourseDetail propagates rather than becoming notFound()', async () => {
    const dbError = new Error('connection terminated unexpectedly');
    mockLoadCourseDetail.mockRejectedValue(dbError);

    await expect(CoursePreviewPage({ params })).rejects.toBe(dbError);
    expect(mockNotFound).not.toHaveBeenCalled();
  });
});
