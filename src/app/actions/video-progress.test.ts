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
vi.mock('@/lib/prisma', () => ({
  prisma: {
    lesson: { findUnique: (...a: unknown[]) => mockLessonFindUnique(...a) },
    enrollment: {
      findUnique: (...a: unknown[]) => mockEnrollmentFindUnique(...a),
      update: (...a: unknown[]) => mockEnrollmentUpdate(...a),
    },
  },
}));
// gating is a real module — isQuizUnlocked is used directly by the action.
// Note: signed-URL resolution now lives in the /api/video/[lessonId] proxy
// route (see its test); getVideoPlaybackUrl only does the access pre-check and
// returns the same-origin proxy path.

import { getVideoPlaybackUrl, saveVideoProgress } from './video-progress';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeAdminSession = (uid = 'user-1') => ({ user: { id: uid } });
const makeLesson = (opts?: { createdBy?: string; enrollments?: { id: string }[] }) => ({
  id: 'lesson-1',
  videoProvider: 'self',
  videoStorageUri: 'gcs://bucket/video.mp4',
  videoDurationSeconds: 600,
  course: {
    id: 'course-1',
    createdBy: opts?.createdBy ?? 'other-user',
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
    mockAdminAuth.mockResolvedValue(makeAdminSession('user-1'));
    mockLessonFindUnique.mockResolvedValue(makeLesson({ enrollments: [{ id: 'enr-1' }] }));

    const url = await getVideoPlaybackUrl('lesson-1');

    expect(url).toBe('/api/video/lesson-1');
  });

  it('returns the proxy URL when caller is the course creator (no enrollment needed)', async () => {
    mockAdminAuth.mockResolvedValue(makeAdminSession('creator-1'));
    mockLessonFindUnique.mockResolvedValue(makeLesson({ createdBy: 'creator-1', enrollments: [] }));

    const url = await getVideoPlaybackUrl('lesson-1');
    expect(url).toBe('/api/video/lesson-1');
  });

  it('uses worker session when admin session is absent', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(makeAdminSession('worker-1'));
    mockLessonFindUnique.mockResolvedValue(makeLesson({ enrollments: [{ id: 'enr-w' }] }));

    const url = await getVideoPlaybackUrl('lesson-1');
    expect(url).toBe('/api/video/lesson-1');
    // prisma query must have been filtered by worker-1's uid
    expect(mockLessonFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          course: expect.objectContaining({
            include: expect.objectContaining({
              enrollments: expect.objectContaining({
                where: { userId: 'worker-1' },
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

  it('throws "Forbidden" when caller is neither creator nor enrolled', async () => {
    mockAdminAuth.mockResolvedValue(makeAdminSession('outsider'));
    mockLessonFindUnique.mockResolvedValue(
      makeLesson({ createdBy: 'someone-else', enrollments: [] }),
    );

    await expect(getVideoPlaybackUrl('lesson-1')).rejects.toThrow('Forbidden');
  });
});

// ---------------------------------------------------------------------------
// saveVideoProgress
// ---------------------------------------------------------------------------
describe('saveVideoProgress', () => {
  const makeEnrollment = (userId = 'user-1', status = 'enrolled') => ({
    userId,
    status,
  });

  it('updates videoPositionSeconds and progress', async () => {
    mockAdminAuth.mockResolvedValue(makeAdminSession('user-1'));
    mockEnrollmentFindUnique.mockResolvedValue(makeEnrollment('user-1', 'enrolled'));

    await saveVideoProgress('enr-1', 120, 40);

    expect(mockEnrollmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'enr-1' },
        data: expect.objectContaining({
          videoPositionSeconds: 120,
          progress: 40,
        }),
      }),
    );
  });

  it('bumps status to lessons_complete when pct >= 95 and prior status is "assigned"', async () => {
    mockAdminAuth.mockResolvedValue(makeAdminSession('user-1'));
    mockEnrollmentFindUnique.mockResolvedValue(makeEnrollment('user-1', 'assigned'));

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
    mockAdminAuth.mockResolvedValue(makeAdminSession('user-1'));
    mockEnrollmentFindUnique.mockResolvedValue(makeEnrollment('user-1', 'enrolled'));

    const result = await saveVideoProgress('enr-1', 580, 95);

    expect(result).toEqual({ unlocked: true });
    expect(mockEnrollmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'lessons_complete' }),
      }),
    );
  });

  it('does NOT bump status when pct < 95', async () => {
    mockAdminAuth.mockResolvedValue(makeAdminSession('user-1'));
    mockEnrollmentFindUnique.mockResolvedValue(makeEnrollment('user-1', 'enrolled'));

    const result = await saveVideoProgress('enr-1', 300, 60);

    expect(result).toEqual({ unlocked: false });
    const updateCall = mockEnrollmentUpdate.mock.calls[0][0];
    expect(updateCall.data).not.toHaveProperty('status');
  });

  it('does NOT bump status when pct >= 95 but status is already lessons_complete', async () => {
    mockAdminAuth.mockResolvedValue(makeAdminSession('user-1'));
    mockEnrollmentFindUnique.mockResolvedValue(makeEnrollment('user-1', 'lessons_complete'));

    await saveVideoProgress('enr-1', 580, 100);

    const updateCall = mockEnrollmentUpdate.mock.calls[0][0];
    expect(updateCall.data).not.toHaveProperty('status');
  });

  it('clamps pct > 100 to 100', async () => {
    mockAdminAuth.mockResolvedValue(makeAdminSession('user-1'));
    mockEnrollmentFindUnique.mockResolvedValue(makeEnrollment('user-1', 'enrolled'));

    await saveVideoProgress('enr-1', 600, 150);

    const updateCall = mockEnrollmentUpdate.mock.calls[0][0];
    expect(updateCall.data.progress).toBe(100);
  });

  it('clamps pct < 0 to 0', async () => {
    mockAdminAuth.mockResolvedValue(makeAdminSession('user-1'));
    mockEnrollmentFindUnique.mockResolvedValue(makeEnrollment('user-1', 'enrolled'));

    await saveVideoProgress('enr-1', 0, -10);

    const updateCall = mockEnrollmentUpdate.mock.calls[0][0];
    expect(updateCall.data.progress).toBe(0);
  });

  it('throws "Enrollment not found" when the enrollment belongs to another user', async () => {
    mockAdminAuth.mockResolvedValue(makeAdminSession('user-1'));
    mockEnrollmentFindUnique.mockResolvedValue(makeEnrollment('other-user', 'enrolled'));

    await expect(saveVideoProgress('enr-1', 100, 50)).rejects.toThrow('Enrollment not found');
    expect(mockEnrollmentUpdate).not.toHaveBeenCalled();
  });

  it('throws "Enrollment not found" when enrollment does not exist (null)', async () => {
    mockAdminAuth.mockResolvedValue(makeAdminSession('user-1'));
    mockEnrollmentFindUnique.mockResolvedValue(null);

    await expect(saveVideoProgress('enr-1', 100, 50)).rejects.toThrow('Enrollment not found');
  });

  it('throws "Unauthorized" when there is no session', async () => {
    // both auths return null (default)
    await expect(saveVideoProgress('enr-1', 100, 50)).rejects.toThrow('Unauthorized');
    expect(mockEnrollmentFindUnique).not.toHaveBeenCalled();
  });
});
