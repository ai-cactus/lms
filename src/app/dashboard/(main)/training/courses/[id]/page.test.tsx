/**
 * The page gate runs through the REAL requirePermission → evaluatePermission →
 * can() chain; only `auth()` is stubbed. Mocking the guard itself would let a
 * registry change (a role gaining or losing `course.read`) pass unnoticed, and
 * the role table below is exactly what this route promises.
 *
 * Access to the course itself is delegated to `loadCourseDetail` (its
 * retry/rethrow contract is covered in src/lib/course/load-course-detail.test.ts).
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockLoadCourseDetail,
  mockNotFound,
  mockRedirect,
  mockAuth,
  mockGetCourseAssignmentSettings,
  mockGetRoleHolderCounts,
} = vi.hoisted(() => ({
  mockLoadCourseDetail: vi.fn(),
  mockAuth: vi.fn(),
  mockNotFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  mockGetCourseAssignmentSettings: vi.fn(async () => null),
  mockGetRoleHolderCounts: vi.fn(async () => ({})),
}));

vi.mock('@/lib/course/load-course-detail', () => ({ loadCourseDetail: mockLoadCourseDetail }));
// The page preloads the role-target picker's data. Both reads are real Server
// Actions that hit the DB, so they are stubbed here — their own gate is covered
// in the enrollment action suite.
vi.mock('@/app/actions/enrollment', () => ({
  getCourseAssignmentSettings: mockGetCourseAssignmentSettings,
  getRoleHolderCounts: mockGetRoleHolderCounts,
}));
vi.mock('next/navigation', () => ({ notFound: mockNotFound, redirect: mockRedirect }));
vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (email: string) => email,
}));
// require-permission's facility-scope variant pulls these in; this page does not
// use it, so they only need to load without touching Prisma.
vi.mock('@/lib/facility/scope', () => ({}));
vi.mock('@/lib/facility/staff-where', () => ({}));
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

function sessionFor(role: string, overrides: Record<string, unknown> = {}) {
  return {
    user: {
      id: 'u-1',
      email: 'viewer@example.com',
      organizationUserId: 'ou-1',
      organizationId: 'org-1',
      role,
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue(sessionFor('owner'));
  mockLoadCourseDetail.mockResolvedValue({
    id: 'course-1',
    creator: { organizationId: 'org-1' },
  });
});

describe('CourseDetailsPage — page-level gate', () => {
  // Finance holds nothing on Courses (course.read removed 2026-08-25). Before
  // the gate, loadCourseDetail's enrolment door still rendered this management
  // view for any course Finance was enrolled on.
  it('404s Finance before any course data is loaded', async () => {
    mockAuth.mockResolvedValue(sessionFor('finance'));

    await expect(CourseDetailsPage({ params })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockLoadCourseDetail).not.toHaveBeenCalled();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  // Every worker role holds `course.read` for its own learning, so this is the
  // case that proves the gate is admin-category and not the bare verb.
  it.each(['nurse', 'therapist_clinician', 'front_desk_admin'])(
    '404s the worker role %s even though it holds course.read',
    async (role) => {
      mockAuth.mockResolvedValue(sessionFor(role));

      await expect(CourseDetailsPage({ params })).rejects.toThrow('NEXT_NOT_FOUND');
      expect(mockLoadCourseDetail).not.toHaveBeenCalled();
    },
  );

  it('404s an unrecognised or stale role', async () => {
    mockAuth.mockResolvedValue(sessionFor('retired_role'));

    await expect(CourseDetailsPage({ params })).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mockLoadCourseDetail).not.toHaveBeenCalled();
  });

  it('sends an unauthenticated caller to /login rather than 404ing', async () => {
    mockAuth.mockResolvedValue(null);

    await expect(CourseDetailsPage({ params })).rejects.toThrow('NEXT_REDIRECT:/login');
    expect(mockLoadCourseDetail).not.toHaveBeenCalled();
  });

  // Positive controls: a gate that refuses everyone must not pass this suite.
  it.each(['owner', 'admin', 'supervisor', 'hr', 'clinical_director'])(
    'renders for %s, which legitimately views course details',
    async (role) => {
      mockAuth.mockResolvedValue(sessionFor(role));

      render(await CourseDetailsPage({ params }));

      expect(screen.getByTestId('training-details')).toBeInTheDocument();
      expect(mockLoadCourseDetail).toHaveBeenCalledWith('course-1');
    },
  );
});

describe('CourseDetailsPage — data wiring', () => {
  it('calls notFound() when loadCourseDetail resolves null', async () => {
    mockLoadCourseDetail.mockResolvedValue(null);

    await expect(CourseDetailsPage({ params })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('a non-access failure from loadCourseDetail propagates rather than becoming notFound()', async () => {
    const dbError = new Error('connection terminated unexpectedly');
    mockLoadCourseDetail.mockRejectedValue(dbError);

    await expect(CourseDetailsPage({ params })).rejects.toBe(dbError);
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  // Every viewer that passes the gate holds course.read, so /dashboard/courses
  // (itself gated on course.read) is always a live destination.
  it('links "Go Back" to /dashboard/courses', async () => {
    render(await CourseDetailsPage({ params }));

    expect(screen.getByTestId('training-details')).toHaveAttribute(
      'data-back-href',
      '/dashboard/courses',
    );
  });
});

/**
 * The withdraw control's gate is computed HERE, mirroring
 * removeWorkerAssignment's own gate — the `assignment.delete` verb and an
 * organisation to act in — so the action is never offered where it would be
 * refused. Neither authorship nor the course CREATOR's organisation is part of
 * it: tenancy is per enrolment, and the roster this page renders is already
 * scoped to the caller's own organisation.
 */
describe('CourseDetailsPage — withdraw gate', () => {
  it('allows withdrawing a course the viewer created', async () => {
    mockLoadCourseDetail.mockResolvedValue({
      id: 'course-1',
      createdByOrgUserId: 'ou-1',
      creator: { organizationId: 'org-1' },
    });

    render(await CourseDetailsPage({ params }));

    expect(screen.getByTestId('training-details')).toHaveAttribute('data-can-withdraw', 'true');
  });

  // COU-004: a course belongs to the organization, not to its author.
  it('allows withdrawing a colleague-authored course in the same organization', async () => {
    mockLoadCourseDetail.mockResolvedValue({
      id: 'course-1',
      createdByOrgUserId: 'ou-other',
      creator: { organizationId: 'org-1' },
    });

    render(await CourseDetailsPage({ params }));

    expect(screen.getByTestId('training-details')).toHaveAttribute('data-can-withdraw', 'true');
  });

  // Rule C: a supervisor authors nothing, so the old creator rule made the
  // control permanently absent for them.
  it('offers it to a supervisor, who holds assignment.delete but authors nothing', async () => {
    mockAuth.mockResolvedValue(sessionFor('supervisor', { id: 'u-2', organizationUserId: 'ou-2' }));
    mockLoadCourseDetail.mockResolvedValue({
      id: 'course-1',
      createdByOrgUserId: 'ou-other',
      creator: { organizationId: 'org-1' },
    });

    render(await CourseDetailsPage({ params }));

    expect(screen.getByTestId('training-details')).toHaveAttribute('data-can-withdraw', 'true');
  });

  // An adopted video course is authored by Theraptly's system organisation, but
  // every row on its roster here is this organisation's own learner. Keying the
  // gate on the creator's organisation hid the control on every adopted course.
  //
  // No "role without assignment.delete" case here: every role that clears this
  // page's `course.read` + isAdminRole gate also holds assignment.delete, so the
  // verb term in the page's gate is defensive and unreachable through the page.
  it('offers it on an adopted course authored by another organisation (Theraptly)', async () => {
    mockLoadCourseDetail.mockResolvedValue({
      id: 'course-1',
      createdByOrgUserId: 'ou-system',
      creator: { organizationId: 'org-theraptly' },
    });

    render(await CourseDetailsPage({ params }));

    expect(screen.getByTestId('training-details')).toHaveAttribute('data-can-withdraw', 'true');
  });

  it('withholds it when the session has no active organization', async () => {
    mockAuth.mockResolvedValue(sessionFor('owner', { organizationId: null }));

    render(await CourseDetailsPage({ params }));

    expect(screen.getByTestId('training-details')).toHaveAttribute('data-can-withdraw', 'false');
  });
});

/**
 * `getCourseAssignmentSettings`/`getRoleHolderCounts` both THROW `Forbidden`
 * without `assignment.read` (see enrollment.ts), so the page must skip the
 * calls entirely for a viewer that lacks it — an un-caught rejection would take
 * the whole page down, not just hide the role-target picker.
 */
describe('CourseDetailsPage — assignment.read gate (role-target picker preload)', () => {
  it('calls both for a role that holds assignment.read (owner)', async () => {
    render(await CourseDetailsPage({ params }));

    expect(mockGetCourseAssignmentSettings).toHaveBeenCalledWith('course-1');
    expect(mockGetRoleHolderCounts).toHaveBeenCalledTimes(1);
  });

  it('calls both for a supervisor, who holds assignment.read via its read-everything grant', async () => {
    mockAuth.mockResolvedValue(sessionFor('supervisor'));

    render(await CourseDetailsPage({ params }));

    expect(mockGetCourseAssignmentSettings).toHaveBeenCalledWith('course-1');
  });
});
