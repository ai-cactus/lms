/**
 * Unit tests for src/app/actions/invite.ts — createInvites()
 *
 * Key behaviours validated:
 *   - Unauthenticated / non-admin session → Unauthorized
 *   - Session with no invite.create permission → Forbidden
 *   - Invalid role string → 'Invalid role'
 *   - Privilege escalation (hr→supervisor, anyone→owner) → blocked
 *   - Valid invite path → invites are created, email is sent
 *   - Seat counting (D2): all non-owner roles count; owner does not
 *
 * External deps (@/auth, @/lib/prisma, @/lib/email, @/lib/billing-plans,
 * next/cache) are all mocked to keep this a pure unit test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockAuth,
  mockOrgFindUnique,
  mockUserCount,
  mockInviteCount,
  mockUserFindMany,
  mockInviteFindMany,
  mockInviteCreateMany,
  mockSendInviteEmail,
  mockRevalidatePath,
  mockLoggerWarn,
  mockLoggerInfo,
  mockLoggerError,
} = vi.hoisted(() => {
  return {
    mockAuth: vi.fn(),
    mockOrgFindUnique: vi.fn(),
    mockUserCount: vi.fn(),
    mockInviteCount: vi.fn(),
    mockUserFindMany: vi.fn(),
    mockInviteFindMany: vi.fn(),
    mockInviteCreateMany: vi.fn(),
    mockSendInviteEmail: vi.fn(),
    mockRevalidatePath: vi.fn(),
    mockLoggerWarn: vi.fn(),
    mockLoggerInfo: vi.fn(),
    mockLoggerError: vi.fn(),
  };
});

vi.mock('@/auth', () => ({ auth: mockAuth }));

vi.mock('@/lib/prisma', () => ({
  default: {
    organization: { findUnique: mockOrgFindUnique },
    user: { count: mockUserCount, findMany: mockUserFindMany },
    invite: {
      count: mockInviteCount,
      findMany: mockInviteFindMany,
      createMany: mockInviteCreateMany,
    },
  },
}));

vi.mock('@/lib/email', () => ({ sendInviteEmail: mockSendInviteEmail }));

vi.mock('@/lib/billing-plans', () => ({
  BILLING_PLANS: [
    { key: 'starter', name: 'Starter', staffMax: 10 },
    { key: 'pro', name: 'Pro', staffMax: null },
  ],
}));

vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: mockLoggerWarn,
    info: mockLoggerInfo,
    error: mockLoggerError,
    debug: vi.fn(),
  },
  maskEmail: (email: string) => `${email.slice(0, 2)}***@masked`,
}));

import { createInvites } from './invite';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSession(role: string, extras: Record<string, unknown> = {}) {
  return {
    user: {
      id: 'admin-1',
      email: 'admin@acme.com',
      role,
      organizationId: 'org-1',
      ...extras,
    },
  };
}

/** Stub a minimal org with NO active subscription (bypasses seat-limit check). */
function stubOrgNoSubscription() {
  mockOrgFindUnique.mockResolvedValue({
    name: 'Acme Corp',
    subscription: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default stubs for the batch lookup used after the seat check
  mockUserFindMany.mockResolvedValue([]);
  mockInviteFindMany.mockResolvedValue([]);
  mockInviteCreateMany.mockResolvedValue({ count: 1 });
  mockSendInviteEmail.mockResolvedValue(undefined);
});

// ── Auth guard ────────────────────────────────────────────────────────────────

describe('createInvites() — auth guards', () => {
  it('returns Unauthorized when there is no session', async () => {
    mockAuth.mockResolvedValue(null);

    const result = await createInvites(['new@acme.com'], 'worker');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unauthorized');
  });

  it('returns Unauthorized when the session role is worker (not admin)', async () => {
    mockAuth.mockResolvedValue(makeSession('worker'));

    const result = await createInvites(['new@acme.com'], 'worker');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unauthorized');
  });

  it('returns Unauthorized when session has no organizationId', async () => {
    mockAuth.mockResolvedValue(makeSession('supervisor', { organizationId: null }));

    const result = await createInvites(['new@acme.com'], 'worker');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unauthorized');
  });

  it('returns Forbidden when clinical_director (no invite.create) tries to invite', async () => {
    mockAuth.mockResolvedValue(makeSession('clinical_director'));

    const result = await createInvites(['new@acme.com'], 'worker');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Forbidden');
  });

  it('returns Forbidden when finance (no invite.create) tries to invite', async () => {
    mockAuth.mockResolvedValue(makeSession('finance'));

    const result = await createInvites(['new@acme.com'], 'worker');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Forbidden');
  });
});

// ── Role validation ───────────────────────────────────────────────────────────

describe('createInvites() — role validation', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(makeSession('supervisor'));
  });

  it('returns Invalid role for an unknown role string', async () => {
    const result = await createInvites(['new@acme.com'], 'admin' as never);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid role');
  });

  it('returns Invalid role for the retired admin role string', async () => {
    const result = await createInvites(['new@acme.com'], 'admin' as never);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid role');
  });
});

// ── Privilege escalation (GRANTABLE_ROLES fence) ─────────────────────────────

describe('createInvites() — privilege escalation is blocked', () => {
  it('hr cannot invite supervisor (D1)', async () => {
    mockAuth.mockResolvedValue(makeSession('hr'));

    const result = await createInvites(['new@acme.com'], 'supervisor');

    expect(result.success).toBe(false);
    expect(result.error).toBe('You cannot grant the requested role');
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ inviterRole: 'hr', requestedRole: 'supervisor' }),
    );
  });

  it('hr cannot invite owner', async () => {
    mockAuth.mockResolvedValue(makeSession('hr'));

    const result = await createInvites(['new@acme.com'], 'owner');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/grant|owner|Invalid/i);
  });

  it('supervisor cannot invite owner', async () => {
    mockAuth.mockResolvedValue(makeSession('supervisor'));

    // owner is not in ALL_ROLES... wait, it IS in ALL_ROLES.
    // But owner is NOT in GRANTABLE_ROLES['supervisor'], so it should be blocked by the
    // GRANTABLE_ROLES fence before the ALL_ROLES check.
    const result = await createInvites(['new@acme.com'], 'owner');

    expect(result.success).toBe(false);
    expect(result.error).toBe('You cannot grant the requested role');
  });

  it('owner cannot invite owner (owner is non-grantable)', async () => {
    mockAuth.mockResolvedValue(makeSession('owner'));

    const result = await createInvites(['new@acme.com'], 'owner');

    expect(result.success).toBe(false);
    expect(result.error).toBe('You cannot grant the requested role');
  });
});

// ── Valid invite path ─────────────────────────────────────────────────────────

describe('createInvites() — valid supervisor → hr invite', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(makeSession('supervisor'));
    stubOrgNoSubscription();
  });

  it('succeeds and returns sent status', async () => {
    const result = await createInvites(['hr@acme.com'], 'hr');

    expect(result.success).toBe(true);
    expect(result.results.find((r) => r.email === 'hr@acme.com')?.status).toBe('sent');
  });

  it('calls sendInviteEmail once with the invite link and role display name', async () => {
    await createInvites(['hr@acme.com'], 'hr');

    expect(mockSendInviteEmail).toHaveBeenCalledTimes(1);
    const [email, link, orgName, roleLabel] = mockSendInviteEmail.mock.calls[0];
    expect(email).toBe('hr@acme.com');
    expect(link).toMatch(/\/join\//);
    expect(orgName).toBe('Acme Corp');
    expect(roleLabel).toContain('HR');
  });

  it('calls prisma.invite.createMany with the requested role and organizationId', async () => {
    await createInvites(['hr@acme.com'], 'hr');

    expect(mockInviteCreateMany).toHaveBeenCalledTimes(1);
    const inviteData = mockInviteCreateMany.mock.calls[0][0].data[0];
    expect(inviteData.role).toBe('hr');
    expect(inviteData.organizationId).toBe('org-1');
    expect(inviteData.email).toBe('hr@acme.com');
  });

  it('revalidates the staff path after successful invite', async () => {
    await createInvites(['hr@acme.com'], 'hr');

    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/staff');
  });
});

// ── Seat counting (D2) ────────────────────────────────────────────────────────

describe('createInvites() — seat counting excludes owner (D2)', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(makeSession('owner'));
    // Org with a plan that has a seat limit
    mockOrgFindUnique.mockResolvedValue({
      name: 'Acme Corp',
      subscription: { plan: 'starter', status: 'active' },
    });
  });

  it('seat count query filters role: { not: "owner" } for active users', async () => {
    // Set up: 9 active users + 0 pending invites = 9/10 used
    mockUserCount.mockResolvedValue(9);
    mockInviteCount.mockResolvedValue(0);
    // Seat-check dedup queries
    mockUserFindMany.mockResolvedValue([]);
    mockInviteFindMany.mockResolvedValue([]);

    await createInvites(['new@acme.com'], 'worker');

    // The first user.count call should have role: { not: 'owner' }
    const userCountCall = mockUserCount.mock.calls[0][0];
    expect(userCountCall.where.role).toEqual({ not: 'owner' });
    expect(userCountCall.where.organizationId).toBe('org-1');
  });

  it('seat count query filters role: { not: "owner" } for pending invites', async () => {
    mockUserCount.mockResolvedValue(0);
    mockInviteCount.mockResolvedValue(0);
    mockUserFindMany.mockResolvedValue([]);
    mockInviteFindMany.mockResolvedValue([]);

    await createInvites(['new@acme.com'], 'worker');

    const inviteCountCall = mockInviteCount.mock.calls[0][0];
    expect(inviteCountCall.where.role).toEqual({ not: 'owner' });
    expect(inviteCountCall.where.status).toBe('pending');
  });

  it('rejects when adding a new invite would exceed the plan limit', async () => {
    // 10/10 seats used
    mockUserCount.mockResolvedValue(10);
    mockInviteCount.mockResolvedValue(0);
    // The email is "new" (not existing)
    mockUserFindMany.mockResolvedValue([]);
    mockInviteFindMany.mockResolvedValue([]);

    const result = await createInvites(['new@acme.com'], 'worker');

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/limit|Starter|seat/i);
    expect(result.limitError).toBeDefined();
    expect(result.limitError?.limit).toBe(10);
  });

  it('allows invite when within limit', async () => {
    // 9/10 seats — room for 1 more
    mockUserCount.mockResolvedValue(9);
    mockInviteCount.mockResolvedValue(0);
    mockUserFindMany.mockResolvedValue([]);
    mockInviteFindMany.mockResolvedValue([]);
    // Also stub the post-check lookups
    mockInviteCreateMany.mockResolvedValue({ count: 1 });
    mockSendInviteEmail.mockResolvedValue(undefined);

    const result = await createInvites(['new@acme.com'], 'worker');

    expect(result.success).toBe(true);
  });
});

// ── hr inviting hr and finance — allowed (D1) ─────────────────────────────────

describe('createInvites() — hr valid grants (D1)', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(makeSession('hr'));
    stubOrgNoSubscription();
  });

  it('hr can invite hr', async () => {
    const result = await createInvites(['new-hr@acme.com'], 'hr');
    expect(result.success).toBe(true);
  });

  it('hr can invite finance', async () => {
    const result = await createInvites(['new-finance@acme.com'], 'finance');
    expect(result.success).toBe(true);
  });

  it('hr can invite clinical_director', async () => {
    const result = await createInvites(['cd@acme.com'], 'clinical_director');
    expect(result.success).toBe(true);
  });

  it('hr can invite worker', async () => {
    const result = await createInvites(['w@acme.com'], 'worker');
    expect(result.success).toBe(true);
  });
});
