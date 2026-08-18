/**
 * Unit tests for createEnrollmentForUser (src/lib/enrollment/create.ts).
 *
 * fix/worker-invite unified the course-assignment flow with the staff-invite
 * flow: an unknown email (or an existing org-less account, e.g. a previously
 * removed staff member) is no longer given a premature user account with a
 * temp password — it is sent a `/join/{token}` invite with the course parked
 * on it (`InviteCourseAssignment`), materialised into a real enrollment only
 * when the invite is accepted (see invite-courses.test.ts). This suite covers
 * the cross-tenant guard, invalid-email handling, idempotency, the invite
 * branch (create vs reuse-and-refresh, CSV role mapping, email-failure
 * isolation, DB-failure isolation), and the existing-org-member branch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prismaMock, mockCreateNotification, mockSendCourseInviteEmail, mockSendCourseLaunchEmail } =
  vi.hoisted(() => {
    const prismaMock = {
      user: { findUnique: vi.fn() },
      profile: { upsert: vi.fn() },
      enrollment: { findFirst: vi.fn(), create: vi.fn() },
      reminderLog: { create: vi.fn() },
      invite: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
      inviteCourseAssignment: { upsert: vi.fn() },
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
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
  prismaMock.enrollment.findFirst.mockResolvedValue(null);
  prismaMock.enrollment.create.mockResolvedValue({ id: 'enrollment-1' });
  prismaMock.reminderLog.create.mockResolvedValue({ id: 'log-1' });
  prismaMock.invite.findFirst.mockResolvedValue(null);
  prismaMock.invite.create.mockResolvedValue({
    id: 'invite-1',
    token: 'tok-new',
    email: 'new@example.com',
    organizationId: 'org-1',
    role: 'front_desk_admin',
    expiresAt: new Date('2026-08-01T00:00:00Z'),
  });
  prismaMock.invite.update.mockResolvedValue({});
  prismaMock.inviteCourseAssignment.upsert.mockResolvedValue({ id: 'ica-1' });
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
    expect(prismaMock.invite.create).not.toHaveBeenCalled();
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

  it('invites (does not relink or enroll) when the existing user has no organization yet (org-less user being claimed)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-no-org',
      email: 'staff@example.com',
      organizationId: null,
      profile: null,
    });

    const outcome = await createEnrollmentForUser({ email: 'staff@example.com' }, BASE_CTX);

    expect(outcome).toEqual({ status: 'invited', email: 'staff@example.com' });
    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
    expect(prismaMock.enrollment.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.invite.create).toHaveBeenCalled();
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
    // The email resolves to an existing (non-org-less) user, so the existing-member
    // enroll path is reached regardless of ctx.organizationId.
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

describe('createEnrollmentForUser — idempotency (existing org member)', () => {
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

describe('createEnrollmentForUser — unknown/org-less email: invite branch', () => {
  it('creates a new pending invite, parks the course on it, and sends the /join invite email (no account, no enrollment)', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const outcome = await createEnrollmentForUser({ email: 'new@example.com' }, BASE_CTX);

    expect(outcome).toEqual({ status: 'invited', email: 'new@example.com' });

    expect(prismaMock.invite.findFirst).toHaveBeenCalledWith({
      where: { email: 'new@example.com', organizationId: 'org-1', status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    expect(prismaMock.invite.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'new@example.com',
        organizationId: 'org-1',
        role: 'front_desk_admin', // DEFAULT_SELF_SERVE_WORKER_ROLE — no explicit CSV role
        invitedBy: 'admin-1',
        status: 'pending',
        token: expect.any(String),
        expiresAt: expect.any(Date),
      }),
    });
    expect(prismaMock.inviteCourseAssignment.upsert).toHaveBeenCalledWith({
      where: { inviteId_courseId: { inviteId: 'invite-1', courseId: 'course-1' } },
      update: {},
      create: { inviteId: 'invite-1', courseId: 'course-1' },
    });

    expect(mockSendCourseInviteEmail).toHaveBeenCalledWith(
      'new@example.com',
      'https://app.example.com/join/tok-new',
      'Safety Training',
      'Acme Corp',
    );
    expect(mockSendCourseLaunchEmail).not.toHaveBeenCalled();
    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
  });

  it('maps CSV role "admin" to the invite role "supervisor"', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await createEnrollmentForUser({ email: 'newadmin@example.com', role: 'admin' }, BASE_CTX);

    expect(prismaMock.invite.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ role: 'supervisor' }) }),
    );
  });

  it('reuses an outstanding pending invite for the email, refreshing its expiry and keeping its token — no duplicate invite row', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.invite.findFirst.mockResolvedValue({
      id: 'existing-invite-1',
      token: 'existing-tok',
      email: 'new@example.com',
      organizationId: 'org-1',
      role: 'front_desk_admin',
      status: 'pending',
      expiresAt: new Date('2026-07-01T00:00:00Z'), // near-expiry
    });
    prismaMock.invite.update.mockResolvedValue({
      id: 'existing-invite-1',
      token: 'existing-tok',
      email: 'new@example.com',
      organizationId: 'org-1',
      role: 'front_desk_admin',
    });

    const outcome = await createEnrollmentForUser({ email: 'new@example.com' }, BASE_CTX);

    expect(outcome).toEqual({ status: 'invited', email: 'new@example.com' });
    expect(prismaMock.invite.create).not.toHaveBeenCalled();
    expect(prismaMock.invite.update).toHaveBeenCalledWith({
      where: { id: 'existing-invite-1' },
      data: { expiresAt: expect.any(Date) },
    });
    expect(prismaMock.inviteCourseAssignment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { inviteId_courseId: { inviteId: 'existing-invite-1', courseId: 'course-1' } },
      }),
    );
    // The SAME (existing) token is reused in the emailed link — a second course
    // assignment must not invalidate an already-shared invite link.
    expect(mockSendCourseInviteEmail).toHaveBeenCalledWith(
      'new@example.com',
      'https://app.example.com/join/existing-tok',
      'Safety Training',
      'Acme Corp',
    );
  });

  it('reports failed and creates no invite when ctx.organizationId is null for an unknown email', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const outcome = await createEnrollmentForUser(
      { email: 'new@example.com' },
      { ...BASE_CTX, organizationId: null },
    );

    expect(outcome).toEqual({ status: 'failed', email: 'new@example.com' });
    expect(prismaMock.invite.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.invite.create).not.toHaveBeenCalled();
  });

  it('still returns invited when the invite email fails to send — the invite row is not rolled back', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    mockSendCourseInviteEmail.mockRejectedValue(new Error('SMTP down'));

    const outcome = await createEnrollmentForUser({ email: 'new@example.com' }, BASE_CTX);

    expect(outcome).toEqual({ status: 'invited', email: 'new@example.com' });
    expect(prismaMock.invite.create).toHaveBeenCalled();
  });

  it('reports failed when the invite/course-park write itself fails', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.invite.create.mockRejectedValue(new Error('db down'));

    const outcome = await createEnrollmentForUser({ email: 'new@example.com' }, BASE_CTX);

    expect(outcome).toEqual({ status: 'failed', email: 'new@example.com' });
    expect(mockSendCourseInviteEmail).not.toHaveBeenCalled();
  });
});

describe('createEnrollmentForUser — existing org member', () => {
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
