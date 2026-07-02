/**
 * Unit tests for src/app/actions/staff.ts
 *
 * updateStaffDetails() — Owner role is established ONLY at org creation:
 *   - Promoting a non-owner to owner via updateStaffDetails must be rejected.
 *   - An existing owner keeping their role while editing name/title is allowed.
 *
 * resendInvite() — THER-007 regression tests:
 *   - Authorization: caller must be an authenticated admin who owns the
 *     invite's organization.
 *   - Token + expiry regeneration: a fresh token and a ~7-day expiry window
 *     are written, invalidating any previously-shared (stale) invite link.
 *   - Status reset to 'pending' so an expired invite becomes usable again.
 *   - An already-accepted invite is not silently "resent" — it returns a
 *     distinct, non-throwing error instead.
 *
 * External deps (@/auth, @/lib/prisma, next/cache, @/lib/email) are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockAuth,
  mockUserFindUnique,
  mockUserUpdate,
  mockProfileUpsert,
  mockInviteFindUnique,
  mockInviteUpdate,
  mockRevalidatePath,
  mockSendInviteEmail,
  prismaMock,
} = vi.hoisted(() => {
  const mockUserFindUnique = vi.fn();
  const mockUserUpdate = vi.fn();
  const mockProfileUpsert = vi.fn();
  const mockInviteFindUnique = vi.fn();
  const mockInviteUpdate = vi.fn();
  const prismaMock = {
    user: { findUnique: mockUserFindUnique, update: mockUserUpdate },
    profile: { upsert: mockProfileUpsert },
    invite: { findUnique: mockInviteFindUnique, update: mockInviteUpdate },
  };
  return {
    mockAuth: vi.fn(),
    mockUserFindUnique,
    mockUserUpdate,
    mockProfileUpsert,
    mockInviteFindUnique,
    mockInviteUpdate,
    mockRevalidatePath: vi.fn(),
    mockSendInviteEmail: vi.fn(),
    prismaMock,
  };
});

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }));
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));
// resendInvite dynamically imports '@/lib/email' — mock the module path.
vi.mock('@/lib/email', () => ({ sendInviteEmail: mockSendInviteEmail }));

import { updateStaffDetails, resendInvite } from './staff';

// ── Helpers & fixtures ──────────────────────────────────────────────────────────

function makeAdminSession(role = 'owner') {
  return {
    user: { id: 'admin-1', email: 'admin@acme.com', role, organizationId: 'org-1' },
  };
}

const baseData = {
  firstName: 'Jane',
  lastName: 'Doe',
  role: 'worker' as const,
  jobTitle: 'Nurse',
};

const ADMIN = { role: 'owner', organizationId: 'org-1' };
const PENDING_INVITE = {
  organizationId: 'org-1',
  email: 'newstaff@example.com',
  role: 'worker',
  status: 'pending',
  organization: { name: 'Acme Co' },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com';
  mockAuth.mockResolvedValue({ user: { id: 'admin-1' } });
  mockUserFindUnique.mockResolvedValue(ADMIN);
  mockUserUpdate.mockResolvedValue({ id: 'target-1', email: 'target@acme.com' });
  mockProfileUpsert.mockResolvedValue({});
  mockInviteFindUnique.mockResolvedValue(PENDING_INVITE);
  mockInviteUpdate.mockResolvedValue({});
  mockSendInviteEmail.mockResolvedValue(undefined);
});

// ── updateStaffDetails() ────────────────────────────────────────────────────────

// ── Auth guard ────────────────────────────────────────────────────────────────

describe('updateStaffDetails() — auth guard', () => {
  it('returns Unauthorized when there is no session', async () => {
    mockAuth.mockResolvedValue(null);
    const result = await updateStaffDetails('target-1', baseData);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Unauthorized');
  });

  it('returns Unauthorized when the requester is a worker', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'w-1', email: 'w@a.com', role: 'worker', organizationId: 'org-1' },
    });
    const result = await updateStaffDetails('target-1', baseData);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Unauthorized');
  });
});

// ── Owner-promotion guard ─────────────────────────────────────────────────────

describe('updateStaffDetails() — owner role cannot be granted via edit (one-owner invariant)', () => {
  it('rejects promotion of a worker to owner', async () => {
    mockAuth.mockResolvedValue(makeAdminSession('owner'));
    // Target is currently a worker (non-owner)
    mockUserFindUnique.mockResolvedValue({ organizationId: 'org-1', role: 'worker' });

    const result = await updateStaffDetails('target-1', {
      ...baseData,
      role: 'owner',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Owner role cannot be assigned/i);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('rejects promotion of a supervisor to owner', async () => {
    mockAuth.mockResolvedValue(makeAdminSession('owner'));
    mockUserFindUnique.mockResolvedValue({ organizationId: 'org-1', role: 'supervisor' });

    const result = await updateStaffDetails('target-1', {
      ...baseData,
      role: 'owner',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Owner role cannot be assigned/i);
  });

  it('allows an existing owner to keep their role while changing name/title', async () => {
    mockAuth.mockResolvedValue(makeAdminSession('owner'));
    // Target is already an owner — keeping their role is allowed
    mockUserFindUnique.mockResolvedValue({ organizationId: 'org-1', role: 'owner' });

    const result = await updateStaffDetails('target-1', {
      firstName: 'Alice',
      lastName: 'Smith',
      role: 'owner',
      jobTitle: 'CEO',
    });

    expect(result.success).toBe(true);
    expect(mockUserUpdate).toHaveBeenCalledOnce();
  });
});

// ── Tenant isolation ──────────────────────────────────────────────────────────

describe('updateStaffDetails() — tenant isolation', () => {
  it('rejects when the target user belongs to a different org', async () => {
    mockAuth.mockResolvedValue(makeAdminSession('owner'));
    // Target is in a different org
    mockUserFindUnique.mockResolvedValue({ organizationId: 'org-OTHER', role: 'worker' });

    const result = await updateStaffDetails('target-1', baseData);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Forbidden');
  });

  it('rejects when the target user is not found', async () => {
    mockAuth.mockResolvedValue(makeAdminSession('owner'));
    mockUserFindUnique.mockResolvedValue(null);

    const result = await updateStaffDetails('target-1', baseData);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Forbidden');
  });
});

// ── Happy path ────────────────────────────────────────────────────────────────

describe('updateStaffDetails() — happy path', () => {
  it('updates the user role and profile when all checks pass', async () => {
    mockAuth.mockResolvedValue(makeAdminSession('owner'));
    mockUserFindUnique.mockResolvedValue({ organizationId: 'org-1', role: 'worker' });

    const result = await updateStaffDetails('target-1', {
      firstName: 'Jane',
      lastName: 'Doe',
      role: 'supervisor',
      jobTitle: 'Supervisor',
    });

    expect(result.success).toBe(true);
    expect(mockUserUpdate).toHaveBeenCalledOnce();
    expect(mockUserUpdate.mock.calls[0][0].data.role).toBe('supervisor');
    expect(mockProfileUpsert).toHaveBeenCalledOnce();
  });
});

// ── resendInvite() ──────────────────────────────────────────────────────────────

describe('resendInvite — authorization', () => {
  it('rejects when there is no session', async () => {
    mockAuth.mockResolvedValue(null);

    const result = await resendInvite('invite-1');

    expect(result).toEqual({ success: false, error: 'Unauthorized' });
    expect(prismaMock.invite.update).not.toHaveBeenCalled();
  });

  it('rejects a non-admin caller', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'worker', organizationId: 'org-1' });

    const result = await resendInvite('invite-1');

    expect(result).toEqual({ success: false, error: 'Insufficient permissions' });
    expect(prismaMock.invite.update).not.toHaveBeenCalled();
  });

  it('rejects when the invite belongs to a different organization', async () => {
    prismaMock.invite.findUnique.mockResolvedValue({ ...PENDING_INVITE, organizationId: 'org-2' });

    const result = await resendInvite('invite-1');

    expect(result).toEqual({
      success: false,
      error: 'Invite does not belong to your organization',
    });
    expect(prismaMock.invite.update).not.toHaveBeenCalled();
  });

  it('returns "Invite not found" for an unknown invite id', async () => {
    prismaMock.invite.findUnique.mockResolvedValue(null);

    const result = await resendInvite('bad-id');

    expect(result).toEqual({ success: false, error: 'Invite not found' });
  });
});

describe('resendInvite — already-accepted invite', () => {
  it('does not regenerate the token and returns a clear, non-throwing error', async () => {
    prismaMock.invite.findUnique.mockResolvedValue({ ...PENDING_INVITE, status: 'accepted' });

    const result = await resendInvite('invite-1');

    expect(result).toEqual({
      success: false,
      error: 'This invite has already been accepted.',
    });
    expect(prismaMock.invite.update).not.toHaveBeenCalled();
    expect(mockSendInviteEmail).not.toHaveBeenCalled();
  });
});

describe('resendInvite — happy path (token + expiry regeneration, status reset)', () => {
  it('regenerates the token, sets a ~7-day expiry, resets status to pending, and emails the link', async () => {
    const before = Date.now();
    const result = await resendInvite('invite-1');
    const after = Date.now();

    expect(result).toEqual({ success: true });

    const updateCall = prismaMock.invite.update.mock.calls[0][0];
    expect(updateCall.where).toEqual({ id: 'invite-1' });
    expect(updateCall.data.status).toBe('pending');
    expect(typeof updateCall.data.token).toBe('string');
    expect(updateCall.data.token.length).toBeGreaterThan(0);

    const expiresAt: Date = updateCall.data.expiresAt;
    expect(expiresAt).toBeInstanceOf(Date);
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + SEVEN_DAYS_MS - 5_000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(after + SEVEN_DAYS_MS + 5_000);

    expect(mockSendInviteEmail).toHaveBeenCalledWith(
      'newstaff@example.com',
      expect.stringContaining(`https://app.example.com/join/${updateCall.data.token}`),
      'Acme Co',
      'worker',
    );
  });

  it('generates a DIFFERENT token each call, invalidating any previously-shared link', async () => {
    await resendInvite('invite-1');
    const firstToken = prismaMock.invite.update.mock.calls[0][0].data.token;

    prismaMock.invite.update.mockClear();
    await resendInvite('invite-1');
    const secondToken = prismaMock.invite.update.mock.calls[0][0].data.token;

    expect(secondToken).not.toBe(firstToken);
  });
});
