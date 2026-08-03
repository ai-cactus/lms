/**
 * Unit tests for updateDigestFrequency — the owner-gated server action behind
 * the Settings → Notifications tab.
 *
 * Settings is owner-only by product decision; because a server action is a
 * public endpoint regardless of what the page itself gates, this action
 * re-enforces both the admin-role guard (requireActionSession) AND an explicit
 * `role === 'owner'` check rather than trusting the caller reached it through
 * the owner-gated page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, prismaMock, mockRevalidatePath, mockLogger } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  prismaMock: { organization: { update: vi.fn() } },
  mockRevalidatePath: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }));
vi.mock('@/lib/logger', () => ({ logger: mockLogger }));

import { updateDigestFrequency } from './notification-settings';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.organization.update.mockResolvedValue({});
});

function sessionFor(role: string, organizationId: string | null = 'org-1') {
  return { user: { id: 'user-1', role, organizationId } };
}

describe('updateDigestFrequency — authorization', () => {
  it('rejects an unauthenticated caller (no session) as Unauthorized', async () => {
    mockAuth.mockResolvedValue(null);

    const result = await updateDigestFrequency({ frequency: 'weekly' });

    expect(result).toEqual({ success: false, error: 'Unauthorized' });
    expect(prismaMock.organization.update).not.toHaveBeenCalled();
  });

  it('rejects a worker role (not even an admin role) as Unauthorized', async () => {
    mockAuth.mockResolvedValue(sessionFor('nurse'));

    const result = await updateDigestFrequency({ frequency: 'weekly' });

    expect(result).toEqual({ success: false, error: 'Unauthorized' });
    expect(prismaMock.organization.update).not.toHaveBeenCalled();
  });

  it.each(['supervisor', 'hr', 'clinical_director', 'finance'])(
    'rejects a non-owner admin role (%s) with a distinct owner-only message',
    async (role) => {
      mockAuth.mockResolvedValue(sessionFor(role));

      const result = await updateDigestFrequency({ frequency: 'weekly' });

      expect(result).toEqual({
        success: false,
        error: 'Only the organization owner can change this setting.',
      });
      expect(prismaMock.organization.update).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: expect.stringContaining('Digest frequency update denied'),
          role,
        }),
      );
    },
  );

  it('allows the owner role through', async () => {
    mockAuth.mockResolvedValue(sessionFor('owner'));

    const result = await updateDigestFrequency({ frequency: 'weekly' });

    expect(result).toEqual({ success: true });
  });
});

describe('updateDigestFrequency — validation', () => {
  it('rejects an invalid enum value even for the owner, without touching the DB', async () => {
    mockAuth.mockResolvedValue(sessionFor('owner'));

    const result = await updateDigestFrequency({
      // @ts-expect-error deliberately invalid to exercise zod validation
      frequency: 'monthly',
    });

    expect(result).toEqual({
      success: false,
      error: 'Choose either a daily or a weekly digest.',
    });
    expect(prismaMock.organization.update).not.toHaveBeenCalled();
  });

  it('returns "No organization found" when the owner session has no organizationId', async () => {
    mockAuth.mockResolvedValue(sessionFor('owner', null));

    const result = await updateDigestFrequency({ frequency: 'daily' });

    expect(result).toEqual({ success: false, error: 'No organization found' });
    expect(prismaMock.organization.update).not.toHaveBeenCalled();
  });
});

describe('updateDigestFrequency — happy path', () => {
  it('updates the organization column, revalidates the settings path, and returns success', async () => {
    mockAuth.mockResolvedValue(sessionFor('owner'));

    const result = await updateDigestFrequency({ frequency: 'weekly' });

    expect(prismaMock.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { notificationDigestFrequency: 'weekly' },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/settings');
    expect(result).toEqual({ success: true });
  });

  it('accepts "daily" as well', async () => {
    mockAuth.mockResolvedValue(sessionFor('owner'));

    const result = await updateDigestFrequency({ frequency: 'daily' });

    expect(prismaMock.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { notificationDigestFrequency: 'daily' } }),
    );
    expect(result).toEqual({ success: true });
  });
});

describe('updateDigestFrequency — resilience', () => {
  it('returns a generic failure (not a thrown error) when the DB update fails', async () => {
    mockAuth.mockResolvedValue(sessionFor('owner'));
    prismaMock.organization.update.mockRejectedValueOnce(new Error('DB connection lost'));

    const result = await updateDigestFrequency({ frequency: 'daily' });

    expect(result).toEqual({ success: false, error: 'Failed to update notification settings' });
  });
});
