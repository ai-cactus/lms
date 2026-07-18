/**
 * Unit tests for createEnrollmentForUser (src/lib/enrollment/create.ts).
 *
 * Extracted from enrollUsers in Phase 2 (Issue #2 fix) and reused by the
 * standalone assign flow, the wizard delegation, and the role-target
 * live-auto-enroll hook. This suite focuses on behavior not already exercised
 * indirectly through enrollUsers's own tests: the cross-tenant guard (new in
 * this extraction — every caller of this shared helper now gets it "for
 * free"), invalid email handling, idempotency, and the new-vs-existing-user
 * branch (invite email vs launch email).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockCreateNotification, mockSendCourseInviteEmail, mockSendCourseLaunchEmail } =
  vi.hoisted(() => {
    const prismaMock = {
      user: { findUnique: vi.fn(), create: vi.fn() },
      profile: { upsert: vi.fn() },
      enrollment: { findFirst: vi.fn(), create: vi.fn() },
      reminderLog: { create: vi.fn() },
    };
    return {
      prismaMock,
      mockCreateNotification: vi.fn(),
      mockSendCourseInviteEmail: vi.fn(),
      mockSendCourseLaunchEmail: vi.fn(),
    };
  });

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/app/actions/notifications', () => ({ createNotification: mockCreateNotification }));
vi.mock('@/lib/email', () => ({
  sendCourseInviteEmail: mockSendCourseInviteEmail,
  sendCourseLaunchEmail: mockSendCourseLaunchEmail,
}));
vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn().mockResolvedValue('hashed-password') },
  hash: vi.fn().mockResolvedValue('hashed-password'),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));

import { createEnrollmentForUser, type CreateEnrollmentContext } from './create';

const BASE_CTX: CreateEnrollmentContext = {
  courseId: 'course-1',
  courseTitle: 'Safety Training',
  organizationId: 'org-1',
  organizationName: 'Acme Corp',
  facilityId: null,
  assignmentId: 'assignment-1',
  scheduleAt: null,
  assignmentDueAt: null,
  assignmentWindowDays: null,
  enrolledByUserId: 'admin-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.enrollment.findFirst.mockResolvedValue(null);
  prismaMock.enrollment.create.mockResolvedValue({ id: 'enrollment-1' });
  prismaMock.reminderLog.create.mockResolvedValue({ id: 'log-1' });
  mockCreateNotification.mockResolvedValue(undefined);
  mockSendCourseInviteEmail.mockResolvedValue(undefined);
  mockSendCourseLaunchEmail.mockResolvedValue(undefined);
});

describe('createEnrollmentForUser — cross-tenant guard', () => {
  it('reports failed and writes no enrollment when the email resolves to a user in a DIFFERENT organization', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-in-org-2',
      email: 'staff@example.com',
      organizationId: 'org-2', // different from ctx.organizationId ('org-1')
      profile: null,
    });

    const outcome = await createEnrollmentForUser({ email: 'staff@example.com' }, BASE_CTX);

    expect(outcome).toEqual({ status: 'failed', email: 'staff@example.com' });
    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
    expect(prismaMock.enrollment.findFirst).not.toHaveBeenCalled();
  });

  it('proceeds normally when the resolved user belongs to the SAME organization', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-in-org-1',
      email: 'staff@example.com',
      organizationId: 'org-1',
      profile: { fullName: 'Staff One' },
    });

    const outcome = await createEnrollmentForUser({ email: 'staff@example.com' }, BASE_CTX);

    expect(outcome.status).toBe('enrolled');
    expect(prismaMock.enrollment.create).toHaveBeenCalled();
  });

  it('proceeds when the existing user has no organization yet (org-less user being claimed)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-no-org',
      email: 'staff@example.com',
      organizationId: null,
      profile: null,
    });

    const outcome = await createEnrollmentForUser({ email: 'staff@example.com' }, BASE_CTX);

    expect(outcome.status).toBe('enrolled');
    expect(prismaMock.enrollment.create).toHaveBeenCalled();
  });

  it('proceeds when the caller context has no organizationId (individual/global-caller path)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-in-org-2',
      email: 'staff@example.com',
      organizationId: 'org-2',
      profile: null,
    });

    const outcome = await createEnrollmentForUser(
      { email: 'staff@example.com' },
      { ...BASE_CTX, organizationId: null },
    );

    // No caller org to violate — the guard only fires when ctx.organizationId is set.
    expect(outcome.status).toBe('enrolled');
  });
});

describe('createEnrollmentForUser — input validation', () => {
  it('rejects a malformed email without touching the database', async () => {
    const outcome = await createEnrollmentForUser({ email: 'not-an-email' }, BASE_CTX);

    expect(outcome).toEqual({ status: 'failed', email: 'not-an-email' });
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });
});

describe('createEnrollmentForUser — idempotency', () => {
  it('reports alreadyEnrolled and writes nothing when an enrollment already exists', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'staff@example.com',
      organizationId: 'org-1',
      profile: null,
    });
    prismaMock.enrollment.findFirst.mockResolvedValue({ id: 'existing-enrollment' });

    const outcome = await createEnrollmentForUser({ email: 'staff@example.com' }, BASE_CTX);

    expect(outcome).toEqual({ status: 'alreadyEnrolled', email: 'staff@example.com' });
    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
  });
});

describe('createEnrollmentForUser — new vs existing user branch', () => {
  it('creates a new user, sends the invite email (with temp password), and never sends the launch email', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: 'new-user-1',
      email: 'new@example.com',
      profile: null,
    });

    const outcome = await createEnrollmentForUser({ email: 'new@example.com' }, BASE_CTX);

    expect(outcome.status).toBe('newInvited');
    expect(mockSendCourseInviteEmail).toHaveBeenCalledWith(
      'new@example.com',
      expect.any(String),
      'Safety Training',
      'Acme Corp',
    );
    expect(mockSendCourseLaunchEmail).not.toHaveBeenCalled();
  });

  it('enrolls an existing user and sends the launch email with the computed due date', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'staff@example.com',
      organizationId: 'org-1',
      profile: { fullName: 'Staff One' },
    });

    const outcome = await createEnrollmentForUser(
      { email: 'staff@example.com' },
      { ...BASE_CTX, assignmentDueAt: new Date('2026-09-01T00:00:00Z') },
    );

    expect(outcome.status).toBe('enrolled');
    expect(mockSendCourseLaunchEmail).toHaveBeenCalledWith(
      'staff@example.com',
      'Staff One',
      'Safety Training',
      'Acme Corp',
      new Date('2026-09-01T00:00:00Z'),
    );
    expect(mockSendCourseInviteEmail).not.toHaveBeenCalled();
  });
});
