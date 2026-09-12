/**
 * Thin wiring test: this page now delegates access entirely to
 * `loadCourseDetail` (its retry/rethrow contract is fully covered in
 * src/lib/course/load-course-detail.test.ts) — here we only pin that the page
 * calls notFound() on a null result and renders on a real course, replacing
 * the old inline try/catch/try/catch.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockLoadCourseDetail,
  mockNotFound,
  mockAuth,
  mockGetCourseAssignmentSettings,
  mockGetRoleHolderCounts,
} = vi.hoisted(() => ({
  mockLoadCourseDetail: vi.fn(),
  mockAuth: vi.fn(),
  mockNotFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  mockGetCourseAssignmentSettings: vi.fn(async () => null),
  mockGetRoleHolderCounts: vi.fn(async () => ({})),
}));

vi.mock('@/lib/course/load-course-detail', () => ({ loadCourseDetail: mockLoadCourseDetail }));
// The page now preloads the role-target picker's data. Both reads are real
// Server Actions that hit the DB, so they are stubbed here — their own gate is
// covered in the enrollment action suite.
vi.mock('@/app/actions/enrollment', () => ({
  getCourseAssignmentSettings: mockGetCourseAssignmentSettings,
  getRoleHolderCounts: mockGetRoleHolderCounts,
}));
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

/**
 * `getCourseAssignmentSettings`/`getRoleHolderCounts` both THROW `Forbidden`
 * without `assignment.read` (see enrollment.ts). This page is reachable by
 * every enrolled learner, so the page must skip the calls entirely for a role
 * that lacks the permission — an un-caught rejection here would take the
 * whole page down for them, not just hide the role-target picker.
 */
describe('CourseDetailsPage — assignment.read gate (role-target picker preload)', () => {
  it('does not call getCourseAssignmentSettings/getRoleHolderCounts for a worker/enrolled-learner role', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u-1', role: 'nurse' } });
    mockLoadCourseDetail.mockResolvedValue({ id: 'course-1' });

    render(await CourseDetailsPage({ params }));

    expect(mockGetCourseAssignmentSettings).not.toHaveBeenCalled();
    expect(mockGetRoleHolderCounts).not.toHaveBeenCalled();
  });

  it('does not call them for finance either (holds course.read via no path here, but never assignment.read)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u-1', role: 'finance' } });
    mockLoadCourseDetail.mockResolvedValue({ id: 'course-1' });

    render(await CourseDetailsPage({ params }));

    expect(mockGetCourseAssignmentSettings).not.toHaveBeenCalled();
    expect(mockGetRoleHolderCounts).not.toHaveBeenCalled();
  });

  it('calls both for a role that holds assignment.read (owner)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'u-1', role: 'owner' } });
    mockLoadCourseDetail.mockResolvedValue({ id: 'course-1' });

    render(await CourseDetailsPage({ params }));

    expect(mockGetCourseAssignmentSettings).toHaveBeenCalledWith('course-1');
    expect(mockGetRoleHolderCounts).toHaveBeenCalledTimes(1);
  });

  it('does not call them when there is no session at all', async () => {
    mockAuth.mockResolvedValue(null);
    mockLoadCourseDetail.mockResolvedValue({ id: 'course-1' });

    render(await CourseDetailsPage({ params }));

    expect(mockGetCourseAssignmentSettings).not.toHaveBeenCalled();
    expect(mockGetRoleHolderCounts).not.toHaveBeenCalled();
  });
});
