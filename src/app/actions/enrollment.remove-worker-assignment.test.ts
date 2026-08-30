/**
 * Withdrawing an assignment.
 *
 * The action existed with no caller anywhere in the product — an assignment
 * could be created and never withdrawn. Wiring it to the UI makes its contract
 * load-bearing for the first time, so it is pinned here:
 *
 *  - refusals are RETURNED, not thrown. A thrown message is redacted to React
 *    error #441 in production, collapsing three distinct, actionable reasons
 *    into one useless "something went wrong".
 *  - creating a course does not widen WHO you may act on: a facility-bound
 *    creator must not strip an enrollment from another site's worker.
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
    course: { createdByOrgUserId: CREATOR_OU },
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

  it('RETURNS a refusal when the caller did not create the course', async () => {
    setSession('owner', 'ou-someone-else');

    const result = await removeWorkerAssignment('enr-1');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/created this course/i);
    expect(mockEnrollmentDelete).not.toHaveBeenCalled();
  });

  it('RETURNS a refusal for a target outside the caller facilities', async () => {
    setSession('supervisor');
    mockOrgUserFindMany.mockResolvedValue([{ id: TARGET_OU, facilities: [{ facilityId: F2 }] }]);

    const result = await removeWorkerAssignment('enr-1');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside the facilities/i);
    expect(mockEnrollmentDelete).not.toHaveBeenCalled();
  });

  it('lets an org-wide creator withdraw across facilities', async () => {
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
