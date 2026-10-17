/**
 * The /system console's side of the permanent user delete.
 *
 *  - only `Unauthorized` is thrown; every refusal is RETURNED (a thrown Server
 *    Action error is redacted in production);
 *  - the flag is checked before the rate limit and before the lib is touched;
 *  - the rate limit is the shared fail-closed destructive-action limit;
 *  - each lib status maps to its approved message.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockHardDelete,
  mockPreview,
  mockVerifyCookie,
  mockRevalidatePath,
  mockCheckRateLimit,
  mockLogger,
} = vi.hoisted(() => ({
  mockHardDelete: vi.fn(),
  mockPreview: vi.fn(),
  mockVerifyCookie: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: {}, default: {} }));
vi.mock('@/db/index', () => ({ rawPrisma: {}, prisma: {} }));
vi.mock('@/lib/system/delete-user', () => ({
  softDeleteUser: vi.fn(),
  findOwnershipBlocks: vi.fn(),
  describeOwnershipBlocks: vi.fn(),
}));
vi.mock('@/lib/system/delete-organization', () => ({
  softDeleteOrganization: vi.fn(),
  restoreOrganization: vi.fn(),
  previewOrganizationSoftDelete: vi.fn(),
  previewOrganizationRestore: vi.fn(),
}));
vi.mock('@/lib/system/hard-delete-user', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/system/hard-delete-user')>();
  return { ...actual, hardDeleteUser: mockHardDelete, previewUserHardDelete: mockPreview };
});
vi.mock('@/lib/system-auth', () => ({
  verifySystemAdminCookie: mockVerifyCookie,
  SYSTEM_ADMIN_COOKIE: 'system_admin_auth',
}));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ set: vi.fn(), get: vi.fn(), delete: vi.fn() }),
  headers: async () =>
    new Headers({ 'x-forwarded-for': '203.0.113.9', 'user-agent': 'vitest-agent' }),
}));
vi.mock('@/lib/logger', () => ({ logger: mockLogger, maskEmail: (e: string) => e }));
vi.mock('@/lib/audit', () => ({
  audit: vi.fn(),
  getClientContext: (h: Headers) => ({
    ip: h.get('x-forwarded-for') ?? undefined,
    userAgent: h.get('user-agent') ?? undefined,
  }),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mockCheckRateLimit }));

import { getUserHardDeletePreview, hardDeleteUser } from './system-admin';
import {
  EMAIL_MISMATCH_REFUSAL,
  NOT_ACKNOWLEDGED_REFUSAL,
  NOT_SOFT_DELETED_REFUSAL,
} from '@/lib/system/hard-delete-user';
import { HARD_DELETE_DISABLED_REFUSAL } from '@/lib/system/hard-delete-flag';

const USER_ID = 'user-1';
const CONFIRM = { confirmEmail: 'dana@acme.test', acknowledged: true };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SYSTEM_HARD_DELETE_ENABLED', 'true');
  mockVerifyCookie.mockResolvedValue(true);
  mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetInSeconds: 900 });
});

describe('unauthenticated callers', () => {
  it.each([
    ['getUserHardDeletePreview', () => getUserHardDeletePreview(USER_ID)],
    ['hardDeleteUser', () => hardDeleteUser(USER_ID, CONFIRM)],
  ])('%s throws Unauthorized and touches nothing', async (_name, call) => {
    mockVerifyCookie.mockResolvedValue(false);

    await expect(call()).rejects.toThrow('Unauthorized');

    expect(mockPreview).not.toHaveBeenCalled();
    expect(mockHardDelete).not.toHaveBeenCalled();
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });
});

describe('getUserHardDeletePreview', () => {
  it('returns the lib preview', async () => {
    const preview = { enabled: true, refusal: null };
    mockPreview.mockResolvedValue(preview);

    await expect(getUserHardDeletePreview(USER_ID)).resolves.toBe(preview);
    expect(mockPreview).toHaveBeenCalledWith(USER_ID);
  });

  it('returns null for an unknown user', async () => {
    mockPreview.mockResolvedValue(null);

    await expect(getUserHardDeletePreview(USER_ID)).resolves.toBeNull();
  });
});

describe('hardDeleteUser', () => {
  it('returns a refusal, not a throw, when the flag is off, before the limiter or the lib', async () => {
    vi.stubEnv('SYSTEM_HARD_DELETE_ENABLED', 'false');

    await expect(hardDeleteUser(USER_ID, CONFIRM)).resolves.toEqual({
      success: false,
      error: HARD_DELETE_DISABLED_REFUSAL,
    });
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
    expect(mockHardDelete).not.toHaveBeenCalled();
  });

  it('rate-limits fail-closed on the shared destructive key and returns the wait time', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetInSeconds: 321 });

    await expect(hardDeleteUser(USER_ID, CONFIRM)).resolves.toEqual({
      success: false,
      error: 'Too many attempts. Please wait 321 seconds and try again.',
    });
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      'system-admin-destructive:203.0.113.9',
      10,
      900,
      {
        failClosed: true,
      },
    );
    expect(mockHardDelete).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it('passes the confirmation and the system-admin audit context to the lib', async () => {
    mockHardDelete.mockResolvedValue({
      status: 'deleted',
      counts: {},
      storage: { attempted: 0, failed: 0 },
    });

    await hardDeleteUser(USER_ID, CONFIRM);

    expect(mockHardDelete).toHaveBeenCalledWith(USER_ID, CONFIRM, {
      actorRole: 'system_admin',
      ip: '203.0.113.9',
      userAgent: 'vitest-agent',
    });
  });

  it('coerces malformed client input: a non-true acknowledgement is false and a missing email is empty', async () => {
    mockHardDelete.mockResolvedValue({ status: 'not_acknowledged' });

    await hardDeleteUser(USER_ID, { confirmEmail: undefined, acknowledged: 'true' } as never);

    expect(mockHardDelete).toHaveBeenCalledWith(
      USER_ID,
      { confirmEmail: '', acknowledged: false },
      expect.anything(),
    );
  });

  it('on success revalidates /system and reports the storage failures', async () => {
    mockHardDelete.mockResolvedValue({
      status: 'deleted',
      counts: {},
      storage: { attempted: 4, failed: 2 },
    });

    await expect(hardDeleteUser(USER_ID, CONFIRM)).resolves.toEqual({
      success: true,
      storageFailures: 2,
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith('/system');
  });

  it.each([
    [{ status: 'disabled' }, HARD_DELETE_DISABLED_REFUSAL],
    [{ status: 'not_found' }, 'User not found'],
    [{ status: 'not_soft_deleted' }, NOT_SOFT_DELETED_REFUSAL],
    [{ status: 'confirmation_mismatch' }, EMAIL_MISMATCH_REFUSAL],
    [{ status: 'not_acknowledged' }, NOT_ACKNOWLEDGED_REFUSAL],
    [
      { status: 'refused', message: 'This user authored 1 course(s) and uploaded 0 document(s).' },
      'This user authored 1 course(s) and uploaded 0 document(s).',
    ],
  ])('maps %j to a returned error without revalidating', async (result, message) => {
    mockHardDelete.mockResolvedValue(result);

    await expect(hardDeleteUser(USER_ID, CONFIRM)).resolves.toEqual({
      success: false,
      error: message,
    });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it('turns an unexpected lib error into a safe returned message and logs it', async () => {
    mockHardDelete.mockRejectedValue(new Error('connection to db-prod-7 lost'));

    const result = await hardDeleteUser(USER_ID, CONFIRM);

    expect(result).toEqual({
      success: false,
      error: 'Failed to permanently delete user. Please try again.',
    });
    expect(JSON.stringify(result)).not.toContain('db-prod-7');
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, err: expect.any(Error) }),
    );
  });

  it('returns a safe message when the rate limiter itself fails', async () => {
    mockCheckRateLimit.mockRejectedValue(new Error('redis down'));

    await expect(hardDeleteUser(USER_ID, CONFIRM)).resolves.toEqual({
      success: false,
      error: 'Failed to permanently delete user. Please try again.',
    });
    expect(mockHardDelete).not.toHaveBeenCalled();
  });
});
