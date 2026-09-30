/**
 * Unit tests for assignRetake (src/app/actions/course.ts) — previously
 * untested. An admin/manager forces a retake on a LOCKED enrollment (distinct
 * from retakeQuiz, which is the worker's own self-service retake).
 *
 * Covers: the `enrollment.create` RBAC gate (not `enrollment.edit`, which
 * every role — including read-only Supervisor — holds as a self-service
 * permission), not-found/not-locked guards, the "one active retake at a time"
 * guard, and facility stamping — the new retake is resolved FRESH via
 * resolveMemberFacilityId rather than inherited from the locked enrollment —
 * and the retake's due date (Q-26): picked, defaulted, or refused.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
vi.mock('@/lib/notifications/create', () => ({
  createNotification: mockCreateNotification,
  notifyOrganizationAdmins: vi.fn(),
}));

import { assignRetake } from './course';
import { ARCHIVED_COURSE_ADMIN_MESSAGE } from '@/lib/course/archived';

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

  // Returned rather than thrown: Next.js redacts Server Action errors in
  // production, so a thrown reason reached AssignRetakeModal as React error #441.
  it('refuses when the enrollment is not locked', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeLockedEnrollment({ status: 'completed' }),
    );

    const result = await assignRetake(ENROLLMENT_ID);

    expect(result).toEqual({
      success: false,
      refusedReason:
        "This learner hasn't failed the assessment yet — retakes are only available once all attempts are used.",
    });
    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
  });

  it('refuses when an active retake already exists for this enrollment', async () => {
    prismaMock.enrollment.findFirst.mockResolvedValue({ id: 'existing-retake' });

    const result = await assignRetake(ENROLLMENT_ID);

    expect(result).toEqual({
      success: false,
      refusedReason: 'This learner already has a retake in progress for this course.',
    });
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

  // Regression guard for enrollments.last_activity_at (dormant-staff reporting):
  // an admin forcing a retake is not the learner engaging, so the new
  // enrollment must be minted with no stamp at all — `objectContaining` in the
  // tests above would silently accept one being added, so this checks directly.
  it('never stamps lastActivityAt — an admin-assigned retake is not learner engagement', async () => {
    await assignRetake(ENROLLMENT_ID, 'Failed prior attempt');

    const { data } = prismaMock.enrollment.create.mock.calls[0][0];
    expect(data).not.toHaveProperty('lastActivityAt');
  });
});

/**
 * Q-26 (ruled 2026-09-28): the admin picks the retake's due date, pre-filled 14
 * days out, and the retake then gets the normal reminder/escalation ladder —
 * which selects on `dueAt`, so a retake without one was invisible to it.
 */
describe('assignRetake — due date (Q-26)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-28T15:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores the picked date as the retake deadline, due at the end of that UTC day', async () => {
    const result = await assignRetake(ENROLLMENT_ID, 'Second chance', '2026-10-05');

    expect(result.success).toBe(true);
    expect(prismaMock.enrollment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ dueAt: new Date('2026-10-05T23:59:00.000Z') }),
    });
  });

  it('accepts today — the deadline has not passed yet', async () => {
    await assignRetake(ENROLLMENT_ID, '', '2026-09-28');

    expect(prismaMock.enrollment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ dueAt: new Date('2026-09-28T23:59:00.000Z') }),
    });
  });

  it('defaults to 14 days out when the caller passes no date, so no retake escapes the ladder', async () => {
    await assignRetake(ENROLLMENT_ID);

    expect(prismaMock.enrollment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ dueAt: new Date('2026-10-12T23:59:00.000Z') }),
    });
  });

  it.each([
    ['a past date', '2026-09-27', 'The retake due date must be today or later.'],
    [
      'an impossible date',
      '2026-02-31',
      "That due date couldn't be read. Please pick the date again.",
    ],
    ['garbage', 'not-a-date', "That due date couldn't be read. Please pick the date again."],
    ['an empty string', '', "That due date couldn't be read. Please pick the date again."],
  ])(
    'refuses %s by return, before reading or writing anything',
    async (_label, dueDate, reason) => {
      const result = await assignRetake(ENROLLMENT_ID, '', dueDate);

      expect(result).toEqual({ success: false, refusedReason: reason });
      expect(prismaMock.enrollment.findUnique).not.toHaveBeenCalled();
      expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
      expect(mockCreateNotification).not.toHaveBeenCalled();
    },
  );

  it('refuses a non-string due date smuggled through the Server Action boundary', async () => {
    const result = await assignRetake(ENROLLMENT_ID, '', 12345 as unknown as string);

    expect(result.success).toBe(false);
    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
  });

  it('still checks permissions before validating the date', async () => {
    mockAdminAuth.mockResolvedValue(makeSession('finance'));

    await expect(assignRetake(ENROLLMENT_ID, '', 'not-a-date')).rejects.toThrow(
      'Insufficient permissions',
    );
  });
});

/**
 * Founder Q-04 (2026-09-23): an archived course cannot be retaken.
 *
 * `assignRetake` is the only surviving path that would mint a BRAND-NEW
 * enrollment on retired training. The assignment paths reach the Course row
 * through a top-level read that the archive query extension filters; here the
 * course arrives on a nested include, which the extension cannot touch, so the
 * refusal has to be stated in the action.
 */
describe('assignRetake — archived course', () => {
  it('refuses, and creates no retake enrollment and no notification', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeLockedEnrollment({
        course: { title: 'Infection Control', archivedAt: new Date('2026-09-20') },
      }),
    );

    const result = await assignRetake(ENROLLMENT_ID);

    expect(result).toEqual({
      success: false,
      refusedReason: ARCHIVED_COURSE_ADMIN_MESSAGE,
    });
    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it('refuses even though the enrollment is locked — being locked is not an exemption', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeLockedEnrollment({
        status: 'locked',
        course: { title: 'Infection Control', archivedAt: new Date('2026-09-20') },
      }),
    );

    const result = await assignRetake(ENROLLMENT_ID, 'Manager override');

    expect(result.refusedReason).toBe(ARCHIVED_COURSE_ADMIN_MESSAGE);
    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
  });

  it('CONTROL: the same retake is assigned while the course is live', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeLockedEnrollment({ course: { title: 'Infection Control', archivedAt: null } }),
    );

    await expect(assignRetake(ENROLLMENT_ID)).resolves.toEqual({
      success: true,
      retakeEnrollmentId: 'retake-enrollment-1',
    });
  });
});
