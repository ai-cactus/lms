/**
 * QA #15 fix: getCourseById THROWS on denial rather than calling notFound().
 * A bare `catch { notFound(); }` here would turn a database fault into the
 * same 404 as a genuine access denial — the same swallow-and-404 defect
 * `loadCourseDetail` fixes for the dashboard pages (see
 * src/lib/course/load-course-detail.test.ts). This page uses the narrower
 * `isCourseAccessError` guard directly instead of the shared loader (it has
 * only one door, getCourseById, not the dashboard's two-door fallback).
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, mockGetCourseById, mockNotFound, mockRedirect, prismaMock } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockGetCourseById: vi.fn(),
  mockNotFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  mockRedirect: vi.fn(() => {
    throw new Error('NEXT_REDIRECT');
  }),
  prismaMock: { enrollment: { findFirst: vi.fn() } },
}));

vi.mock('@/auth.worker', () => ({ auth: mockAuth }));
vi.mock('@/app/actions/course', () => ({ getCourseById: mockGetCourseById }));
vi.mock('next/navigation', () => ({ notFound: mockNotFound, redirect: mockRedirect }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/components/dashboard/training/CoursePreview', () => ({
  default: () => <div data-testid="course-preview" />,
}));

import WorkerCourseDetailsPage from './page';
import { CourseAccessError } from '@/lib/course/access-error';

const SESSION = { user: { id: 'worker-1', organizationUserId: 'ou-1' } };
const params = Promise.resolve({ id: 'course-1' });

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(SESSION);
  prismaMock.enrollment.findFirst.mockResolvedValue(null);
});

describe('WorkerCourseDetailsPage', () => {
  it('renders the course when getCourseById succeeds', async () => {
    mockGetCourseById.mockResolvedValue({ id: 'course-1', enrollments: [{ id: 'e1' }] });

    const element = await WorkerCourseDetailsPage({ params });
    render(element);

    expect(screen.getByTestId('course-preview')).toBeInTheDocument();
  });

  it('calls notFound() on a genuine CourseAccessError (denial)', async () => {
    mockGetCourseById.mockRejectedValue(new CourseAccessError('forbidden'));

    await expect(WorkerCourseDetailsPage({ params })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalledOnce();
  });

  it('THE FIX (QA #15): a non-access error (e.g. a DB fault) propagates and does NOT become notFound()', async () => {
    const dbError = new Error('connection terminated unexpectedly');
    mockGetCourseById.mockRejectedValue(dbError);

    await expect(WorkerCourseDetailsPage({ params })).rejects.toBe(dbError);
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  it('redirects unauthenticated visitors before ever calling getCourseById', async () => {
    mockAuth.mockResolvedValue(null);

    await expect(WorkerCourseDetailsPage({ params })).rejects.toThrow('NEXT_REDIRECT');
    expect(mockGetCourseById).not.toHaveBeenCalled();
  });

  it("strips other users' enrollments before handing the course to CoursePreview (never trust the client with the raw roster)", async () => {
    mockGetCourseById.mockResolvedValue({
      id: 'course-1',
      enrollments: [{ id: 'e1' }, { id: 'e2' }],
    });
    const CoursePreviewModule = await import('@/components/dashboard/training/CoursePreview');
    const spy = vi.spyOn(CoursePreviewModule, 'default');

    const element = await WorkerCourseDetailsPage({ params });
    render(element);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ course: expect.objectContaining({ enrollments: [] }) }),
      undefined,
    );
  });
});
