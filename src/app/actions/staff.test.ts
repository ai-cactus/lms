/**
 * THER-007 regression tests for resendInvite:
 *   - Authorization: caller must be an authenticated admin who owns the
 *     invite's organization.
 *   - Token + expiry regeneration: a fresh token and a ~7-day expiry window
 *     are written, invalidating any previously-shared (stale) invite link.
 *   - Status reset to 'pending' so an expired invite becomes usable again.
 *   - An already-accepted invite is not silently "resent" — it returns a
 *     distinct, non-throwing error instead.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, prismaMock, mockSendInviteEmail } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  prismaMock: {
    user: { findUnique: vi.fn() },
    invite: { findUnique: vi.fn(), update: vi.fn() },
  },
  mockSendInviteEmail: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// resendInvite dynamically imports '@/lib/email' — mock the module path.
vi.mock('@/lib/email', () => ({ sendInviteEmail: mockSendInviteEmail }));

import { resendInvite } from './staff';

const ADMIN = { role: 'admin', organizationId: 'org-1' };
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
  prismaMock.user.findUnique.mockResolvedValue(ADMIN);
  prismaMock.invite.findUnique.mockResolvedValue(PENDING_INVITE);
  prismaMock.invite.update.mockResolvedValue({});
  mockSendInviteEmail.mockResolvedValue(undefined);
});

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
