/**
 * Regression tests for POST /api/invite/accept.
 *
 * Companion to the /join/[token] page fix: token lookup here was already a
 * `findUnique` (token is `@unique`), but these tests guard the same class of
 * bug — a missing/blank token must never reach the database, and a valid
 * token must create the account under exactly THAT invite's organization and
 * role, never some other invite's.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const {
  prismaMock,
  mockLogger,
  mockBcryptHash,
  mockEnrollUserForRoleTargets,
  mockEnrollInviteCourses,
} = vi.hoisted(() => ({
  prismaMock: {
    invite: { findUnique: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn(), create: vi.fn() },
    facility: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  mockBcryptHash: vi.fn().mockResolvedValue('hashed-password'),
  mockEnrollUserForRoleTargets: vi.fn(),
  mockEnrollInviteCourses: vi.fn(),
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

import { POST } from './route';

const VALID_PASSWORD = 'StrongPass1!';
const FUTURE = new Date(Date.now() + 24 * 60 * 60 * 1000);

function makeReq(body: unknown): NextRequest {
  return {
    json: vi.fn().mockResolvedValue(body),
    headers: new Headers(),
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBcryptHash.mockResolvedValue('hashed-password');
  prismaMock.facility.findFirst.mockResolvedValue({ id: 'facility-1' });
  prismaMock.user.findUnique.mockResolvedValue(null);
  prismaMock.$transaction.mockImplementation(async (cb) =>
    cb({
      user: { create: prismaMock.user.create },
      invite: { update: prismaMock.invite.update },
    }),
  );
  prismaMock.user.create.mockResolvedValue({ id: 'new-user-1' });
  mockEnrollUserForRoleTargets.mockResolvedValue(undefined);
  mockEnrollInviteCourses.mockResolvedValue(undefined);
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
  it('creates the account under exactly the requested token’s organization and role', async () => {
    prismaMock.invite.findUnique.mockResolvedValueOnce({
      id: 'invite-correct',
      token: 'tok-correct',
      email: 'newhire@acme.com',
      organizationId: 'org-correct',
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
    expect(prismaMock.user.create).toHaveBeenCalledExactlyOnceWith({
      data: expect.objectContaining({
        email: 'newhire@acme.com',
        organizationId: 'org-correct',
        role: 'nurse',
        facilityId: 'facility-1',
      }),
    });
    expect(prismaMock.invite.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'invite-correct' },
      data: { status: 'accepted' },
    });
  });

  it('materialises any invite-parked courses after enrolling the new user', async () => {
    prismaMock.invite.findUnique.mockResolvedValueOnce({
      id: 'invite-correct',
      token: 'tok-correct',
      email: 'newhire@acme.com',
      organizationId: 'org-correct',
      role: 'nurse',
      expiresAt: FUTURE,
    });

    await POST(
      makeReq({
        token: 'tok-correct',
        firstName: 'Jane',
        lastName: 'Doe',
        password: VALID_PASSWORD,
      }),
    );

    expect(mockEnrollUserForRoleTargets).toHaveBeenCalledExactlyOnceWith(
      'new-user-1',
      'org-correct',
    );
    expect(mockEnrollInviteCourses).toHaveBeenCalledExactlyOnceWith('new-user-1', 'invite-correct');
    // Role-target enrollment happens before invite-parked-course enrollment.
    const roleTargetsOrder = mockEnrollUserForRoleTargets.mock.invocationCallOrder[0];
    const inviteCoursesOrder = mockEnrollInviteCourses.mock.invocationCallOrder[0];
    expect(roleTargetsOrder).toBeLessThan(inviteCoursesOrder);
  });

  it('rejects when a user already exists for the invite email in a DIFFERENT org, without relinking it', async () => {
    prismaMock.invite.findUnique.mockResolvedValueOnce({
      id: 'invite-1',
      token: 'tok-1',
      email: 'existing@acme.com',
      organizationId: 'org-1',
      role: 'nurse',
      expiresAt: FUTURE,
    });
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'already-there',
      organizationId: 'org-other',
    });

    const res = await POST(
      makeReq({ token: 'tok-1', firstName: 'Jane', lastName: 'Doe', password: VALID_PASSWORD }),
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/already exists/i);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });
});

// ── Re-invite lifecycle: relinking an org-less (removed) account ────────────

describe('POST /api/invite/accept — relinking an org-less existing account', () => {
  /**
   * The emailed invite token proves control of the address — the same trust
   * model as a password-reset link — so an org-less account (a previously
   * removed staff member) is relinked via tx.user.update rather than
   * rejected or duplicated via tx.user.create.
   */
  it('relinks an org-less existing account via tx.user.update, not tx.user.create', async () => {
    prismaMock.invite.findUnique.mockResolvedValueOnce({
      id: 'invite-relink',
      token: 'tok-relink',
      email: 'removed@acme.com',
      organizationId: 'org-new',
      role: 'hr',
      expiresAt: FUTURE,
    });
    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'removed-user-1',
      organizationId: null,
    });
    const mockUserUpdate = vi.fn().mockResolvedValue({ id: 'removed-user-1' });
    prismaMock.$transaction.mockImplementationOnce(async (cb) =>
      cb({
        user: { create: prismaMock.user.create, update: mockUserUpdate },
        invite: { update: prismaMock.invite.update },
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
      data: expect.objectContaining({
        emailVerified: true,
        password: 'hashed-password',
        organizationId: 'org-new',
        facilityId: 'facility-1',
        role: 'hr',
        profile: {
          upsert: {
            create: {
              firstName: 'Jane',
              lastName: 'Doe',
              fullName: 'Jane Doe',
              email: 'removed@acme.com',
            },
            update: {
              firstName: 'Jane',
              lastName: 'Doe',
              fullName: 'Jane Doe',
              email: 'removed@acme.com',
            },
          },
        },
      }),
    });
    expect(prismaMock.invite.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: 'invite-relink' },
      data: { status: 'accepted' },
    });
    expect(mockEnrollUserForRoleTargets).toHaveBeenCalledExactlyOnceWith(
      'removed-user-1',
      'org-new',
    );
    expect(mockEnrollInviteCourses).toHaveBeenCalledExactlyOnceWith(
      'removed-user-1',
      'invite-relink',
    );
  });
});
