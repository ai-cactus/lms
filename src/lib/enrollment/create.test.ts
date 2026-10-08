/**
 * Unit tests for createEnrollmentForUser (src/lib/enrollment/create.ts).
 *
 * fix/worker-invite unified the course-assignment flow with the staff-invite
 * flow: an unknown email (or an existing identity with no ACTIVE membership in
 * the caller's organization — including a member of a different org entirely,
 * since tenancy is now structural and membership is looked up scoped to
 * ctx.organizationId) is no longer given a premature user account with a
 * temp password — it is sent a `/join/{token}` invite with the course parked
 * on it (`InviteCourseAssignment`), materialised into a real enrollment only
 * when the invite is accepted (see invite-courses.test.ts). This suite covers
 * the membership-scoped tenancy guard, invalid-email handling, idempotency, the
 * invite branch (create vs reuse-and-refresh, CSV role mapping, email-failure
 * isolation, DB-failure isolation), and the existing-org-member branch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { prismaMock, mockCreateNotification, mockSendCourseInviteEmail, mockSendCourseLaunchEmail } =
  vi.hoisted(() => {
    const prismaMock = {
      user: { findUnique: vi.fn(), update: vi.fn() },
      organizationUser: { findFirst: vi.fn() },
      enrollment: { findFirst: vi.fn(), create: vi.fn() },
      reminderLog: { create: vi.fn() },
      invite: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
      inviteCourseAssignment: { upsert: vi.fn() },
      facility: { findFirst: vi.fn() },
      organizationUserFacility: { findFirst: vi.fn(), findMany: vi.fn() },
    };
    return {
      prismaMock,
      mockCreateNotification: vi.fn(),
      mockSendCourseInviteEmail: vi.fn(),
      mockSendCourseLaunchEmail: vi.fn(),
    };
  });

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/notifications/create', () => ({ createNotification: mockCreateNotification }));
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
  onPassedDeadline: 'skip',
  enrolledByUserId: 'admin-1',
};

// Q-32 skips a learner whose deadline has already passed, so the fixed deadlines
// below only mean what they say against a pinned clock.
const PINNED_NOW = new Date('2026-08-15T12:00:00.000Z');
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(PINNED_NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
  prismaMock.enrollment.findFirst.mockResolvedValue(null);
  prismaMock.organizationUserFacility.findFirst.mockResolvedValue(null);
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
  // ctx.facilityId is null in BASE_CTX, so the invite branch falls back to the
  // org's first facility — every invite now requires a facilityId.
  prismaMock.facility.findFirst.mockResolvedValue({ id: 'facility-1' });
  prismaMock.organizationUser.findFirst.mockResolvedValue(null);
  mockCreateNotification.mockResolvedValue(undefined);
  mockSendCourseInviteEmail.mockResolvedValue(undefined);
  mockSendCourseLaunchEmail.mockResolvedValue(undefined);
});

describe('createEnrollmentForUser — membership-scoped tenancy guard', () => {
  it('sends a /join invite (does not enroll) when the email resolves to an identity with no ACTIVE membership in the caller org — e.g. a member of a DIFFERENT org', async () => {
    // Tenancy is now structural: the membership lookup is scoped to
    // ctx.organizationId, so an identity that belongs only to another org is
    // simply not found here — it is treated the same as an unknown email and
    // gets an invite, never a bare "failed". This replaces the old explicit
    // organizationId-mismatch rejection.
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-in-org-2',
      email: 'staff@example.com',
      firstName: null,
      lastName: null,
      fullName: null,
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue(null); // no active membership in org-1

    const outcome = await createEnrollmentForUser({ email: 'staff@example.com' }, BASE_CTX);

    expect(outcome).toEqual({ status: 'invited', email: 'staff@example.com' });
    expect(prismaMock.organizationUser.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-in-org-2', organizationId: 'org-1', active: true },
      select: { id: true, role: true },
    });
    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
    expect(prismaMock.enrollment.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.invite.create).toHaveBeenCalled();
  });

  it('proceeds normally (enrolls) when the resolved user has an ACTIVE membership in the caller org', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-in-org-1',
      email: 'staff@example.com',
      firstName: null,
      lastName: null,
      fullName: 'Staff One',
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue({ id: 'ou-1', role: 'nurse' });

    const outcome = await createEnrollmentForUser({ email: 'staff@example.com' }, BASE_CTX);

    expect(outcome.status).toBe('enrolled');
    expect(prismaMock.enrollment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ organizationUserId: 'ou-1' }) }),
    );
  });

  it('invites (does not relink or enroll) when the existing identity has no active membership anywhere relevant (org-less user being claimed)', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-no-org',
      email: 'staff@example.com',
      firstName: null,
      lastName: null,
      fullName: null,
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue(null);

    const outcome = await createEnrollmentForUser({ email: 'staff@example.com' }, BASE_CTX);

    expect(outcome).toEqual({ status: 'invited', email: 'staff@example.com' });
    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
    expect(prismaMock.enrollment.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.invite.create).toHaveBeenCalled();
  });

  it('reports failed (never queries membership) when the caller context has no organizationId — there is no org to scope a membership lookup or an invite to', async () => {
    // Intended behavior change from the pre-refactor model: previously a null
    // ctx.organizationId skipped the tenancy guard entirely and fell through to
    // enroll. Now the membership lookup itself is gated on ctx.organizationId
    // (`user && ctx.organizationId ? ... : null`), so a null org means
    // `membership` is unconditionally null regardless of the resolved user, and
    // the function can only report `failed` — there's no organization context
    // left to attach an enrollment or an invite to.
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-in-org-2',
      email: 'staff@example.com',
      firstName: null,
      lastName: null,
      fullName: null,
    });

    const outcome = await createEnrollmentForUser(
      { email: 'staff@example.com' },
      { ...BASE_CTX, organizationId: null },
    );

    expect(outcome).toEqual({ status: 'failed', email: 'staff@example.com' });
    expect(prismaMock.organizationUser.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
    expect(prismaMock.invite.create).not.toHaveBeenCalled();
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
      firstName: null,
      lastName: null,
      fullName: null,
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue({ id: 'ou-1', role: 'nurse' });
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
    expect(prismaMock.organizationUser.findFirst).not.toHaveBeenCalled();

    expect(prismaMock.invite.findFirst).toHaveBeenCalledWith({
      where: { email: 'new@example.com', organizationId: 'org-1', status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    expect(prismaMock.invite.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'new@example.com',
        organizationId: 'org-1',
        facilityId: 'facility-1', // BASE_CTX.facilityId is null → falls back to the org's first facility
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

  it('NEVER changes the role or facility of the reused invite — only the expiry (that is createInvites, not course assignment)', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.invite.findFirst.mockResolvedValue({
      id: 'existing-invite-2',
      token: 'existing-tok-2',
      email: 'new@example.com',
      organizationId: 'org-1',
      role: 'hr',
      facilityId: 'facility-elsewhere',
      status: 'pending',
      expiresAt: new Date('2026-07-01T00:00:00Z'),
    });
    prismaMock.invite.update.mockResolvedValue({
      id: 'existing-invite-2',
      token: 'existing-tok-2',
      email: 'new@example.com',
      organizationId: 'org-1',
      role: 'hr',
    });

    await createEnrollmentForUser({ email: 'new@example.com', role: 'admin' }, BASE_CTX);

    expect(prismaMock.invite.update).toHaveBeenCalledTimes(1);
    const { data } = prismaMock.invite.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(Object.keys(data)).toEqual(['expiresAt']);
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

  it('reports failed and creates no invite when the organization has no facility to attach it to', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.facility.findFirst.mockResolvedValue(null);

    const outcome = await createEnrollmentForUser({ email: 'new@example.com' }, BASE_CTX);

    expect(outcome).toEqual({ status: 'failed', email: 'new@example.com' });
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
      firstName: null,
      lastName: null,
      fullName: 'Staff One',
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue({ id: 'ou-1', role: 'nurse' });

    const outcome = await createEnrollmentForUser(
      { email: 'staff@example.com' },
      { ...BASE_CTX, assignmentDueAt: new Date('2026-09-01T00:00:00Z') },
    );

    // No facility: the picked wall-clock time is read in America/New_York.
    const expectedDueAt = new Date('2026-09-01T04:00:00Z');
    expect(outcome.status).toBe('enrolled');
    expect(prismaMock.enrollment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationUserId: 'ou-1', dueAt: expectedDueAt }),
      }),
    );
    expect(mockSendCourseLaunchEmail).toHaveBeenCalledWith(
      'staff@example.com',
      'Staff One',
      'Safety Training',
      'Acme Corp',
      expectedDueAt,
      'America/New_York',
    );
    expect(mockSendCourseInviteEmail).not.toHaveBeenCalled();
  });

  it('never stamps lastActivityAt — assigning is admin activity, not learner engagement', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'staff@example.com',
      firstName: null,
      lastName: null,
      fullName: 'Staff One',
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue({ id: 'ou-1' });

    await createEnrollmentForUser({ email: 'staff@example.com' }, BASE_CTX);

    const { data } = prismaMock.enrollment.create.mock.calls[0][0];
    expect(data).not.toHaveProperty('lastActivityAt');
  });

  it("stamps the enrollment with the member's OWN active facility assignment, resolved fresh — not ctx.facilityId", async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'staff@example.com',
      firstName: null,
      lastName: null,
      fullName: 'Staff One',
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue({ id: 'ou-1', role: 'nurse' });
    prismaMock.organizationUserFacility.findFirst.mockResolvedValue({ facilityId: 'fac-own' });

    await createEnrollmentForUser(
      { email: 'staff@example.com' },
      { ...BASE_CTX, facilityId: 'fac-inviter-context' },
    );

    expect(prismaMock.enrollment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ facilityId: 'fac-own' }) }),
    );
  });

  it('stamps facilityId: null for an existing member with no active facility assignment', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'staff@example.com',
      firstName: null,
      lastName: null,
      fullName: 'Staff One',
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue({ id: 'ou-1', role: 'nurse' });
    prismaMock.organizationUserFacility.findFirst.mockResolvedValue(null);

    await createEnrollmentForUser({ email: 'staff@example.com' }, BASE_CTX);

    expect(prismaMock.enrollment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ facilityId: null }) }),
    );
  });
});

/**
 * BUG-12.3 (ruled: facility time zone): a "due 30 Sept" deadline ends at 11:59 PM
 * on 30 Sept in the learner's facility zone — not at 23:59 UTC.
 */
describe('createEnrollmentForUser — deadline in the learner facility zone', () => {
  // What every assign surface submits for "30 Sept" with the default 11:59 PM.
  const PICKED_30_SEPT = new Date('2026-09-30T23:59:00.000Z');

  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'staff@example.com',
      firstName: null,
      lastName: null,
      fullName: 'Staff One',
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue({ id: 'ou-1', role: 'nurse' });
  });

  it.each([
    ['UTC+14 (Pacific/Kiritimati)', 'Pacific/Kiritimati', '2026-09-30T09:59:00.000Z'],
    ['UTC−10 (Pacific/Honolulu)', 'Pacific/Honolulu', '2026-10-01T09:59:00.000Z'],
  ])('stores 23:59 local for a facility at %s', async (_label, timezone, expected) => {
    prismaMock.organizationUserFacility.findFirst.mockResolvedValue({
      facilityId: 'fac-own',
      facility: { timezone },
    });

    await createEnrollmentForUser(
      { email: 'staff@example.com' },
      { ...BASE_CTX, assignmentDueAt: PICKED_30_SEPT },
    );

    expect(prismaMock.enrollment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ facilityId: 'fac-own', dueAt: new Date(expected) }),
    });
    expect(mockSendCourseLaunchEmail).toHaveBeenCalledWith(
      'staff@example.com',
      'Staff One',
      'Safety Training',
      'Acme Corp',
      new Date(expected),
      timezone,
    );
  });

  it('uses America/New_York for a facility with no zone set, as the Status Tracker does', async () => {
    prismaMock.organizationUserFacility.findFirst.mockResolvedValue({
      facilityId: 'fac-own',
      facility: { timezone: null },
    });

    await createEnrollmentForUser(
      { email: 'staff@example.com' },
      { ...BASE_CTX, assignmentDueAt: PICKED_30_SEPT },
    );

    expect(prismaMock.enrollment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ dueAt: new Date('2026-10-01T03:59:00.000Z') }),
    });
  });

  it('leaves a window-computed deadline alone — it is a duration, not a picked date', async () => {
    prismaMock.organizationUserFacility.findFirst.mockResolvedValue({
      facilityId: 'fac-own',
      facility: { timezone: 'Pacific/Kiritimati' },
    });
    const scheduleAt = new Date('2026-09-01T15:00:00.000Z');

    await createEnrollmentForUser(
      { email: 'staff@example.com' },
      { ...BASE_CTX, scheduleAt, assignmentWindowDays: 10 },
    );

    expect(prismaMock.enrollment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ dueAt: new Date('2026-09-11T15:00:00.000Z') }),
    });
  });
});

/**
 * Q-32 (ruled 2026-09-29): "already past" is judged per learner. The same picked
 * date — 30 Sept, 11:59 PM — has ended in Kiritimati (UTC+14) by 12:00 UTC on the
 * 30th, but still has most of a day to run in Honolulu (UTC−10).
 */
describe('createEnrollmentForUser — deadline already passed for this learner (Q-32)', () => {
  const PICKED_30_SEPT = new Date('2026-09-30T23:59:00.000Z');

  beforeEach(() => {
    vi.setSystemTime(new Date('2026-09-30T12:00:00.000Z'));
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'staff@example.com',
      firstName: null,
      lastName: null,
      fullName: 'Staff One',
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue({ id: 'ou-1', role: 'nurse' });
  });

  function postAt(timezone: string) {
    prismaMock.organizationUserFacility.findFirst.mockResolvedValue({
      facilityId: 'fac-own',
      facility: { timezone },
    });
  }

  it('skips a Kiritimati learner — nothing written, nobody told — and reports their zone', async () => {
    postAt('Pacific/Kiritimati');

    const outcome = await createEnrollmentForUser(
      { email: 'staff@example.com' },
      { ...BASE_CTX, assignmentDueAt: PICKED_30_SEPT, onPassedDeadline: 'skip' },
    );

    expect(outcome).toEqual({
      status: 'deadlinePassed',
      email: 'staff@example.com',
      timeZone: 'Pacific/Kiritimati',
    });
    expect(prismaMock.enrollment.create).not.toHaveBeenCalled();
    expect(prismaMock.reminderLog.create).not.toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockSendCourseLaunchEmail).not.toHaveBeenCalled();
  });

  it('enrols a Honolulu learner for the same picked date, due 23:59 there', async () => {
    postAt('Pacific/Honolulu');

    const outcome = await createEnrollmentForUser(
      { email: 'staff@example.com' },
      { ...BASE_CTX, assignmentDueAt: PICKED_30_SEPT, onPassedDeadline: 'skip' },
    );

    expect(outcome.status).toBe('enrolled');
    expect(prismaMock.enrollment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ dueAt: new Date('2026-10-01T09:59:00.000Z') }),
    });
  });

  it("'useWindow' (automatic paths) enrols on the learner's completion window instead", async () => {
    postAt('Pacific/Kiritimati');

    const outcome = await createEnrollmentForUser(
      { email: 'staff@example.com' },
      {
        ...BASE_CTX,
        assignmentDueAt: PICKED_30_SEPT,
        assignmentWindowDays: 14,
        onPassedDeadline: 'useWindow',
      },
    );

    expect(outcome.status).toBe('enrolled');
    expect(prismaMock.enrollment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ dueAt: new Date('2026-10-14T12:00:00.000Z') }),
    });
  });

  it('never skips a window-computed deadline — only a picked date can be already past', async () => {
    postAt('Pacific/Kiritimati');

    const outcome = await createEnrollmentForUser(
      { email: 'staff@example.com' },
      { ...BASE_CTX, assignmentDueAt: null, assignmentWindowDays: 14, onPassedDeadline: 'skip' },
    );

    expect(outcome.status).toBe('enrolled');
  });
});

describe('createEnrollmentForUser — deferWorkerNotification', () => {
  it('flag unset: notifies and emails inline exactly once each, and returns no `deferred` — regression lock for every existing caller', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'staff@example.com',
      firstName: null,
      lastName: null,
      fullName: 'Staff One',
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue({ id: 'ou-1', role: 'nurse' });

    const outcome = await createEnrollmentForUser(
      { email: 'staff@example.com' },
      { ...BASE_CTX, assignmentDueAt: new Date('2026-09-01T00:00:00Z') },
    );

    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockCreateNotification).toHaveBeenCalledWith({
      organizationUserId: 'ou-1',
      type: 'COURSE_ASSIGNED',
      title: 'New Required Training Assigned',
      message: 'You have been assigned a new course: Safety Training',
      linkUrl: '/worker/trainings',
      metadata: { courseId: 'course-1' },
    });
    expect(mockSendCourseLaunchEmail).toHaveBeenCalledTimes(1);
    expect(outcome).not.toHaveProperty('deferred');
  });

  // BUG-02: a manager is assigned courses like anyone else, and
  // `/worker/trainings` is served only against a worker-portal cookie.
  it('manager recipient: the inline notice links to the course, not to the worker portal', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'staff@example.com',
      firstName: null,
      lastName: null,
      fullName: 'Staff One',
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue({
      id: 'ou-1',
      role: 'clinical_director',
    });

    await createEnrollmentForUser({ email: 'staff@example.com' }, BASE_CTX);

    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ linkUrl: '/learn/course-1' }),
    );
  });

  it('flag set: skips the inline notification and email, still writes the enrollment and seeds INITIAL_LAUNCH, and returns a `deferred` payload with the persisted due date', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'staff@example.com',
      firstName: null,
      lastName: null,
      fullName: 'Staff One',
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue({ id: 'ou-1', role: 'nurse' });
    prismaMock.organizationUserFacility.findFirst.mockResolvedValue({
      facilityId: 'fac-own',
      facility: { timezone: 'Pacific/Honolulu' },
    });

    const outcome = await createEnrollmentForUser(
      { email: 'staff@example.com' },
      {
        ...BASE_CTX,
        assignmentDueAt: new Date('2026-09-01T23:59:00Z'),
        deferWorkerNotification: true,
      },
    );
    // 11:59 PM on 1 Sept in Honolulu (UTC−10).
    const dueAt = new Date('2026-09-02T09:59:00Z');

    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockSendCourseLaunchEmail).not.toHaveBeenCalled();
    expect(prismaMock.enrollment.create).toHaveBeenCalled();
    expect(prismaMock.reminderLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ stage: 'INITIAL_LAUNCH' }) }),
    );
    expect(outcome).toMatchObject({
      status: 'enrolled',
      userId: 'user-1',
      deferred: {
        organizationUserId: 'ou-1',
        userId: 'user-1',
        email: 'staff@example.com',
        recipientName: 'Staff One',
        recipientRole: 'nurse',
        courseId: 'course-1',
        courseTitle: 'Safety Training',
        organizationName: 'Acme Corp',
        dueAt,
        timeZone: 'Pacific/Honolulu',
      },
    });
  });

  it('flag set + already enrolled: reports alreadyEnrolled with no `deferred`', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'staff@example.com',
      firstName: null,
      lastName: null,
      fullName: null,
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue({ id: 'ou-1', role: 'nurse' });
    prismaMock.enrollment.findFirst.mockResolvedValue({ id: 'existing-enrollment' });

    const outcome = await createEnrollmentForUser(
      { email: 'staff@example.com' },
      { ...BASE_CTX, deferWorkerNotification: true },
    );

    expect(outcome).toEqual({ status: 'alreadyEnrolled', email: 'staff@example.com' });
    expect(mockCreateNotification).not.toHaveBeenCalled();
    expect(mockSendCourseLaunchEmail).not.toHaveBeenCalled();
  });

  it('flag set + unknown email: the /join invite email still sends inline — an invited address has no account to batch against', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const outcome = await createEnrollmentForUser(
      { email: 'new@example.com' },
      { ...BASE_CTX, deferWorkerNotification: true },
    );

    expect(outcome).toEqual({ status: 'invited', email: 'new@example.com' });
    expect(mockSendCourseInviteEmail).toHaveBeenCalledTimes(1);
  });
});

describe('createEnrollmentForUser — Q-31 deleted identity', () => {
  it('reports failed and creates no invite, parks no course and sends no email', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-deleted',
      firstName: 'Dana',
      lastName: 'Deleted',
      fullName: 'Dana Deleted',
      deletedAt: new Date('2026-09-28'),
    });
    prismaMock.organizationUser.findFirst.mockResolvedValue(null);

    const outcome = await createEnrollmentForUser({ email: 'deleted@example.com' }, BASE_CTX);

    expect(outcome).toEqual({ status: 'failed', email: 'deleted@example.com' });
    expect(prismaMock.invite.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.invite.create).not.toHaveBeenCalled();
    expect(prismaMock.invite.update).not.toHaveBeenCalled();
    expect(prismaMock.inviteCourseAssignment.upsert).not.toHaveBeenCalled();
    expect(mockSendCourseInviteEmail).not.toHaveBeenCalled();
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.objectContaining({ deletedAt: true }) }),
    );
  });
});
