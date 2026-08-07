/**
 * Regression tests for POST /api/invite/accept.
 *
 * Companion to the /join/[token] page fix: token lookup here was already a
 * `findUnique` (token is `@unique`), but these tests guard the same class of
 * bug — a missing/blank token must never reach the database, and a valid
 * token must create the account under exactly THAT invite's organization and
 * role, never some other invite's.
 *
 * Multi-org refactor: `User` no longer carries organizationId/facilityId/role
 * (or a `profile` relation) — accepting an invite creates/relinks the global
 * `User` identity only, then calls `createMembership()` to attach the
 * `OrganizationUser` + `OrganizationUserFacility` rows from
 * `invite.organizationId` / `invite.facilityId` / `invite.role`.
 * `createMembership` itself is unit-tested in `src/lib/auth/membership.test.ts`;
 * here it is mocked so these tests stay focused on the route's own
 * orchestration (duplicate detection, relink vs create, notification wiring).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  prismaMock,
  mockLogger,
  mockBcryptHash,
  mockEnrollUserForRoleTargets,
  mockEnrollInviteCourses,
  mockCreateMembership,
} = vi.hoisted(() => ({
  prismaMock: {
    invite: { findUnique: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    organizationUser: { findUnique: vi.fn(), findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  mockBcryptHash: vi.fn().mockResolvedValue('hashed-password'),
  mockEnrollUserForRoleTargets: vi.fn(),
  mockEnrollInviteCourses: vi.fn(),
  mockCreateMembership: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
  maskEmail: (e: string) => e,
}));
vi.mock('bcryptjs', () => ({
  default: { hash: mockBcryptHash, compare: vi.fn() },
  hash: mockBcryptHash,
  compare: vi.fn(),
}));
// Rate limiting, captcha, seat limits, and audit are exercised by their own
// suites — stub them so these tests stay focused on token/org/role correctness.
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock('@/lib/captcha', () => ({ verifyCaptcha: vi.fn().mockResolvedValue(true) }));
vi.mock('@/lib/seat-limits', () => ({
  assertSeatAvailable: vi.fn().mockResolvedValue(undefined),
  SeatLimitError: class SeatLimitError extends Error {},
}));
vi.mock('@/lib/audit', () => ({ audit: vi.fn(), getClientContext: () => ({}) }));
// Live auto-enroll hooks are exercised by their own suites (role-targets.test.ts
// [n/a here], invite-courses.test.ts) — assert only that this route CALLS them
// with the right args, after enrollUserForRoleTargets, per the accept flow.
vi.mock('@/lib/enrollment/role-targets', () => ({
  enrollUserForRoleTargets: mockEnrollUserForRoleTargets,
}));
vi.mock('@/lib/enrollment/invite-courses', () => ({
  enrollInviteCourses: mockEnrollInviteCourses,
}));
vi.mock('@/lib/notifications/emit', () => ({ emitNotificationEvent: vi.fn() }));
vi.mock('@/lib/auth/membership', () => ({ createMembership: mockCreateMembership }));

import { POST } from './route';
import { emitNotificationEvent } from '@/lib/notifications/emit';

const mockEmitNotificationEvent = vi.mocked(emitNotificationEvent);

const VALID_PASSWORD = 'StrongPass1!';
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);

function makeReq(body: unknown): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
    headers: new Headers(),
  } as unknown as NextRequest;
}

function membershipResult(
  overrides: Partial<{ organizationUserId: string; organizationId: string; role: string }> = {},
) {
  return {
    organizationUserId: overrides.organizationUserId ?? 'ou-new-1',
    organizationId: overrides.organizationId ?? 'org-correct',
    organizationName: 'Acme Health',
    organizationSlug: 'acme-health',
    role: overrides.role ?? 'nurse',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBcryptHash.mockResolvedValue('hashed-password');
  prismaMock.user.findUnique.mockResolvedValue(null);
  prismaMock.organizationUser.findUnique.mockResolvedValue(null);
  prismaMock.$transaction.mockImplementation(async (cb) =>
    cb({
      user: { create: prismaMock.user.create, update: prismaMock.user.update },
      invite: { update: prismaMock.invite.update },
    }),
  );
  prismaMock.user.create.mockResolvedValue({ id: 'new-user-1' });
  mockEnrollUserForRoleTargets.mockResolvedValue(undefined);
  mockEnrollInviteCourses.mockResolvedValue(undefined);
  mockCreateMembership.mockResolvedValue(membershipResult());
});

describe('POST /api/invite/accept — missing/blank token', () => {
  it('rejects an empty token with 4xx and never queries or creates an account', async () => {
    const res = await POST(
      makeReq({ token: '', firstName: 'Jane', lastName: 'Doe', password: VALID_PASSWORD }),
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(prismaMock.invite.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('rejects a payload missing the token field entirely', async () => {
    const res = await POST(
      makeReq({ firstName: 'Jane', lastName: 'Doe', password: VALID_PASSWORD }),
    );

    expect(res.status).toBe(400);
    expect(prismaMock.invite.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/invite/accept — invalid or expired token', () => {
  it('rejects an unknown token and creates no account', async () => {
    prismaMock.invite.findUnique.mockResolvedValueOnce(null);

    const res = await POST(
      makeReq({
        token: 'nonexistent',
        firstName: 'Jane',
        lastName: 'Doe',
        password: VALID_PASSWORD,
      }),
    );

    expect(res.status).toBe(400);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledOnce();
  });

  it('rejects an expired invite and creates no account', async () => {
    prismaMock.invite.findUnique.mockResolvedValueOnce({
      id: 'invite-expired',
      token: 'tok-expired',
      email: 'expired@acme.com',
      organizationId: 'org-1',
      facilityId: 'facility-1',
      role: 'nurse',
      expiresAt: new Date(Date.now() - 1000),
    });

    const res = await POST(
      makeReq({
        token: 'tok-expired',
        firstName: 'Jane',
        lastName: 'Doe',
        password: VALID_PASSWORD,
      }),
    );

    expect(res.status).toBe(400);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/invite/accept — valid token', () => {
  it('creates the User identity and attaches the membership under exactly the requested token’s organization, facility and role', async () => {
    prismaMock.invite.findUnique.mockResolvedValueOnce({
      id: 'invite-correct',
      token: 'tok-correct',
      email: 'newhire@acme.com',
      organizationId: 'org-correct',
      facilityId: 'facility-correct',
      role: 'nurse',
      expiresAt: FUTURE,
    });

    const res = await POST(
      makeReq({
        token: 'tok-correct',
        firstName: 'Jane',
        lastName: 'Doe',
        password: VALID_PASSWORD,
      }),
    );

    expect(res.status).toBe(200);
    expect(prismaMock.invite.findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { token: 'tok-correct', status: 'pending' },
    });
    // User creation is now identity-only — no organizationId/facilityId/role.
    expect(prismaMock.user.create).toHaveBeenCalledExactlyOnceWith({
      data: {
        email: 'newhire@acme.com',
        emailVerified: true,
        password: 'hashed-password',
        firstName: 'Jane',
        lastName: 'Doe',
        fullName: 'Jane Doe',
      },
    });
    expect(prismaMock.invite.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'invite-correct' },
      data: { status: 'accepted' },
    });
    // The org/facility/role attachment happens via createMembership, sourced
    // directly from the invite (not from caller input).
    expect(mockCreateMembership).toHaveBeenCalledExactlyOnceWith({
      userId: 'new-user-1',
      organizationId: 'org-correct',
      facilityId: 'facility-correct',
      role: 'nurse',
    });
  });

  it('materialises any invite-parked courses after enrolling the new user, keyed by the membership id', async () => {
    prismaMock.invite.findUnique.mockResolvedValueOnce({
      id: 'invite-correct',
      token: 'tok-correct',
      email: 'newhire@acme.com',
      organizationId: 'org-correct',
      facilityId: 'facility-correct',
      role: 'nurse',
      expiresAt: FUTURE,
    });
    mockCreateMembership.mockResolvedValue(
      membershipResult({ organizationUserId: 'ou-new-1', organizationId: 'org-correct' }),
    );

    await POST(
      makeReq({
        token: 'tok-correct',
        firstName: 'Jane',
        lastName: 'Doe',
        password: VALID_PASSWORD,
      }),
    );

    // Both enrollment hooks are keyed by the new membership's organizationUserId,
    // not the global userId — enrollments are owned by OrganizationUser now.
    expect(mockEnrollUserForRoleTargets).toHaveBeenCalledExactlyOnceWith('ou-new-1', 'org-correct');
    expect(mockEnrollInviteCourses).toHaveBeenCalledExactlyOnceWith('ou-new-1', 'invite-correct');
    // Role-target enrollment happens before invite-parked-course enrollment.
    const roleTargetsOrder = mockEnrollUserForRoleTargets.mock.invocationCallOrder[0];
    const inviteCoursesOrder = mockEnrollInviteCourses.mock.invocationCallOrder[0];
    expect(roleTargetsOrder).toBeLessThan(inviteCoursesOrder);
  });

  it('rejects when the invite email already has an ACTIVE membership in THIS invite’s organization', async () => {
    prismaMock.invite.findUnique.mockResolvedValueOnce({
      id: 'invite-1',
      token: 'tok-1',
      email: 'existing@acme.com',
      organizationId: 'org-1',
      facilityId: 'facility-1',
      role: 'nurse',
      expiresAt: FUTURE,
    });
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'already-there' });
    prismaMock.organizationUser.findUnique.mockResolvedValueOnce({ active: true });

    const res = await POST(
      makeReq({ token: 'tok-1', firstName: 'Jane', lastName: 'Doe', password: VALID_PASSWORD }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/already exists/i);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(mockCreateMembership).not.toHaveBeenCalled();
  });

  it('allows accepting when the invite email exists but has no membership at all in THIS organization (joining an additional org)', async () => {
    prismaMock.invite.findUnique.mockResolvedValueOnce({
      id: 'invite-2',
      token: 'tok-2',
      email: 'multiorg@acme.com',
      organizationId: 'org-2',
      facilityId: 'facility-2',
      role: 'hr',
      expiresAt: FUTURE,
    });
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'existing-elsewhere' });
    // No row for (existing-elsewhere, org-2) — never joined this org before.
    prismaMock.organizationUser.findUnique.mockResolvedValueOnce(null);
    const mockUserUpdate = vi.fn().mockResolvedValue({ id: 'existing-elsewhere' });
    prismaMock.$transaction.mockImplementationOnce(async (cb) =>
      cb({
        user: { create: prismaMock.user.create, update: mockUserUpdate },
        invite: { update: prismaMock.invite.update },
      }),
    );

    const res = await POST(
      makeReq({ token: 'tok-2', firstName: 'Jane', lastName: 'Doe', password: VALID_PASSWORD }),
    );

    expect(res.status).toBe(200);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(mockUserUpdate).toHaveBeenCalledOnce();
    expect(mockCreateMembership).toHaveBeenCalledExactlyOnceWith({
      userId: 'existing-elsewhere',
      organizationId: 'org-2',
      facilityId: 'facility-2',
      role: 'hr',
    });
  });
});

// ── STAFF_ADDED notification wiring (§2.1/§2.2 routing) ─────────────────────

describe('POST /api/invite/accept — STAFF_ADDED notification wiring', () => {
  it('emits STAFF_ADDED with the inviter as actor when invite.invitedBy resolves to an active membership', async () => {
    prismaMock.invite.findUnique.mockResolvedValueOnce({
      id: 'invite-correct',
      token: 'tok-correct',
      email: 'newhire@acme.com',
      organizationId: 'org-correct',
      facilityId: 'facility-correct',
      role: 'nurse',
      invitedBy: 'inviter-1',
      expiresAt: FUTURE,
    });
    // Inviter is resolved via organizationUser.findFirst, not user.findUnique.
    prismaMock.organizationUser.findFirst.mockResolvedValueOnce({ role: 'hr' });
    mockCreateMembership.mockResolvedValue(
      membershipResult({ organizationUserId: 'ou-new-1', organizationId: 'org-correct' }),
    );

    await POST(
      makeReq({
        token: 'tok-correct',
        firstName: 'Jane',
        lastName: 'Doe',
        password: VALID_PASSWORD,
      }),
    );

    expect(prismaMock.organizationUser.findFirst).toHaveBeenCalledExactlyOnceWith({
      where: { userId: 'inviter-1', organizationId: 'org-correct' },
      select: { role: true },
    });
    expect(mockEmitNotificationEvent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        organizationId: 'org-correct',
        type: 'STAFF_ADDED',
        actor: { userId: 'inviter-1', role: 'hr' },
        subjectUserId: 'new-user-1',
        facilityId: 'facility-correct',
        linkUrl: '/dashboard/staff/ou-new-1',
        context: expect.objectContaining({ addedVia: 'invite' }),
      }),
    );
  });

  it('emits STAFF_ADDED with a null actor when the invite has no invitedBy (no inviter lookup performed)', async () => {
    prismaMock.invite.findUnique.mockResolvedValueOnce({
      id: 'invite-no-inviter',
      token: 'tok-no-inviter',
      email: 'newhire2@acme.com',
      organizationId: 'org-correct',
      facilityId: 'facility-correct',
      role: 'nurse',
      invitedBy: null,
      expiresAt: FUTURE,
    });

    await POST(
      makeReq({
        token: 'tok-no-inviter',
        firstName: 'Jane',
        lastName: 'Doe',
        password: VALID_PASSWORD,
      }),
    );

    expect(mockEmitNotificationEvent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ actor: null }),
    );
    expect(prismaMock.organizationUser.findFirst).not.toHaveBeenCalled();
  });

  it('passes the inviter role through unchanged for a non-HR inviter (e.g. supervisor)', async () => {
    prismaMock.invite.findUnique.mockResolvedValueOnce({
      id: 'invite-sup',
      token: 'tok-sup',
      email: 'newhire3@acme.com',
      organizationId: 'org-correct',
      facilityId: 'facility-correct',
      role: 'nurse',
      invitedBy: 'inviter-2',
      expiresAt: FUTURE,
    });
    prismaMock.organizationUser.findFirst.mockResolvedValueOnce({ role: 'supervisor' });

    await POST(
      makeReq({
        token: 'tok-sup',
        firstName: 'Jane',
        lastName: 'Doe',
        password: VALID_PASSWORD,
      }),
    );

    expect(mockEmitNotificationEvent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ actor: { userId: 'inviter-2', role: 'supervisor' } }),
    );
  });

  it('emits a null actor when invitedBy is set but no membership resolves for it (e.g. inviter left the org)', async () => {
    prismaMock.invite.findUnique.mockResolvedValueOnce({
      id: 'invite-gone',
      token: 'tok-gone',
      email: 'newhire4@acme.com',
      organizationId: 'org-correct',
      facilityId: 'facility-correct',
      role: 'nurse',
      invitedBy: 'inviter-gone',
      expiresAt: FUTURE,
    });
    prismaMock.organizationUser.findFirst.mockResolvedValueOnce(null);

    await POST(
      makeReq({
        token: 'tok-gone',
        firstName: 'Jane',
        lastName: 'Doe',
        password: VALID_PASSWORD,
      }),
    );

    expect(mockEmitNotificationEvent).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ actor: null }),
    );
  });
});

// ── Re-invite lifecycle: relinking an existing account with no active membership in this org ──

describe('POST /api/invite/accept — relinking an existing account', () => {
  /**
   * The emailed invite token proves control of the address — the same trust
   * model as a password-reset link — so an identity with no active membership
   * in this org (a previously removed staff member, or a fresh multi-org join)
   * is relinked via tx.user.update rather than rejected or duplicated via
   * tx.user.create. User updates are identity-only; org attachment happens
   * separately via createMembership.
   */
  it('relinks the existing identity via tx.user.update, not tx.user.create, then reattaches membership via createMembership', async () => {
    prismaMock.invite.findUnique.mockResolvedValueOnce({
      id: 'invite-relink',
      token: 'tok-relink',
      email: 'removed@acme.com',
      organizationId: 'org-new',
      facilityId: 'facility-new',
      role: 'hr',
      expiresAt: FUTURE,
    });
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'removed-user-1' });
    prismaMock.organizationUser.findUnique.mockResolvedValueOnce(null); // no active membership here
    const mockUserUpdate = vi.fn().mockResolvedValue({ id: 'removed-user-1' });
    prismaMock.$transaction.mockImplementationOnce(async (cb) =>
      cb({
        user: { create: prismaMock.user.create, update: mockUserUpdate },
        invite: { update: prismaMock.invite.update },
      }),
    );
    mockCreateMembership.mockResolvedValue(
      membershipResult({
        organizationUserId: 'ou-relink-1',
        organizationId: 'org-new',
        role: 'hr',
      }),
    );

    const res = await POST(
      makeReq({
        token: 'tok-relink',
        firstName: 'Jane',
        lastName: 'Doe',
        password: VALID_PASSWORD,
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.userId).toBe('removed-user-1');
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    expect(mockUserUpdate).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'removed-user-1' },
      data: {
        emailVerified: true,
        password: 'hashed-password',
        firstName: 'Jane',
        lastName: 'Doe',
        fullName: 'Jane Doe',
      },
    });
    expect(prismaMock.invite.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'invite-relink' },
      data: { status: 'accepted' },
    });
    expect(mockCreateMembership).toHaveBeenCalledExactlyOnceWith({
      userId: 'removed-user-1',
      organizationId: 'org-new',
      facilityId: 'facility-new',
      role: 'hr',
    });
    expect(mockEnrollUserForRoleTargets).toHaveBeenCalledExactlyOnceWith('ou-relink-1', 'org-new');
    expect(mockEnrollInviteCourses).toHaveBeenCalledExactlyOnceWith('ou-relink-1', 'invite-relink');
  });
});
