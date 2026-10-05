import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — fns must be created here so the vi.mock factories can reference
// them before module evaluation happens.
// ---------------------------------------------------------------------------
const {
  mockAdminAuth,
  mockWorkerAuth,
  mockLessonFindUnique,
  mockEnrollmentFindUnique,
  mockEnrollmentUpdate,
} = vi.hoisted(() => {
  return {
    mockAdminAuth: vi.fn(),
    mockWorkerAuth: vi.fn(),
    mockLessonFindUnique: vi.fn(),
    mockEnrollmentFindUnique: vi.fn(),
    mockEnrollmentUpdate: vi.fn(),
  };
});

vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('@/lib/prisma', () => {
  const prisma = {
    lesson: { findUnique: (...a: unknown[]) => mockLessonFindUnique(...a) },
    enrollment: {
      findUnique: (...a: unknown[]) => mockEnrollmentFindUnique(...a),
      update: (...a: unknown[]) => mockEnrollmentUpdate(...a),
    },
  };
  return { prisma, default: prisma };
});
// gating is a real module — isQuizUnlocked is used directly by the action.
// Note: signed-URL resolution now lives in the /api/video/[lessonId] proxy
// route (see its test); getVideoPlaybackUrl only does the access pre-check and
// returns the same-origin proxy path.

import { getVideoPlaybackUrl, saveVideoProgress } from './video-progress';
import { ARCHIVED_COURSE_LEARNER_MESSAGE } from '@/lib/course/archived';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeAdminSession = (organizationUserId = 'ou-1') => ({
  user: { id: 'user-1', organizationUserId, organizationId: 'org-1' },
});
const makeLesson = (opts?: {
  /** The course's OWNING organisation (RISK-15). */
  organizationId?: string;
  enrollments?: { id: string }[];
  archivedAt?: Date | null;
}) => ({
  id: 'lesson-1',
  videoProvider: 'self',
  videoStorageUri: 'gcs://bucket/video.mp4',
  videoDurationSeconds: 600,
  course: {
    id: 'course-1',
    organizationId: opts?.organizationId ?? 'org-other',
    isGlobal: false,
    status: 'published',
    type: 'video',
    archivedAt: opts?.archivedAt ?? null,
    enrollments: opts?.enrollments ?? [],
  },
});

// ---------------------------------------------------------------------------
// Reset all mocks before each test
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();
  // Default: no session
  mockAdminAuth.mockResolvedValue(null);
  mockWorkerAuth.mockResolvedValue(null);
  mockEnrollmentUpdate.mockResolvedValue({});
});

// ---------------------------------------------------------------------------
// getVideoPlaybackUrl
// ---------------------------------------------------------------------------
describe('getVideoPlaybackUrl', () => {
  it('returns the same-origin proxy URL when caller is enrolled in the course', async () => {
    mockAdminAuth.mockResolvedValue(makeAdminSession('ou-1'));
    mockLessonFindUnique.mockResolvedValue(makeLesson({ enrollments: [{ id: 'enr-1' }] }));

    const url = await getVideoPlaybackUrl('lesson-1');

    expect(url).toBe('/api/video/lesson-1');
  });

  // RISK-15: review access follows the course's owning organisation.
  it('returns the proxy URL to a manager of the owning organisation (no enrollment needed)', async () => {
    mockAdminAuth.mockResolvedValue({
      user: { ...makeAdminSession('ou-manager').user, role: 'admin' },
    });
    mockLessonFindUnique.mockResolvedValue(
      makeLesson({ organizationId: 'org-1', enrollments: [] }),
    );

    const url = await getVideoPlaybackUrl('lesson-1');
    expect(url).toBe('/api/video/lesson-1');
  });

  it('refuses a manager of another organisation, such as the one the author moved to', async () => {
    mockAdminAuth.mockResolvedValue({
      user: { id: 'user-2', organizationUserId: 'ou-2', organizationId: 'org-2', role: 'owner' },
    });
    mockLessonFindUnique.mockResolvedValue(
      makeLesson({ organizationId: 'org-1', enrollments: [] }),
    );

    await expect(getVideoPlaybackUrl('lesson-1')).rejects.toThrow('Forbidden');
  });

  it('uses worker session when admin session is absent', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(makeAdminSession('ou-worker'));
    mockLessonFindUnique.mockResolvedValue(makeLesson({ enrollments: [{ id: 'enr-w' }] }));

    const url = await getVideoPlaybackUrl('lesson-1');
    expect(url).toBe('/api/video/lesson-1');
    // prisma query must have been filtered by the worker session's active organizationUserId
    expect(mockLessonFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          course: expect.objectContaining({
            include: expect.objectContaining({
              enrollments: expect.objectContaining({
                where: { organizationUserId: 'ou-worker' },
              }),
            }),
          }),
        }),
      }),
    );
  });

  it('throws "Unauthorized" when there is no session', async () => {
    // both auths return null (default)
    await expect(getVideoPlaybackUrl('lesson-1')).rejects.toThrow('Unauthorized');
    expect(mockLessonFindUnique).not.toHaveBeenCalled();
  });

  it('throws "Forbidden" when caller neither manages the owning organisation nor is enrolled', async () => {
    mockAdminAuth.mockResolvedValue(makeAdminSession('ou-outsider'));
    mockLessonFindUnique.mockResolvedValue(
      makeLesson({ organizationId: 'org-someone', enrollments: [] }),
    );

    await expect(getVideoPlaybackUrl('lesson-1')).rejects.toThrow('Forbidden');
  });
});

// ---------------------------------------------------------------------------
// saveVideoProgress
// ---------------------------------------------------------------------------
describe('saveVideoProgress', () => {
  const makeEnrollment = (
    organizationUserId = 'ou-1',
    status = 'enrolled',
    archivedAt: Date | null = null,
    progress = 0,
    subscription: { status: string; pausedAt: Date | null } | null = {
      status: 'active',
      pausedAt: null,
    },
  ) => ({
    organizationUserId,
    status,
    progress,
    course: { archivedAt },
    organizationUser: { organization: { subscription } },
  });

  it('updates videoPositionSeconds and progress', async () => {
    mockAdminAuth.mockResolvedValue(makeAdminSession('ou-1'));
    mockEnrollmentFindUnique.mockResolvedValue(makeEnrollment('ou-1', 'enrolled'));

    await saveVideoProgress('enr-1', 120, 40);

    expect(mockEnrollmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'enr-1' },
        data: expect.objectContaining({
          videoPositionSeconds: 120,
          progress: 40,
          lastActivityAt: expect.any(Date),
        }),
      }),
    );
  });

  it('bumps status to lessons_complete when pct >= 95 and prior status is "assigned"', async () => {
    mockAdminAuth.mockResolvedValue(makeAdminSession('ou-1'));
    mockEnrollmentFindUnique.mockResolvedValue(makeEnrollment('ou-1', 'assigned'));

    const result = await saveVideoProgress('enr-1', 580, 96);

    expect(result).toEqual({ unlocked: true });
    expect(mockEnrollmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'lessons_complete',
          progress: 96,
        }),
      }),
    );
  });

  it('bumps status to lessons_complete when pct >= 95 and prior status is "enrolled"', async () => {
    mockAdminAuth.mockResolvedValue(makeAdminSession('ou-1'));
    mockEnrollmentFindUnique.mockResolvedValue(makeEnrollment('ou-1', 'enrolled'));

    const result = await saveVideoProgress('enr-1', 580, 95);

    expect(result).toEqual({ unlocked: true });
    expect(mockEnrollmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'lessons_complete' }),
      }),
    );
  });

  it('does NOT bump status when pct < 95', async () => {
    mockAdminAuth.mockResolvedValue(makeAdminSession('ou-1'));
    mockEnrollmentFindUnique.mockResolvedValue(makeEnrollment('ou-1', 'enrolled'));

    const result = await saveVideoProgress('enr-1', 300, 60);

    expect(result).toEqual({ unlocked: false });
    const updateCall = mockEnrollmentUpdate.mock.calls[0][0];
    expect(updateCall.data).not.toHaveProperty('status');
  });

  it('does NOT bump status when pct >= 95 but status is already lessons_complete', async () => {
    mockAdminAuth.mockResolvedValue(makeAdminSession('ou-1'));
    mockEnrollmentFindUnique.mockResolvedValue(makeEnrollment('ou-1', 'lessons_complete'));

    await saveVideoProgress('enr-1', 580, 100);

    const updateCall = mockEnrollmentUpdate.mock.calls[0][0];
    expect(updateCall.data).not.toHaveProperty('status');
  });

  it('clamps pct > 100 to 100', async () => {
    mockAdminAuth.mockResolvedValue(makeAdminSession('ou-1'));
    mockEnrollmentFindUnique.mockResolvedValue(makeEnrollment('ou-1', 'enrolled'));

    await saveVideoProgress('enr-1', 600, 150);

    const updateCall = mockEnrollmentUpdate.mock.calls[0][0];
    expect(updateCall.data.progress).toBe(100);
  });

  it('clamps pct < 0 to 0', async () => {
    mockAdminAuth.mockResolvedValue(makeAdminSession('ou-1'));
    mockEnrollmentFindUnique.mockResolvedValue(makeEnrollment('ou-1', 'enrolled'));

    await saveVideoProgress('enr-1', 0, -10);

    const updateCall = mockEnrollmentUpdate.mock.calls[0][0];
    expect(updateCall.data.progress).toBe(0);
  });

  // BUG-53: the watch gate may only lift an unstarted enrolment into the
  // reading phase's last step. Everything past that is owned by the quiz, the
  // attestation or an admin.
  it.each(['in_progress', 'completed', 'attested', 'locked', 'failed', 'retry_requested'])(
    'never writes a status over "%s", even when the watch gate is met',
    async (status) => {
      mockAdminAuth.mockResolvedValue(makeAdminSession('ou-1'));
      mockEnrollmentFindUnique.mockResolvedValue(makeEnrollment('ou-1', status, null, 100));

      await saveVideoProgress('enr-1', 600, 100);

      const updateCall = mockEnrollmentUpdate.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty('status');
    },
  );

  it('never pulls progress below its high-water mark (the quiz submit stamps 100)', async () => {
    mockAdminAuth.mockResolvedValue(makeAdminSession('ou-1'));
    mockEnrollmentFindUnique.mockResolvedValue(makeEnrollment('ou-1', 'attested', null, 100));

    await saveVideoProgress('enr-1', 30, 12);

    const updateCall = mockEnrollmentUpdate.mock.calls[0][0];
    expect(updateCall.data.progress).toBe(100);
    expect(updateCall.data.videoPositionSeconds).toBe(30);
  });

  it('throws "Enrollment not found" when the enrollment belongs to another user', async () => {
    mockAdminAuth.mockResolvedValue(makeAdminSession('ou-1'));
    mockEnrollmentFindUnique.mockResolvedValue(makeEnrollment('other-ou', 'enrolled'));

    await expect(saveVideoProgress('enr-1', 100, 50)).rejects.toThrow('Enrollment not found');
    expect(mockEnrollmentUpdate).not.toHaveBeenCalled();
  });

  it('throws "Enrollment not found" when enrollment does not exist (null)', async () => {
    mockAdminAuth.mockResolvedValue(makeAdminSession('ou-1'));
    mockEnrollmentFindUnique.mockResolvedValue(null);

    await expect(saveVideoProgress('enr-1', 100, 50)).rejects.toThrow('Enrollment not found');
  });

  it('throws "Unauthorized" when there is no session', async () => {
    // both auths return null (default)
    await expect(saveVideoProgress('enr-1', 100, 50)).rejects.toThrow('Unauthorized');
    expect(mockEnrollmentFindUnique).not.toHaveBeenCalled();
  });

  /**
   * Founder Q-04 (2026-09-23): watching on is the learner advancing through the
   * course, so it stops at the archive. Refused by RETURN rather than thrown —
   * unlike the ownership failures above, this is a policy decision the learner
   * can be told about, and a thrown Server Action message is redacted in
   * production.
   */
  it('refuses an archived course by return, writing no position and no status bump', async () => {
    mockAdminAuth.mockResolvedValue(makeAdminSession('ou-1'));
    mockEnrollmentFindUnique.mockResolvedValue(
      makeEnrollment('ou-1', 'enrolled', new Date('2026-09-20')),
    );

    const result = await saveVideoProgress('enr-1', 900, 99);

    expect(result).toEqual({
      unlocked: false,
      refusedReason: ARCHIVED_COURSE_LEARNER_MESSAGE,
      refusedCode: 'COURSE_ARCHIVED',
    });
    expect(mockEnrollmentUpdate).not.toHaveBeenCalled();
  });

  /**
   * SEC-08 item 4: the same guards #700 gave the lesson-progress route — MFA
   * step-up and the billing gate — refused by return, before any write.
   */
  it('refuses a session whose MFA step-up is incomplete, writing nothing', async () => {
    mockAdminAuth.mockResolvedValue({
      user: { ...makeAdminSession('ou-1').user, mfaEnabled: true, mfaVerified: false },
    });
    mockEnrollmentFindUnique.mockResolvedValue(makeEnrollment('ou-1', 'enrolled'));

    const result = await saveVideoProgress('enr-1', 580, 99);

    expect(result).toEqual({
      unlocked: false,
      refusedReason: 'Please complete two-factor verification to continue.',
      refusedCode: 'MFA_REQUIRED',
    });
    expect(mockEnrollmentUpdate).not.toHaveBeenCalled();
  });

  it('accepts a session that has completed its MFA step-up', async () => {
    mockAdminAuth.mockResolvedValue({
      user: { ...makeAdminSession('ou-1').user, mfaEnabled: true, mfaVerified: true },
    });
    mockEnrollmentFindUnique.mockResolvedValue(makeEnrollment('ou-1', 'enrolled'));

    await expect(saveVideoProgress('enr-1', 120, 40)).resolves.toEqual({ unlocked: false });
    expect(mockEnrollmentUpdate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a paused subscription', { status: 'active', pausedAt: new Date('2026-09-01') }],
    ['a cancelled subscription', { status: 'canceled', pausedAt: null }],
    ['no subscription at all', null],
  ])('refuses %s by return, writing nothing', async (_label, subscription) => {
    mockAdminAuth.mockResolvedValue(makeAdminSession('ou-1'));
    mockEnrollmentFindUnique.mockResolvedValue(
      makeEnrollment('ou-1', 'enrolled', null, 0, subscription),
    );

    const result = await saveVideoProgress('enr-1', 580, 99);

    expect(result).toEqual({
      unlocked: false,
      refusedReason:
        'Your organization’s training access is paused. Please contact your administrator.',
      refusedCode: 'BILLING_INACTIVE',
    });
    expect(mockEnrollmentUpdate).not.toHaveBeenCalled();
  });

  it('writes as the worker session when it, not the admin session, owns the enrolment', async () => {
    // One browser can hold both portals for two different accounts.
    mockAdminAuth.mockResolvedValue(makeAdminSession('ou-admin'));
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'user-2', organizationUserId: 'ou-worker', organizationId: 'org-1' },
    });
    mockEnrollmentFindUnique.mockResolvedValue(makeEnrollment('ou-worker', 'enrolled'));

    await saveVideoProgress('enr-1', 120, 40);

    expect(mockEnrollmentUpdate).toHaveBeenCalledTimes(1);
  });

  it('checks MFA on the owning session, not on the other portal', async () => {
    mockAdminAuth.mockResolvedValue(makeAdminSession('ou-admin'));
    mockWorkerAuth.mockResolvedValue({
      user: {
        id: 'user-2',
        organizationUserId: 'ou-worker',
        organizationId: 'org-1',
        mfaEnabled: true,
        mfaVerified: false,
      },
    });
    mockEnrollmentFindUnique.mockResolvedValue(makeEnrollment('ou-worker', 'enrolled'));

    const result = await saveVideoProgress('enr-1', 120, 40);

    expect(result.refusedReason).toBe('Please complete two-factor verification to continue.');
    expect(mockEnrollmentUpdate).not.toHaveBeenCalled();
  });
});

describe('getVideoPlaybackUrl — archived course (Q-04)', () => {
  it('refuses playback even to the enrolled learner', async () => {
    mockAdminAuth.mockResolvedValue(makeAdminSession('ou-worker'));
    mockLessonFindUnique.mockResolvedValue(
      makeLesson({ archivedAt: new Date('2026-09-20'), enrollments: [{ id: 'enr-1' }] }),
    );

    await expect(getVideoPlaybackUrl('lesson-1')).rejects.toThrow('Forbidden');
  });
});
