/**
 * Unit tests for assignRetake (src/app/actions/course.ts) — previously
 * untested. An admin/manager forces a retake on a LOCKED enrollment (distinct
 * from retakeQuiz, which is the worker's own self-service retake).
 *
 * Covers: the `enrollment.create` RBAC gate (not `enrollment.edit`, which
 * every role — including read-only Supervisor — holds as a self-service
 * permission), not-found/not-locked guards, the "one active retake at a time"
 * guard, and facility stamping — the new retake is resolved FRESH via
 * resolveMemberFacilityId rather than inherited from the locked enrollment.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockAdminAuth, mockWorkerAuth, mockRevalidatePath, mockCreateNotification } =
  vi.hoisted(() => {
    const prismaMock = {
      enrollment: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
      notification: { updateMany: vi.fn() },
      organizationUserFacility: { findFirst: vi.fn() },
    };
    return {
      prismaMock,
      mockAdminAuth: vi.fn(),
      mockWorkerAuth: vi.fn(),
      mockRevalidatePath: vi.fn(),
      mockCreateNotification: vi.fn(),
    };
  });

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// assignRetake dynamically imports './notifications' for createNotification.
vi.mock('./notifications', () => ({ createNotification: mockCreateNotification }));

import { assignRetake } from './course';

const ADMIN_ID = 'admin-1';
const ENROLLMENT_ID = 'enrollment-locked-1';

function makeSession(role: string, overrides: Record<string, unknown> = {}) {
  return {
    user: {
      id: ADMIN_ID,
      organizationId: 'org-1',
      organizationUserId: 'ou-admin',
      role,
      ...overrides,
    },
  };
}

function makeLockedEnrollment(overrides: Record<string, unknown> = {}) {
  return {
    id: ENROLLMENT_ID,
    organizationUserId: 'ou-worker-1',
    courseId: 'course-1',
    status: 'locked',
    organizationUser: { user: { email: 'worker@acme.com' } },
    course: { title: 'Infection Control' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(makeSession('owner'));
  mockWorkerAuth.mockResolvedValue(null);
  prismaMock.enrollment.findUnique.mockResolvedValue(makeLockedEnrollment());
  prismaMock.enrollment.findFirst.mockResolvedValue(null); // no existing active retake
  prismaMock.enrollment.create.mockResolvedValue({ id: 'retake-enrollment-1' });
  prismaMock.notification.updateMany.mockResolvedValue({ count: 0 });
  prismaMock.organizationUserFacility.findFirst.mockResolvedValue(null);
  mockCreateNotification.mockResolvedValue(undefined);
});

describe('assignRetake — auth / RBAC gate', () => {
  it('throws Unauthorized when there is no session', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(null);

    await expect(assignRetake(ENROLLMENT_ID)).rejects.toThrow('Unauthorized');
  });

  // REVERSED 2026-08-25. This asserted that supervisor — then a read-only role —
  // could not force a retake. Team QA section 3.1 / C8 makes supervisors
  // assigners: "they can assign existing courses to existing staff". A retake
  // re-issues an existing course to an existing staff member, so it falls under
  // that grant, and supervisor now holds enrollment.create.
  //
  // NOTE FOR REVIEW: C8 does not say "retake" in so many words — this is an
  // inference from its wording. If retakes are meant to stay owner/admin/HR
  // only, assignRetake needs its own permission rather than reusing
  // enrollment.create, and this test should go back to denying.
  it('allows supervisor — a retake re-assigns an existing course to existing staff (C8)', async () => {
    mockAdminAuth.mockResolvedValue(makeSession('supervisor'));

    await expect(assignRetake(ENROLLMENT_ID)).resolves.toBeDefined();
  });

  it('still denies finance — no enrollment.create', async () => {
    mockAdminAuth.mockResolvedValue(makeSession('finance'));

    await expect(assignRetake(ENROLLMENT_ID)).rejects.toThrow('Insufficient permissions');
    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
  });

  it.each(['owner', 'admin', 'hr', 'clinical_director'])(
    'allows role=%s (holds enrollment.create)',
    async (role) => {
      mockAdminAuth.mockResolvedValue(makeSession(role));

      const result = await assignRetake(ENROLLMENT_ID);

      expect(result).toEqual({ success: true, retakeEnrollmentId: 'retake-enrollment-1' });
    },
  );
});

describe('assignRetake — guards', () => {
  it('throws when the enrollment does not exist', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(null);

    await expect(assignRetake(ENROLLMENT_ID)).rejects.toThrow('Enrollment not found');
  });

  it('throws when the enrollment is not locked', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeLockedEnrollment({ status: 'completed' }),
    );

    await expect(assignRetake(ENROLLMENT_ID)).rejects.toThrow('Enrollment is not locked');
    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
  });

  it('throws when an active retake already exists for this enrollment', async () => {
    prismaMock.enrollment.findFirst.mockResolvedValue({ id: 'existing-retake' });

    await expect(assignRetake(ENROLLMENT_ID)).rejects.toThrow(
      'An active retake already exists for this enrollment',
    );
    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
  });
});

describe('assignRetake — facility stamping', () => {
  it("stamps the new retake with the member's CURRENT facility, resolved fresh (not inherited from the locked enrollment)", async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeLockedEnrollment({ facilityId: 'fac-stale-old-facility' }),
    );
    prismaMock.organizationUserFacility.findFirst.mockResolvedValue({ facilityId: 'fac-current' });

    await assignRetake(ENROLLMENT_ID);

    expect(prismaMock.organizationUserFacility.findFirst).toHaveBeenCalledWith({
      where: { organizationUserId: 'ou-worker-1', active: true },
      orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      select: { facilityId: true },
    });
    expect(prismaMock.enrollment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ facilityId: 'fac-current' }),
    });
  });

  it('stamps facilityId: null when the member has no active facility assignment', async () => {
    prismaMock.organizationUserFacility.findFirst.mockResolvedValue(null);

    await assignRetake(ENROLLMENT_ID);

    expect(prismaMock.enrollment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ facilityId: null }),
    });
  });
});

describe('assignRetake — retake enrollment shape', () => {
  it('carries the retake reason, resets progress to 100 and links retakeOf to the locked enrollment', async () => {
    await assignRetake(ENROLLMENT_ID, 'Failed prior attempt');

    expect(prismaMock.enrollment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationUserId: 'ou-worker-1',
        courseId: 'course-1',
        status: 'enrolled',
        progress: 100,
        retakeOf: ENROLLMENT_ID,
        retakeReason: 'Failed prior attempt',
        assignedByAdminId: ADMIN_ID,
      }),
    });
  });

  it('defaults retakeReason to null when omitted', async () => {
    await assignRetake(ENROLLMENT_ID);

    expect(prismaMock.enrollment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ retakeReason: null }),
    });
  });

  it('notifies the affected worker of the assigned retake', async () => {
    await assignRetake(ENROLLMENT_ID);

    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationUserId: 'ou-worker-1',
        type: 'RETAKE_ASSIGNED',
        metadata: expect.objectContaining({
          enrollmentId: 'retake-enrollment-1',
          parentEnrollmentId: ENROLLMENT_ID,
        }),
      }),
    );
  });
});
