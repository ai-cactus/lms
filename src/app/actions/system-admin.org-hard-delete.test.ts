/**
 * The /system console's side of the permanent organization delete.
 *
 *  - only `Unauthorized` is thrown; every refusal is RETURNED (a thrown Server
 *    Action error is redacted in production);
 *  - the flag is checked before the rate limit and before the lib is touched;
 *  - the rate limit is the shared fail-closed destructive-action limit;
 *  - untrusted input is coerced before it reaches the lib;
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
vi.mock('@/lib/system/hard-delete-organization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/system/hard-delete-organization')>();
  return {
    ...actual,
    hardDeleteOrganization: mockHardDelete,
    previewOrganizationHardDelete: mockPreview,
  };
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
  auditCritical: vi.fn(),
  getClientContext: (h: Headers) => ({
    ip: h.get('x-forwarded-for') ?? undefined,
    userAgent: h.get('user-agent') ?? undefined,
  }),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mockCheckRateLimit }));

import { getOrganizationHardDeletePreview, hardDeleteOrganization } from './system-admin';
import {
  NOT_ACKNOWLEDGED_ORGANIZATION_REFUSAL,
  NOT_SOFT_DELETED_ORGANIZATION_REFUSAL,
} from '@/lib/system/hard-delete-organization';
import { HARD_DELETE_DISABLED_REFUSAL } from '@/lib/system/hard-delete-flag';
import { ORGANIZATION_CONFIRMATION_MISMATCH_REFUSAL } from '@/lib/system/organization-delete-confirm';

const ORG_ID = 'org-1';
const CONFIRM = {
  confirmName: 'Acme',
  confirmWord: 'DELETE',
  acknowledged: true,
  cancelSubscription: true,
};
const DELETED = {
  status: 'deleted',
  counts: {},
  storage: { attempted: 0, failed: 0 },
  subscription: 'not_requested',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('SYSTEM_HARD_DELETE_ENABLED', 'true');
  mockVerifyCookie.mockResolvedValue(true);
  mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9, resetInSeconds: 900 });
});

describe('unauthenticated callers', () => {
  it.each([
    ['getOrganizationHardDeletePreview', () => getOrganizationHardDeletePreview(ORG_ID)],
    ['hardDeleteOrganization', () => hardDeleteOrganization(ORG_ID, CONFIRM)],
  ])('%s throws Unauthorized and touches nothing', async (_name, call) => {
    mockVerifyCookie.mockResolvedValue(false);

    await expect(call()).rejects.toThrow('Unauthorized');

    expect(mockPreview).not.toHaveBeenCalled();
    expect(mockHardDelete).not.toHaveBeenCalled();
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
  });
});

describe('getOrganizationHardDeletePreview', () => {
  it('returns the lib preview', async () => {
    const preview = { enabled: true, refusal: null };
    mockPreview.mockResolvedValue(preview);

    await expect(getOrganizationHardDeletePreview(ORG_ID)).resolves.toBe(preview);
    expect(mockPreview).toHaveBeenCalledWith(ORG_ID);
  });
});

describe('hardDeleteOrganization', () => {
  it('returns a refusal, not a throw, when the flag is off, before the limiter or the lib', async () => {
    vi.stubEnv('SYSTEM_HARD_DELETE_ENABLED', 'false');

    await expect(hardDeleteOrganization(ORG_ID, CONFIRM)).resolves.toEqual({
      success: false,
      error: HARD_DELETE_DISABLED_REFUSAL,
    });
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
    expect(mockHardDelete).not.toHaveBeenCalled();
  });

  it('rate-limits fail-closed on the shared destructive key', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, remaining: 0, resetInSeconds: 321 });

    await expect(hardDeleteOrganization(ORG_ID, CONFIRM)).resolves.toEqual({
      success: false,
      error: 'Too many attempts. Please wait 321 seconds and try again.',
    });
    expect(mockCheckRateLimit).toHaveBeenCalledWith(
      'system-admin-destructive:203.0.113.9',
      10,
      900,
      { failClosed: true },
    );
    expect(mockHardDelete).not.toHaveBeenCalled();
  });

  it('passes the confirmation and the system-admin audit context to the lib', async () => {
    mockHardDelete.mockResolvedValue(DELETED);

    await hardDeleteOrganization(ORG_ID, CONFIRM);

    expect(mockHardDelete).toHaveBeenCalledWith(ORG_ID, CONFIRM, {
      actorRole: 'system_admin',
      ip: '203.0.113.9',
      userAgent: 'vitest-agent',
    });
  });

  it('coerces malformed client input: only a literal true counts', async () => {
    mockHardDelete.mockResolvedValue({ status: 'not_acknowledged' });

    await hardDeleteOrganization(ORG_ID, {
      confirmName: undefined,
      confirmWord: 42,
      acknowledged: 'true',
      cancelSubscription: 1,
    } as never);

    expect(mockHardDelete).toHaveBeenCalledWith(
      ORG_ID,
      { confirmName: '', confirmWord: '42', acknowledged: false, cancelSubscription: false },
      expect.anything(),
    );
  });

  it('on success revalidates the organization and user pages and reports the outcome', async () => {
    mockHardDelete.mockResolvedValue({
      ...DELETED,
      storage: { attempted: 4, failed: 2 },
      subscription: 'cancelled',
    });

    await expect(hardDeleteOrganization(ORG_ID, CONFIRM)).resolves.toEqual({
      success: true,
      storageFailures: 2,
      subscriptionCancelled: true,
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith('/system/organizations');
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/system/organizations/${ORG_ID}`);
    expect(mockRevalidatePath).toHaveBeenCalledWith('/system/users');
  });

  it.each([
    [{ status: 'disabled' }, HARD_DELETE_DISABLED_REFUSAL],
    [{ status: 'not_found' }, 'Organization not found'],
    [{ status: 'not_soft_deleted' }, NOT_SOFT_DELETED_ORGANIZATION_REFUSAL],
    [{ status: 'confirmation_mismatch' }, ORGANIZATION_CONFIRMATION_MISMATCH_REFUSAL],
    [{ status: 'not_acknowledged' }, NOT_ACKNOWLEDGED_ORGANIZATION_REFUSAL],
  ])('maps %j to a returned error without revalidating', async (result, message) => {
    mockHardDelete.mockResolvedValue(result);

    await expect(hardDeleteOrganization(ORG_ID, CONFIRM)).resolves.toEqual({
      success: false,
      error: message,
    });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it('returns a lib refusal with whether billing was stopped', async () => {
    mockHardDelete.mockResolvedValue({
      status: 'refused',
      message: 'Some records still reference this organization.',
      subscriptionCancelled: true,
    });

    await expect(hardDeleteOrganization(ORG_ID, CONFIRM)).resolves.toEqual({
      success: false,
      error: 'Some records still reference this organization.',
      subscriptionCancelled: true,
    });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it('turns an unexpected lib error into a safe returned message and logs it', async () => {
    mockHardDelete.mockRejectedValue(new Error('connection to db-prod-7 lost'));

    const result = await hardDeleteOrganization(ORG_ID, CONFIRM);

    expect(result).toEqual({
      success: false,
      error: 'Failed to permanently delete organization. Please try again.',
    });
    expect(JSON.stringify(result)).not.toContain('db-prod-7');
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: ORG_ID, err: expect.any(Error) }),
    );
  });
});
