/**
 * `loadCourseDetail` replaces a bare `catch` that used to retry
 * `getCourseForOrgView` on ANY failure from `getCourseById` — including a
 * database outage or a missing session, not just an access denial. That
 * masked real faults as a plain 404. These tests pin the new, narrower
 * contract: retry ONLY on a `CourseAccessError`, and rethrow everything else
 * so a genuine infrastructure failure surfaces as a failure, not an empty page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetCourseById, mockGetCourseForOrgView } = vi.hoisted(() => ({
  mockGetCourseById: vi.fn(),
  mockGetCourseForOrgView: vi.fn(),
}));

vi.mock('@/app/actions/course', () => ({
  getCourseById: mockGetCourseById,
  getCourseForOrgView: mockGetCourseForOrgView,
}));

import { loadCourseDetail } from './load-course-detail';
import { CourseAccessError } from './access-error';

const COURSE = { id: 'course-1' } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('loadCourseDetail', () => {
  it('returns the course from getCourseById without ever trying the fallback', async () => {
    mockGetCourseById.mockResolvedValue(COURSE);

    const result = await loadCourseDetail('course-1');

    expect(result).toBe(COURSE);
    expect(mockGetCourseForOrgView).not.toHaveBeenCalled();
  });

  it('retries via getCourseForOrgView when getCourseById refuses with a CourseAccessError, and returns its result', async () => {
    mockGetCourseById.mockRejectedValue(new CourseAccessError('forbidden'));
    mockGetCourseForOrgView.mockResolvedValue(COURSE);

    const result = await loadCourseDetail('course-1');

    expect(result).toBe(COURSE);
    expect(mockGetCourseForOrgView).toHaveBeenCalledWith('course-1');
  });

  it('returns null when both doors deny access via a CourseAccessError', async () => {
    mockGetCourseById.mockRejectedValue(new CourseAccessError('notFound'));
    mockGetCourseForOrgView.mockRejectedValue(new CourseAccessError('forbidden'));

    const result = await loadCourseDetail('course-1');

    expect(result).toBeNull();
  });

  it('THE FIX: a non-access error from getCourseById (e.g. a DB fault) propagates and does NOT retry or become a 404', async () => {
    const dbError = new Error('connection terminated unexpectedly');
    mockGetCourseById.mockRejectedValue(dbError);

    await expect(loadCourseDetail('course-1')).rejects.toBe(dbError);
    expect(mockGetCourseForOrgView).not.toHaveBeenCalled();
  });

  it('THE FIX: a non-access error from getCourseForOrgView (the fallback door) also propagates rather than resolving to null', async () => {
    mockGetCourseById.mockRejectedValue(new CourseAccessError('forbidden'));
    const dbError = new Error('connection terminated unexpectedly');
    mockGetCourseForOrgView.mockRejectedValue(dbError);

    await expect(loadCourseDetail('course-1')).rejects.toBe(dbError);
  });

  it('a bare Error (not a CourseAccessError) with the SAME message as a real access denial still propagates — the type is the signal, not the text', async () => {
    // Guards against a regression that matches on error.message instead of
    // the typed reason (which would silently reintroduce the swallow-and-404
    // bug for any caller that happens to throw plain "Course not found").
    const impostor = new Error('Course not found');
    mockGetCourseById.mockRejectedValue(impostor);

    await expect(loadCourseDetail('course-1')).rejects.toBe(impostor);
    expect(mockGetCourseForOrgView).not.toHaveBeenCalled();
  });
});
