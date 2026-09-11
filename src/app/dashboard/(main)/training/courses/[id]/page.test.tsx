/**
 * Thin wiring test: this page now delegates access entirely to
 * `loadCourseDetail` (its retry/rethrow contract is fully covered in
 * src/lib/course/load-course-detail.test.ts) — here we only pin that the page
 * calls notFound() on a null result and renders on a real course, replacing
 * the old inline try/catch/try/catch.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLoadCourseDetail, mockNotFound, mockAuth } = vi.hoisted(() => ({
  mockLoadCourseDetail: vi.fn(),
  mockAuth: vi.fn(),
  mockNotFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('@/lib/course/load-course-detail', () => ({ loadCourseDetail: mockLoadCourseDetail }));
vi.mock('next/navigation', () => ({ notFound: mockNotFound }));
vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/components/dashboard/training/TrainingDetails', () => ({
  default: ({
    canWithdrawAssignments,
    backHref,
  }: {
    canWithdrawAssignments?: boolean;
    backHref?: string;
  }) => (
    <div
      data-testid="training-details"
      data-can-withdraw={String(!!canWithdrawAssignments)}
      data-back-href={backHref}
    />
  ),
}));

import CourseDetailsPage from './page';

const params = Promise.resolve({ id: 'course-1' });

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({
    user: { id: 'u-1', organizationUserId: 'ou-1', organizationId: 'org-1', role: 'owner' },
  });
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

/**
 * The withdraw control's gate is computed HERE, mirroring
 * removeWorkerAssignment's own course-creator rule, so the action is never
 * offered where it would be refused.
 */
describe('CourseDetailsPage — withdraw gate', () => {
  it('allows withdrawing when the viewer created the course', async () => {
    mockLoadCourseDetail.mockResolvedValue({ id: 'course-1', createdByOrgUserId: 'ou-1' });

    render(await CourseDetailsPage({ params }));

    expect(screen.getByTestId('training-details')).toHaveAttribute('data-can-withdraw', 'true');
  });

  it('withholds it when someone else created the course — reading a roster is not withdrawing from it', async () => {
    mockLoadCourseDetail.mockResolvedValue({ id: 'course-1', createdByOrgUserId: 'ou-other' });

    render(await CourseDetailsPage({ params }));

    expect(screen.getByTestId('training-details')).toHaveAttribute('data-can-withdraw', 'false');
  });

  it('withholds it when there is no session membership', async () => {
    mockAuth.mockResolvedValue(null);
    mockLoadCourseDetail.mockResolvedValue({ id: 'course-1', createdByOrgUserId: 'ou-1' });

    render(await CourseDetailsPage({ params }));

    expect(screen.getByTestId('training-details')).toHaveAttribute('data-can-withdraw', 'false');
  });
});

/**
 * "Go Back" used to hardcode /dashboard/courses, which requirePermission
 * ('course.read') redirects on deny — a dead button for a role that can open
 * this page but lacks that permission. `backHref` is now computed here from
 * the viewer's own role, using the same predicate the sidebar uses. Finance
 * is the live case: `course.read` was removed from it 2026-08-25.
 */
describe('CourseDetailsPage — back link target', () => {
  it('sends a viewer WITHOUT course.read (finance) to /dashboard, not the redirecting route', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u-1', role: 'finance' } });
    mockLoadCourseDetail.mockResolvedValue({ id: 'course-1' });

    render(await CourseDetailsPage({ params }));

    expect(screen.getByTestId('training-details')).toHaveAttribute('data-back-href', '/dashboard');
  });

  it('sends a viewer WITH course.read (owner) to /dashboard/courses', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u-1', role: 'owner' } });
    mockLoadCourseDetail.mockResolvedValue({ id: 'course-1' });

    render(await CourseDetailsPage({ params }));

    expect(screen.getByTestId('training-details')).toHaveAttribute(
      'data-back-href',
      '/dashboard/courses',
    );
  });

  it('sends admin (course.read holder) to /dashboard/courses too — not an owner-only fix', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u-1', role: 'admin' } });
    mockLoadCourseDetail.mockResolvedValue({ id: 'course-1' });

    render(await CourseDetailsPage({ params }));

    expect(screen.getByTestId('training-details')).toHaveAttribute(
      'data-back-href',
      '/dashboard/courses',
    );
  });

  it('falls back to /dashboard with no session at all', async () => {
    mockAuth.mockResolvedValue(null);
    mockLoadCourseDetail.mockResolvedValue({ id: 'course-1' });

    render(await CourseDetailsPage({ params }));

    expect(screen.getByTestId('training-details')).toHaveAttribute('data-back-href', '/dashboard');
  });

  it('falls back to /dashboard for an unrecognized/stale role value', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u-1', role: 'retired_role' } });
    mockLoadCourseDetail.mockResolvedValue({ id: 'course-1' });

    render(await CourseDetailsPage({ params }));

    expect(screen.getByTestId('training-details')).toHaveAttribute('data-back-href', '/dashboard');
  });
});
