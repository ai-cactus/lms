/**
 * Tests for updateProfile() (src/app/actions/user.ts).
 *
 * QA fix: the server action trusted `data.first_name`/`data.last_name`
 * verbatim — an empty string, whitespace-only string, or an arbitrarily long
 * string all passed straight through to the DB (the client is not a trust
 * boundary). Now mirrors the accept-invite zod bounds: non-empty after trim,
 * max 100 characters.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  prismaMock,
  mockHeaders,
  mockAdminAuth,
  mockWorkerAuth,
  mockRevalidatePath,
  mockInvalidateRevalidationCache,
  mockBcryptCompare,
  mockBcryptHash,
} = vi.hoisted(() => ({
  // Profile was merged into User (name fields live directly on the identity);
  // jobTitle now lives on the active OrganizationUser membership.
  prismaMock: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    organizationUser: { update: vi.fn() },
  },
  mockHeaders: vi.fn(),
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockInvalidateRevalidationCache: vi.fn(),
  mockBcryptCompare: vi.fn(),
  mockBcryptHash: vi.fn(),
}));

vi.mock('next/headers', () => ({ headers: mockHeaders }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// changePassword actively busts the JWT revalidation cache; stub it so tests
// don't reach the real Redis client, and kept as a spy (not an inline
// vi.fn()) so tests can assert it's actually called.
vi.mock('@/lib/auth/session-revalidation-cache', () => ({
  invalidateRevalidationCache: mockInvalidateRevalidationCache,
}));
vi.mock('bcryptjs', () => ({
  default: { compare: mockBcryptCompare, hash: mockBcryptHash },
  compare: mockBcryptCompare,
  hash: mockBcryptHash,
}));

import { updateProfile, changePassword } from './user';

const SESSION = { user: { id: 'user-1', email: 'user@acme.com' } };

function baseData(overrides: Partial<Parameters<typeof updateProfile>[0]> = {}) {
  return {
    first_name: 'Jane',
    last_name: 'Doe',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHeaders.mockResolvedValue({ get: () => null }); // non-worker referer → resolveSession uses adminAuth
  mockAdminAuth.mockResolvedValue(SESSION);
  mockWorkerAuth.mockResolvedValue(null);
  prismaMock.user.update.mockResolvedValue({ id: 'user-1' });
});

describe('updateProfile — server-side name validation', () => {
  it('rejects an empty first name and never touches the database', async () => {
    const result = await updateProfile(baseData({ first_name: '' }));

    expect(result).toEqual({ success: false, error: 'First and last name are required.' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only last name and never touches the database', async () => {
    const result = await updateProfile(baseData({ last_name: '   ' }));

    expect(result).toEqual({ success: false, error: 'First and last name are required.' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('rejects a first name over 100 characters', async () => {
    const result = await updateProfile(baseData({ first_name: 'a'.repeat(101) }));

    expect(result).toEqual({
      success: false,
      error: 'Name is too long (maximum 100 characters).',
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('rejects a last name over 100 characters', async () => {
    const result = await updateProfile(baseData({ last_name: 'b'.repeat(101) }));

    expect(result).toEqual({
      success: false,
      error: 'Name is too long (maximum 100 characters).',
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('accepts a name at exactly the 100-character boundary', async () => {
    const result = await updateProfile(baseData({ first_name: 'a'.repeat(100) }));

    expect(result).toEqual({ success: true });
    expect(prismaMock.user.update).toHaveBeenCalledOnce();
  });

  it('trims surrounding whitespace before persisting and computing the full name', async () => {
    const result = await updateProfile(baseData({ first_name: '  Jane ', last_name: ' Doe  ' }));

    expect(result).toEqual({ success: true });
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          firstName: 'Jane',
          lastName: 'Doe',
          fullName: 'Jane Doe',
        }),
      }),
    );
  });

  it('returns "Not authenticated" without validating names when there is no session', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(null);

    const result = await updateProfile(baseData({ first_name: '' }));

    expect(result).toEqual({ success: false, error: 'Not authenticated' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// changePassword() — self-service password change. F-059 bumps sessionVersion
// on completion; commit 66aa961 added an active cache bust on top so the
// invalidation isn't bounded by the revalidation cache's TTL.
// ---------------------------------------------------------------------------

describe('changePassword — self-service password change', () => {
  const EXISTING_HASH = 'existing-hashed-password';

  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValue({
      password: EXISTING_HASH,
      authProvider: 'credentials',
    });
    prismaMock.user.update.mockResolvedValue({});
    mockInvalidateRevalidationCache.mockResolvedValue(undefined);
    mockBcryptCompare.mockResolvedValue(true);
    mockBcryptHash.mockResolvedValue('new-hashed-password');
  });

  it('returns "Not authenticated" and touches no DB when there is no session', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(null);

    const result = await changePassword({
      currentPassword: 'oldPass1!',
      newPassword: 'NewStr0ng!Pass1',
    });

    expect(result).toEqual({ success: false, error: 'Not authenticated' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(mockInvalidateRevalidationCache).not.toHaveBeenCalled();
  });

  it("updates the password, bumps sessionVersion, and busts the session's cached revalidation snapshot by id, after the DB write", async () => {
    const result = await changePassword({
      currentPassword: 'correctCurrentPass1!',
      newPassword: 'NewStr0ng!Pass1',
    });

    expect(result).toEqual({ success: true });
    expect(mockBcryptCompare).toHaveBeenCalledWith('correctCurrentPass1!', EXISTING_HASH);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        password: 'new-hashed-password',
        passwordResetRequired: false,
        sessionVersion: { increment: 1 },
      },
    });
    // commit 66aa961: unlike the pre-existing F-059 sessionVersion bump alone
    // (which only self-heals within the cache TTL), this is the active bust
    // that makes the invalidation immediate.
    expect(mockInvalidateRevalidationCache).toHaveBeenCalledExactlyOnceWith('user-1');
    expect(prismaMock.user.update.mock.invocationCallOrder[0]).toBeLessThan(
      mockInvalidateRevalidationCache.mock.invocationCallOrder[0],
    );
  });

  it('rejects an OAuth account (no password to change) and does NOT invalidate the cache', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ password: null, authProvider: 'google' });

    const result = await changePassword({ newPassword: 'NewStr0ng!Pass1' });

    expect(result).toEqual({
      success: false,
      error: 'Cannot change password for OAuth accounts.',
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(mockInvalidateRevalidationCache).not.toHaveBeenCalled();
  });

  it('returns "Incorrect current password." and does NOT update or invalidate when the current password is wrong', async () => {
    mockBcryptCompare.mockResolvedValue(false);

    const result = await changePassword({
      currentPassword: 'wrongPass',
      newPassword: 'NewStr0ng!Pass1',
    });

    expect(result).toEqual({ success: false, error: 'Incorrect current password.' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(mockInvalidateRevalidationCache).not.toHaveBeenCalled();
  });

  it('rejects a new password under 12 characters before ever touching the DB', async () => {
    const result = await changePassword({
      currentPassword: 'correctCurrentPass1!',
      newPassword: 'short1!',
    });

    expect(result).toEqual({
      success: false,
      error: 'New password must be at least 12 characters long.',
    });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(mockInvalidateRevalidationCache).not.toHaveBeenCalled();
  });

  it('returns a generic failure and does NOT invalidate the cache when the DB update throws', async () => {
    prismaMock.user.update.mockRejectedValue(new Error('connection pool exhausted'));

    const result = await changePassword({
      currentPassword: 'correctCurrentPass1!',
      newPassword: 'NewStr0ng!Pass1',
    });

    expect(result).toEqual({ success: false, error: 'Failed to change password' });
    expect(mockInvalidateRevalidationCache).not.toHaveBeenCalled();
  });
});
