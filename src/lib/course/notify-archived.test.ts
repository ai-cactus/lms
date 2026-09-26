/**
 * Founder Q-05 (2026-09-23): archiving never blocks on live enrolments, but the
 * active learners MUST be told the course is cancelled.
 *
 * What these pin, beyond "a row is written":
 *  - WHO counts as active — everyone short of `attested`, and only members who
 *    are still active in the organization;
 *  - that the write is BATCHED (`createMany`), because a mandatory course can
 *    carry hundreds of enrolments behind a Server Action an admin is waiting on;
 *  - that a membership holding two enrolments on the same course (a retake
 *    alongside its locked original) gets ONE notice, not two;
 *  - that the function never throws — the archive is already committed by the
 *    time it runs, so a failure here must not surface as a failed delete.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockIsNotificationChannelEnabled } = vi.hoisted(() => ({
  prismaMock: {
    enrollment: { findMany: vi.fn() },
    notificationPreference: { findMany: vi.fn() },
    notification: { createMany: vi.fn() },
  },
  mockIsNotificationChannelEnabled: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/notifications/category-preferences', () => ({
  isNotificationChannelEnabled: mockIsNotificationChannelEnabled,
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { notifyLearnersCourseCancelled } from './notify-archived';

const COURSE = { id: 'course-1', title: 'Infection Control' };

function learner(id: string, organizationId = 'org-1') {
  return { organizationUser: { id, organizationId } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsNotificationChannelEnabled.mockResolvedValue(true);
  prismaMock.notificationPreference.findMany.mockResolvedValue([]);
  prismaMock.notification.createMany.mockResolvedValue({ count: 0 });
});

describe('notifyLearnersCourseCancelled — who is told', () => {
  it('queries only non-attested enrolments held by active members', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([]);

    await notifyLearnersCourseCancelled(COURSE);

    expect(prismaMock.enrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          courseId: 'course-1',
          status: { not: 'attested' },
          organizationUser: { is: { active: true } },
        },
      }),
    );
  });

  it('writes one batched notice per membership and reports the count', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([learner('ou-1'), learner('ou-2')]);

    const result = await notifyLearnersCourseCancelled(COURSE);

    expect(result).toEqual({ notifiedCount: 2 });
    expect(prismaMock.notification.createMany).toHaveBeenCalledTimes(1);
    const [{ data }] = prismaMock.notification.createMany.mock.calls[0];
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({
      organizationUserId: 'ou-1',
      type: 'COURSE_CANCELLED',
      linkUrl: '/worker/trainings',
      metadata: { courseId: 'course-1', courseTitle: 'Infection Control' },
    });
    expect(data[0].message).toContain('Infection Control');
  });

  it('deduplicates a membership holding several enrolments on the same course', async () => {
    // A retake sits alongside its locked original — one learner, two rows.
    prismaMock.enrollment.findMany.mockResolvedValue([learner('ou-1'), learner('ou-1')]);

    const result = await notifyLearnersCourseCancelled(COURSE);

    expect(result).toEqual({ notifiedCount: 1 });
    const [{ data }] = prismaMock.notification.createMany.mock.calls[0];
    expect(data).toHaveLength(1);
  });

  it('performs no I/O at all when nobody is mid-course', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([]);

    const result = await notifyLearnersCourseCancelled(COURSE);

    expect(result).toEqual({ notifiedCount: 0 });
    expect(mockIsNotificationChannelEnabled).not.toHaveBeenCalled();
    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
  });
});

describe('notifyLearnersCourseCancelled — delivery preferences', () => {
  it('resolves the org-wide in-app switch once per organization, not once per learner', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([
      learner('ou-1', 'org-1'),
      learner('ou-2', 'org-1'),
      learner('ou-3', 'org-2'),
    ]);

    await notifyLearnersCourseCancelled(COURSE);

    expect(mockIsNotificationChannelEnabled).toHaveBeenCalledTimes(2);
  });

  it('drops only the organization that switched the category off in-app', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([
      learner('ou-1', 'org-1'),
      learner('ou-2', 'org-2'),
    ]);
    mockIsNotificationChannelEnabled.mockImplementation(
      async (organizationId: string) => organizationId === 'org-1',
    );

    const result = await notifyLearnersCourseCancelled(COURSE);

    expect(result).toEqual({ notifiedCount: 1 });
    const [{ data }] = prismaMock.notification.createMany.mock.calls[0];
    expect(data).toEqual([expect.objectContaining({ organizationUserId: 'ou-1' })]);
  });

  it('skips a learner who opted out of this notification type', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([learner('ou-1'), learner('ou-2')]);
    prismaMock.notificationPreference.findMany.mockResolvedValue([{ organizationUserId: 'ou-2' }]);

    const result = await notifyLearnersCourseCancelled(COURSE);

    expect(result).toEqual({ notifiedCount: 1 });
    expect(prismaMock.notificationPreference.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationUserId: { in: ['ou-1', 'ou-2'] },
          type: 'COURSE_CANCELLED',
          enabled: false,
        },
      }),
    );
  });
});

describe('notifyLearnersCourseCancelled — never throws', () => {
  it('swallows a database failure and reports nobody notified', async () => {
    prismaMock.enrollment.findMany.mockRejectedValue(new Error('connection reset'));

    await expect(notifyLearnersCourseCancelled(COURSE)).resolves.toEqual({ notifiedCount: 0 });
  });

  it('swallows a failure in the write itself', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([learner('ou-1')]);
    prismaMock.notification.createMany.mockRejectedValue(new Error('deadlock'));

    await expect(notifyLearnersCourseCancelled(COURSE)).resolves.toEqual({ notifiedCount: 0 });
  });
});
