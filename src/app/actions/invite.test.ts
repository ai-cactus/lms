/**
 * Unit tests for src/app/actions/invite.ts — createInvites()
 *
 * Key behaviours validated:
 *   - Unauthenticated / non-admin session → Unauthorized
 *   - Session with no invite.create permission → Forbidden
 *   - Invalid role string → per-row 'forbidden' status (not a whole-batch error)
 *   - Privilege escalation (hr→supervisor, anyone→owner) → per-row 'forbidden'
 *   - Valid invite path → invites are created, email is sent
 *   - Per-item roles → each email's invite is created with ITS own role
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

import { createInvites, type InviteItem } from './invite';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Terse builder for the new per-item createInvites signature. */
function item(email: string, role: string): InviteItem {
  return { email, role: role as InviteItem['role'] };
}

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

    const result = await createInvites([item('new@acme.com', 'nurse')]);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unauthorized');
  });

  it('returns Unauthorized when the session role is a worker-category role (not admin)', async () => {
    mockAuth.mockResolvedValue(makeSession('nurse'));

    const result = await createInvites([item('new@acme.com', 'nurse')]);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unauthorized');
  });

  it('returns Unauthorized when session has no organizationId', async () => {
    mockAuth.mockResolvedValue(makeSession('supervisor', { organizationId: null }));

    const result = await createInvites([item('new@acme.com', 'nurse')]);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unauthorized');
  });

  it('returns Forbidden when clinical_director (no invite.create) tries to invite', async () => {
    mockAuth.mockResolvedValue(makeSession('clinical_director'));

    const result = await createInvites([item('new@acme.com', 'nurse')]);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Forbidden');
  });

  it('returns Forbidden when finance (no invite.create) tries to invite', async () => {
    mockAuth.mockResolvedValue(makeSession('finance'));

    const result = await createInvites([item('new@acme.com', 'nurse')]);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Forbidden');
  });
});

// ── Per-row role validation ───────────────────────────────────────────────────

describe('createInvites() — invalid role is rejected per-row', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(makeSession('supervisor'));
  });

  it('flags an unknown role string as a forbidden row (no whole-batch failure)', async () => {
    const result = await createInvites([item('new@acme.com', 'admin')]);

    expect(result.success).toBe(true);
    const row = result.results.find((r) => r.email === 'new@acme.com');
    expect(row?.status).toBe('forbidden');
    expect(row?.message).toBe('Invalid role.');
  });

  it('flags the retired single "worker" role string as a forbidden row', async () => {
    const result = await createInvites([item('new@acme.com', 'worker')]);

    expect(result.success).toBe(true);
    expect(result.results.find((r) => r.email === 'new@acme.com')?.status).toBe('forbidden');
  });

  it('rejects only the offending row and still processes the valid ones', async () => {
    stubOrgNoSubscription();

    const result = await createInvites([
      item('bad@acme.com', 'admin'),
      item('good@acme.com', 'hr'),
    ]);

    expect(result.success).toBe(true);
    expect(result.results.find((r) => r.email === 'bad@acme.com')?.status).toBe('forbidden');
    expect(result.results.find((r) => r.email === 'good@acme.com')?.status).toBe('sent');
    // Only the valid row reaches the DB insert.
    const inserted = mockInviteCreateMany.mock.calls[0][0].data;
    expect(inserted).toHaveLength(1);
    expect(inserted[0].email).toBe('good@acme.com');
  });
});

// ── Privilege escalation (GRANTABLE_ROLES fence) ─────────────────────────────

describe('createInvites() — privilege escalation is blocked per-row', () => {
  it('hr cannot grant supervisor (D1) — forbidden row + warn log', async () => {
    mockAuth.mockResolvedValue(makeSession('hr'));

    const result = await createInvites([item('new@acme.com', 'supervisor')]);

    expect(result.success).toBe(true);
    const row = result.results.find((r) => r.email === 'new@acme.com');
    expect(row?.status).toBe('forbidden');
    expect(row?.message).toBe('You cannot grant the requested role.');
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ inviterRole: 'hr', requestedRole: 'supervisor' }),
    );
  });

  it('hr cannot grant owner', async () => {
    mockAuth.mockResolvedValue(makeSession('hr'));

    const result = await createInvites([item('new@acme.com', 'owner')]);

    expect(result.success).toBe(true);
    expect(result.results.find((r) => r.email === 'new@acme.com')?.status).toBe('forbidden');
  });

  it('supervisor cannot grant owner (owner is non-grantable)', async () => {
    mockAuth.mockResolvedValue(makeSession('supervisor'));

    const result = await createInvites([item('new@acme.com', 'owner')]);

    expect(result.success).toBe(true);
    const row = result.results.find((r) => r.email === 'new@acme.com');
    expect(row?.status).toBe('forbidden');
    expect(row?.message).toBe('You cannot grant the requested role.');
  });

  it('owner cannot grant owner (owner is non-grantable)', async () => {
    mockAuth.mockResolvedValue(makeSession('owner'));

    const result = await createInvites([item('new@acme.com', 'owner')]);

    expect(result.success).toBe(true);
    expect(result.results.find((r) => r.email === 'new@acme.com')?.status).toBe('forbidden');
  });
});

// ── Valid invite path ─────────────────────────────────────────────────────────

describe('createInvites() — valid supervisor → hr invite', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(makeSession('supervisor'));
    stubOrgNoSubscription();
  });

  it('succeeds and returns sent status', async () => {
    const result = await createInvites([item('hr@acme.com', 'hr')]);

    expect(result.success).toBe(true);
    expect(result.results.find((r) => r.email === 'hr@acme.com')?.status).toBe('sent');
  });

  it('calls sendInviteEmail once with the invite link and role display name', async () => {
    await createInvites([item('hr@acme.com', 'hr')]);

    expect(mockSendInviteEmail).toHaveBeenCalledTimes(1);
    const [email, link, orgName, roleLabel] = mockSendInviteEmail.mock.calls[0];
    expect(email).toBe('hr@acme.com');
    expect(link).toMatch(/\/join\//);
    expect(orgName).toBe('Acme Corp');
    expect(roleLabel).toContain('HR');
  });

  it('calls prisma.invite.createMany with the requested role and organizationId', async () => {
    await createInvites([item('hr@acme.com', 'hr')]);

    expect(mockInviteCreateMany).toHaveBeenCalledTimes(1);
    const inviteData = mockInviteCreateMany.mock.calls[0][0].data[0];
    expect(inviteData.role).toBe('hr');
    expect(inviteData.organizationId).toBe('org-1');
    expect(inviteData.email).toBe('hr@acme.com');
  });

  it('revalidates the staff path after successful invite', async () => {
    await createInvites([item('hr@acme.com', 'hr')]);

    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/staff');
  });
});

// ── Per-item roles ────────────────────────────────────────────────────────────

describe('createInvites() — each email gets its own role', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(makeSession('owner'));
    stubOrgNoSubscription();
  });

  it('creates each invite with its own per-item role', async () => {
    const result = await createInvites([
      item('boss@acme.com', 'hr'),
      item('worker@acme.com', 'nurse'),
    ]);

    expect(result.success).toBe(true);
    const inserted = mockInviteCreateMany.mock.calls[0][0].data as Array<{
      email: string;
      role: string;
    }>;
    const byEmail = new Map(inserted.map((row) => [row.email, row.role]));
    expect(byEmail.get('boss@acme.com')).toBe('hr');
    expect(byEmail.get('worker@acme.com')).toBe('nurse');
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

    await createInvites([item('new@acme.com', 'nurse')]);

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

    await createInvites([item('new@acme.com', 'nurse')]);

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

    const result = await createInvites([item('new@acme.com', 'nurse')]);

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

    const result = await createInvites([item('new@acme.com', 'nurse')]);

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
    const result = await createInvites([item('new-hr@acme.com', 'hr')]);
    expect(result.results.find((r) => r.email === 'new-hr@acme.com')?.status).toBe('sent');
  });

  it('hr can invite finance', async () => {
    const result = await createInvites([item('new-finance@acme.com', 'finance')]);
    expect(result.results.find((r) => r.email === 'new-finance@acme.com')?.status).toBe('sent');
  });

  it('hr can invite clinical_director', async () => {
    const result = await createInvites([item('cd@acme.com', 'clinical_director')]);
    expect(result.results.find((r) => r.email === 'cd@acme.com')?.status).toBe('sent');
  });

  it('hr can invite a worker-category role (nurse)', async () => {
    const result = await createInvites([item('w@acme.com', 'nurse')]);
    expect(result.results.find((r) => r.email === 'w@acme.com')?.status).toBe('sent');
  });

  it.each([
    'psychiatrist_prescriber',
    'nurse',
    'therapist_clinician',
    'case_manager',
    'behavioral_health_technician',
    'peer_support_specialist',
    'front_desk_admin',
    'facilities_support',
  ] as const)('hr can invite worker role %s', async (workerRole) => {
    const result = await createInvites([item(`w-${workerRole}@acme.com`, workerRole)]);
    expect(result.results.find((r) => r.email === `w-${workerRole}@acme.com`)?.status).toBe('sent');
  });
});

// ── Existing member / already-invited rows ───────────────────────────────────

describe('createInvites() — existing member and pending-invite rows', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(makeSession('owner'));
    stubOrgNoSubscription();
  });

  it('flags an email that already belongs to a user in this org as "exists"', async () => {
    mockUserFindMany.mockResolvedValue([{ email: 'member@acme.com', organizationId: 'org-1' }]);

    const result = await createInvites([item('member@acme.com', 'nurse')]);

    expect(result.success).toBe(true);
    const row = result.results.find((r) => r.email === 'member@acme.com');
    expect(row?.status).toBe('exists');
    expect(row?.message).toBe('User is already a member.');
    expect(mockInviteCreateMany).not.toHaveBeenCalled();
  });

  it('flags an email that belongs to a user in a DIFFERENT org as "exists" with a login hint', async () => {
    mockUserFindMany.mockResolvedValue([
      { email: 'other-org@acme.com', organizationId: 'org-other' },
    ]);

    const result = await createInvites([item('other-org@acme.com', 'nurse')]);

    const row = result.results.find((r) => r.email === 'other-org@acme.com');
    expect(row?.status).toBe('exists');
    expect(row?.message).toMatch(/already has an account/i);
  });

  it('resends the invite email for an email with an existing pending invite, without duplicating the DB row', async () => {
    mockInviteFindMany.mockResolvedValue([
      { email: 'pending@acme.com', token: 'existing-token-123' },
    ]);

    const result = await createInvites([item('pending@acme.com', 'nurse')]);

    expect(result.success).toBe(true);
    const row = result.results.find((r) => r.email === 'pending@acme.com');
    expect(row?.status).toBe('resent');
    expect(mockInviteCreateMany).not.toHaveBeenCalled();
    expect(mockSendInviteEmail).toHaveBeenCalledWith(
      'pending@acme.com',
      expect.stringContaining('existing-token-123'),
      'Acme Corp',
      expect.any(String),
    );
  });
});

// ── Mixed batch: valid manager + valid worker + non-grantable + duplicate + existing user ──

describe('createInvites() — mixed batch produces correct per-row statuses', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(makeSession('owner'));
    stubOrgNoSubscription();
  });

  it('handles a batch of valid-manager, valid-worker, non-grantable, duplicate, and existing-member rows independently', async () => {
    // 'member@acme.com' is already a member of this org.
    mockUserFindMany.mockResolvedValue([{ email: 'member@acme.com', organizationId: 'org-1' }]);

    const result = await createInvites([
      item('new-hr@acme.com', 'hr'), // valid manager
      item('new-nurse@acme.com', 'nurse'), // valid worker
      item('bad-role@acme.com', 'not-a-real-role'), // non-grantable / invalid role
      item('new-hr@acme.com', 'finance'), // duplicate email — first role (hr) wins, row deduped
      item('member@acme.com', 'nurse'), // already a member
    ]);

    expect(result.success).toBe(true);
    const byEmail = new Map(result.results.map((r) => [r.email, r]));

    expect(byEmail.get('new-hr@acme.com')?.status).toBe('sent');
    expect(byEmail.get('new-nurse@acme.com')?.status).toBe('sent');
    expect(byEmail.get('bad-role@acme.com')?.status).toBe('forbidden');
    expect(byEmail.get('member@acme.com')?.status).toBe('exists');

    // Only the two genuinely new, valid, non-duplicate rows reach the DB insert.
    const inserted = mockInviteCreateMany.mock.calls[0][0].data as Array<{
      email: string;
      role: string;
    }>;
    expect(inserted).toHaveLength(2);
    const insertedByEmail = new Map(inserted.map((row) => [row.email, row.role]));
    // The duplicate email keeps the FIRST role seen ('hr'), not the second ('finance').
    expect(insertedByEmail.get('new-hr@acme.com')).toBe('hr');
    expect(insertedByEmail.get('new-nurse@acme.com')).toBe('nurse');
  });
});

// ── Seat-cap interaction with a mixed batch ──────────────────────────────────

describe('createInvites() — seat cap counts only genuinely new seats in a mixed batch', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(makeSession('owner'));
    mockOrgFindUnique.mockResolvedValue({
      name: 'Acme Corp',
      subscription: { plan: 'starter', status: 'active' },
    });
  });

  it('rejects the whole batch when new (non-duplicate, non-existing) seats would exceed the plan limit', async () => {
    // 9 active + 0 pending = 9/10 used. Two brand-new emails would need 2 more seats (11 > 10).
    mockUserCount.mockResolvedValue(9);
    mockInviteCount.mockResolvedValue(0);
    mockUserFindMany.mockResolvedValue([]);
    mockInviteFindMany.mockResolvedValue([]);

    const result = await createInvites([
      item('brand-new-1@acme.com', 'nurse'),
      item('brand-new-2@acme.com', 'hr'),
    ]);

    expect(result.success).toBe(false);
    expect(result.limitError?.current).toBe(9);
    expect(mockInviteCreateMany).not.toHaveBeenCalled();
  });

  it('does not count an already-known (existing member/invite) email against the new-seats total', async () => {
    // 9/10 used. One of the two requested emails is already a pending invite —
    // only 1 genuinely new seat is needed, which fits.
    mockUserCount.mockResolvedValue(9);
    mockInviteCount.mockResolvedValue(0);
    mockUserFindMany.mockResolvedValue([]);
    mockInviteFindMany
      .mockResolvedValueOnce([{ email: 'already-pending@acme.com' }]) // dedupe lookup
      .mockResolvedValueOnce([{ email: 'already-pending@acme.com', token: 'tok-1' }]); // batch lookup

    const result = await createInvites([
      item('already-pending@acme.com', 'nurse'),
      item('brand-new@acme.com', 'hr'),
    ]);

    expect(result.success).toBe(true);
    expect(result.results.find((r) => r.email === 'brand-new@acme.com')?.status).toBe('sent');
    expect(result.results.find((r) => r.email === 'already-pending@acme.com')?.status).toBe(
      'resent',
    );
  });

  it('forbidden (non-grantable) rows never consume a seat-limit slot', async () => {
    // 10/10 used — no seats left at all. A forbidden-role row must still be
    // rejected for its role, not for the seat limit, and must not block it from
    // being flagged 'forbidden' rather than silently dropped.
    mockUserCount.mockResolvedValue(10);
    mockInviteCount.mockResolvedValue(0);
    mockUserFindMany.mockResolvedValue([]);
    mockInviteFindMany.mockResolvedValue([]);

    const result = await createInvites([item('no-seat@acme.com', 'owner')]);

    // 'owner' is non-grantable for an owner-inviter, so this row is forbidden
    // before the seat check ever runs against it, and the batch as a whole
    // succeeds with zero seats consumed.
    expect(result.success).toBe(true);
    expect(result.results.find((r) => r.email === 'no-seat@acme.com')?.status).toBe('forbidden');
    expect(mockInviteCreateMany).not.toHaveBeenCalled();
  });
});
