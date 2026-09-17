/**
 * Withdrawing an assignment.
 *
 * The gate is three independent questions, pinned here because each one was a
 * live defect at some point:
 *
 *  - the `assignment.delete` VERB, not course authorship. Founder Rule C —
 *    "Supervisors should be able to withdraw course from staff in their
 *    facility" — which an authorship rule can never express, and which left
 *    assign-without-withdraw as an asymmetry in the registry.
 *  - COU-004 org ownership: a course belongs to the ORGANIZATION, so a
 *    colleague's course is withdrawable; another tenant's is not.
 *  - facility reach: holding the verb does not widen WHO you may act on, so a
 *    facility-bound caller must not strip an enrollment from another site's
 *    worker.
 *
 * And throughout: refusals are RETURNED, not thrown. A thrown message is
 * redacted to React error #441 in production, collapsing every distinct,
 * actionable reason into one useless "something went wrong".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuth,
  mockWorkerAuth,
  mockEnrollmentFindUnique,
  mockEnrollmentDelete,
  mockOrgUserFindMany,
  mockListAccessibleFacilities,
  mockInvalidatePlaybackAuthz,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockEnrollmentFindUnique: vi.fn(),
  mockEnrollmentDelete: vi.fn(),
  mockOrgUserFindMany: vi.fn(),
  mockListAccessibleFacilities: vi.fn(),
  mockInvalidatePlaybackAuthz: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    enrollment: { findUnique: mockEnrollmentFindUnique, delete: mockEnrollmentDelete },
    organizationUser: { findMany: mockOrgUserFindMany },
  };
  return { prisma, default: prisma };
});
vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/video/playback-cache', () => ({
  invalidatePlaybackAuthz: mockInvalidatePlaybackAuthz,
}));
vi.mock('@/lib/facility/scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/facility/scope')>()),
  listAccessibleFacilities: mockListAccessibleFacilities,
}));

import { removeWorkerAssignment } from './enrollment';

const ORG = 'org-1';
const CREATOR_OU = 'ou-creator';
const TARGET_OU = 'ou-target';
const F1 = 'facility-1';
const F2 = 'facility-2';

function setSession(role: string, organizationUserId = CREATOR_OU) {
  mockAuth.mockResolvedValue({
    user: { id: 'user-1', organizationUserId, organizationId: ORG, role },
  });
  mockWorkerAuth.mockResolvedValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSession('owner');
  mockEnrollmentFindUnique.mockResolvedValue({
    id: 'enr-1',
    organizationUserId: TARGET_OU,
    courseId: 'course-1',
    course: { createdByOrgUserId: CREATOR_OU, creator: { organizationId: ORG } },
  });
  mockOrgUserFindMany.mockResolvedValue([{ id: TARGET_OU, facilities: [{ facilityId: F1 }] }]);
  mockListAccessibleFacilities.mockResolvedValue([{ id: F1 }]);
});

describe('removeWorkerAssignment', () => {
  it('withdraws the assignment and evicts the cached playback verdict', async () => {
    const result = await removeWorkerAssignment('enr-1');

    expect(result).toEqual({ success: true });
    expect(mockEnrollmentDelete).toHaveBeenCalledWith({ where: { id: 'enr-1' } });
    // Without this the learner finishes the video they just lost access to.
    expect(mockInvalidatePlaybackAuthz).toHaveBeenCalledWith(TARGET_OU, 'course-1');
  });

  // COU-004: authorship is NOT the gate. This is the exact case the old
  // creator-only rule refused — and the one Rule C depends on, since a
  // supervisor authors no courses at all.
  it('lets a caller withdraw from a colleague-authored course in the same organization', async () => {
    setSession('owner', 'ou-someone-else');

    const result = await removeWorkerAssignment('enr-1');

    expect(result).toEqual({ success: true });
    expect(mockEnrollmentDelete).toHaveBeenCalledWith({ where: { id: 'enr-1' } });
  });

  it('RETURNS a refusal when the course belongs to another organization', async () => {
    mockEnrollmentFindUnique.mockResolvedValue({
      id: 'enr-1',
      organizationUserId: TARGET_OU,
      courseId: 'course-1',
      course: { createdByOrgUserId: CREATOR_OU, creator: { organizationId: 'org-other' } },
    });

    const result = await removeWorkerAssignment('enr-1');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/does not belong to your organization/i);
    expect(mockEnrollmentDelete).not.toHaveBeenCalled();
  });

  // Rule C, the whole point of this phase.
  it('lets a supervisor withdraw from staff inside their own facility', async () => {
    setSession('supervisor', 'ou-someone-else');

    const result = await removeWorkerAssignment('enr-1');

    expect(result).toEqual({ success: true });
    expect(mockEnrollmentDelete).toHaveBeenCalledWith({ where: { id: 'enr-1' } });
  });

  // The verb is the gate, so a role without `assignment.delete` is refused
  // before any database read — the enrollment's existence is not probeable.
  // Clinical Director is deliberately absent: it holds all four assignment
  // verbs, so it withdraws here even though it is view-only on Staff Management
  // (that row governs the staff profile, not the course roster).
  it.each(['finance', 'nurse'] as const)(
    'RETURNS a refusal for %s — no assignment.delete — without reading the enrollment',
    async (role) => {
      setSession(role);

      const result = await removeWorkerAssignment('enr-1');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/do not have permission/i);
      expect(mockEnrollmentFindUnique).not.toHaveBeenCalled();
      expect(mockEnrollmentDelete).not.toHaveBeenCalled();
    },
  );

  it('RETURNS a refusal for a target outside the caller facilities', async () => {
    setSession('supervisor');
    mockOrgUserFindMany.mockResolvedValue([{ id: TARGET_OU, facilities: [{ facilityId: F2 }] }]);

    const result = await removeWorkerAssignment('enr-1');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside the facilities/i);
    expect(mockEnrollmentDelete).not.toHaveBeenCalled();
  });

  it('lets an org-wide caller withdraw across facilities', async () => {
    mockOrgUserFindMany.mockResolvedValue([{ id: TARGET_OU, facilities: [{ facilityId: F2 }] }]);

    const result = await removeWorkerAssignment('enr-1');

    expect(result).toEqual({ success: true });
  });

  it('RETURNS a refusal, not a throw, when the row is already gone', async () => {
    mockEnrollmentFindUnique.mockResolvedValue(null);

    const result = await removeWorkerAssignment('enr-1');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no longer exists/i);
  });

  it('refuses an unauthenticated caller without touching the database', async () => {
    mockAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(null);

    const result = await removeWorkerAssignment('enr-1');

    expect(result.success).toBe(false);
    expect(mockEnrollmentFindUnique).not.toHaveBeenCalled();
  });
});
