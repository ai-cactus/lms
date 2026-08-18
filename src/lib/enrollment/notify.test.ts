/**
 * Unit tests for the batched worker-notice emitter (src/lib/enrollment/notify.ts).
 *
 * This is the seam that turns N `DeferredWorkerNotification` payloads — one per
 * enrolled course, produced by `createEnrollmentForUser` when
 * `deferWorkerNotification` is set — into exactly ONE in-app notification and
 * ONE email per worker, instead of N of each.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreateNotification, mockSendCoursesAssignedEmail, mockLogger } = vi.hoisted(() => ({
  mockCreateNotification: vi.fn(),
  mockSendCoursesAssignedEmail: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/app/actions/notifications', () => ({ createNotification: mockCreateNotification }));
vi.mock('@/lib/email', () => ({ sendCoursesAssignedEmail: mockSendCoursesAssignedEmail }));
vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
  maskEmail: () => '***@masked.example',
}));

import {
  collectDeferredNotices,
  notifyCoursesAssigned,
  type AssignedCourse,
  type BatchedAssignmentNotice,
} from './notify';
import type { DeferredWorkerNotification } from './create';

function deferred(overrides: Partial<DeferredWorkerNotification> = {}): DeferredWorkerNotification {
  return {
    userId: 'user-1',
    email: 'staff@example.com',
    recipientName: 'Staff One',
    courseId: 'course-1',
    courseTitle: 'Safety Training',
    organizationName: 'Acme Corp',
    dueAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateNotification.mockResolvedValue(undefined);
  mockSendCoursesAssignedEmail.mockResolvedValue({ success: true, messageId: 'msg-1' });
});

describe('collectDeferredNotices', () => {
  it('groups deferred payloads by userId into one notice per worker', () => {
    const notices = collectDeferredNotices([
      deferred({ userId: 'user-1', courseId: 'course-1' }),
      deferred({ userId: 'user-2', courseId: 'course-1' }),
      deferred({ userId: 'user-1', courseId: 'course-2', courseTitle: 'HIPAA Basics' }),
    ]);

    expect(notices).toHaveLength(2);
    const byUser = new Map(notices.map((n) => [n.userId, n]));
    expect(byUser.get('user-1')!.courses.map((c) => c.courseId)).toEqual(['course-1', 'course-2']);
    expect(byUser.get('user-2')!.courses.map((c) => c.courseId)).toEqual(['course-1']);
  });

  it('deduplicates a repeated courseId for the same worker', () => {
    const notices = collectDeferredNotices([
      deferred({ courseId: 'course-1' }),
      deferred({ courseId: 'course-1' }),
    ]);

    expect(notices).toHaveLength(1);
    expect(notices[0].courses).toHaveLength(1);
  });

  it('preserves the order courses were assigned in (the admin selection order)', () => {
    const notices = collectDeferredNotices([
      deferred({ courseId: 'course-3', courseTitle: 'Third' }),
      deferred({ courseId: 'course-1', courseTitle: 'First' }),
      deferred({ courseId: 'course-2', courseTitle: 'Second' }),
    ]);

    expect(notices[0].courses.map((c) => c.courseTitle)).toEqual(['Third', 'First', 'Second']);
  });

  it('returns an empty array for an empty input', () => {
    expect(collectDeferredNotices([])).toEqual([]);
  });
});

function notice(courses: AssignedCourse[]): BatchedAssignmentNotice {
  return {
    userId: 'user-1',
    email: 'staff@example.com',
    recipientName: 'Staff One',
    organizationName: 'Acme Corp',
    courses,
  };
}

const dueAt = new Date('2026-09-01T00:00:00Z');

describe('notifyCoursesAssigned', () => {
  it('0 courses: performs no I/O at all', async () => {
    const result = await notifyCoursesAssigned(notice([]));

    expect(result).toEqual({ emailSent: false, notificationCreated: false, courseCount: 0 });
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockSendCoursesAssignedEmail).not.toHaveBeenCalled();
  });

  it('1 course: notification title/message are byte-identical to the pre-batch single-course strings', async () => {
    await notifyCoursesAssigned(
      notice([{ courseId: 'course-1', courseTitle: 'Safety Training', dueAt }]),
    );

    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockCreateNotification).toHaveBeenCalledWith({
      userId: 'user-1',
      type: 'COURSE_ASSIGNED',
      title: 'New Required Training Assigned',
      message: 'You have been assigned a new course: Safety Training',
      linkUrl: '/worker/trainings',
      metadata: {
        courseId: 'course-1',
        courseIds: ['course-1'],
        courseTitles: ['Safety Training'],
        count: 1,
      },
    });
  });

  it('3 courses: createNotification and the email are each called EXACTLY once, listing all 3', async () => {
    const courses: AssignedCourse[] = [
      { courseId: 'course-1', courseTitle: 'Safety Training', dueAt },
      { courseId: 'course-2', courseTitle: 'HIPAA Basics', dueAt },
      { courseId: 'course-3', courseTitle: 'Fire Safety', dueAt: null },
    ];

    const result = await notifyCoursesAssigned(notice(courses));

    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockCreateNotification).toHaveBeenCalledWith({
      userId: 'user-1',
      type: 'COURSE_ASSIGNED',
      title: '3 New Required Trainings Assigned',
      message: 'You have been assigned 3 new courses: Safety Training, HIPAA Basics, Fire Safety',
      linkUrl: '/worker/trainings',
      metadata: {
        courseId: 'course-1',
        courseIds: ['course-1', 'course-2', 'course-3'],
        courseTitles: ['Safety Training', 'HIPAA Basics', 'Fire Safety'],
        count: 3,
      },
    });

    expect(mockSendCoursesAssignedEmail).toHaveBeenCalledTimes(1);
    expect(mockSendCoursesAssignedEmail).toHaveBeenCalledWith(
      'staff@example.com',
      'Staff One',
      [
        { title: 'Safety Training', dueAt },
        { title: 'HIPAA Basics', dueAt },
        { title: 'Fire Safety', dueAt: null },
      ],
      'Acme Corp',
    );
    expect(result).toEqual({ emailSent: true, notificationCreated: true, courseCount: 3 });
  });

  it('a failing notification does not throw and does not block the email from sending', async () => {
    mockCreateNotification.mockRejectedValue(new Error('notification db down'));

    const result = await notifyCoursesAssigned(
      notice([{ courseId: 'course-1', courseTitle: 'Safety Training', dueAt }]),
    );

    expect(result.notificationCreated).toBe(false);
    expect(result.emailSent).toBe(true);
    expect(mockSendCoursesAssignedEmail).toHaveBeenCalledTimes(1);
  });

  it('a failing email does not throw and does not block the notification from being created', async () => {
    mockSendCoursesAssignedEmail.mockRejectedValue(new Error('SMTP down'));

    const result = await notifyCoursesAssigned(
      notice([{ courseId: 'course-1', courseTitle: 'Safety Training', dueAt }]),
    );

    expect(result.emailSent).toBe(false);
    expect(result.notificationCreated).toBe(true);
    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
  });

  it('an unsuccessful (but non-throwing) email result surfaces emailSent: false', async () => {
    mockSendCoursesAssignedEmail.mockResolvedValue({ success: false, error: 'no recipient' });

    const result = await notifyCoursesAssigned(
      notice([{ courseId: 'course-1', courseTitle: 'Safety Training', dueAt }]),
    );

    expect(result.emailSent).toBe(false);
  });

  it('never logs a raw email address — only the masked form', async () => {
    mockSendCoursesAssignedEmail.mockRejectedValue(new Error('SMTP down'));

    await notifyCoursesAssigned(
      notice([{ courseId: 'course-1', courseTitle: 'Safety Training', dueAt }]),
    );

    for (const call of [...mockLogger.info.mock.calls, ...mockLogger.error.mock.calls]) {
      expect(JSON.stringify(call)).not.toContain('staff@example.com');
    }
  });
});
