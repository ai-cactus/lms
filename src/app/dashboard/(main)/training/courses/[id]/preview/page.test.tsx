/**
 * Same wiring change as the sibling management page — delegates entirely to
 * `loadCourseDetail` (fully covered in
 * src/lib/course/load-course-detail.test.ts). Pins this page's
 * notFound()/render/rethrow wiring, plus the page-level `course.read` gate it
 * previously lacked entirely.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLoadCourseDetail, mockNotFound, mockRequirePermission } = vi.hoisted(() => ({
  mockLoadCourseDetail: vi.fn(),
  mockNotFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  mockRequirePermission: vi.fn(),
}));

vi.mock('@/lib/course/load-course-detail', () => ({ loadCourseDetail: mockLoadCourseDetail }));
vi.mock('@/lib/rbac/require-permission', () => ({ requirePermission: mockRequirePermission }));
vi.mock('next/navigation', () => ({ notFound: mockNotFound }));
vi.mock('@/components/dashboard/training/CoursePreview', () => ({
  default: () => <div data-testid="course-preview" />,
}));

import CoursePreviewPage from './page';

const params = Promise.resolve({ id: 'course-1' });

beforeEach(() => {
  vi.clearAllMocks();
  mockRequirePermission.mockResolvedValue({
    userId: 'user-1',
    role: 'hr',
    roleKey: 'hr',
    organizationId: 'org-1',
    organizationUserId: 'ou-1',
  });
});

describe('CoursePreviewPage', () => {
  // The route had no page-level gate at all and leaned entirely on
  // loadCourseDetail's data-layer refusal. `notFound` is the deny shape for an
  // id-addressed URL — a redirect would confirm the course id exists.
  it('gates on course.read and 404s (never redirects) on deny', async () => {
    mockLoadCourseDetail.mockResolvedValue({ id: 'course-1' });

    await CoursePreviewPage({ params });

    expect(mockRequirePermission).toHaveBeenCalledWith('course.read', { onDeny: 'notFound' });
  });

  it('propagates the guard refusal without loading the course', async () => {
    mockRequirePermission.mockRejectedValue(new Error('NEXT_NOT_FOUND'));

    await expect(CoursePreviewPage({ params })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockLoadCourseDetail).not.toHaveBeenCalled();
  });

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
