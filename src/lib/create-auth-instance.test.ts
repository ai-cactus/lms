/**
 * Regression tests for the `sessionAllowedRoles` split introduced for the
 * Manage/Learn session-bridge feature (see src/app/actions/session-bridge.ts).
 *
 * The worker auth instance (src/auth.worker.ts) now widens `sessionAllowedRoles`
 * to ALL_ROLES so a bridged admin's worker-cookie JWT survives re-validation —
 * but `allowedRoles` (which gates the worker LOGIN form's `authorize()`) stays
 * WORKER_ROLES. These tests exercise the real `@/auth` / `@/auth.worker` wiring
 * (not a hand-rolled `createAuthInstance` call) so a regression in either
 * module's config is caught here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindUnique, mockUpdate, mockCheckRateLimit, mockAudit } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockAudit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: mockFindUnique, update: mockUpdate } },
  default: { user: { findUnique: mockFindUnique, update: mockUpdate } },
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock('@/lib/audit', () => ({ audit: mockAudit, getClientContext: vi.fn(() => ({})) }));
vi.mock('bcryptjs', () => ({
  default: { compare: vi.fn().mockResolvedValue(true), hash: vi.fn().mockResolvedValue('hash') },
  compare: vi.fn().mockResolvedValue(true),
  hash: vi.fn().mockResolvedValue('hash'),
}));

import { adminConfig } from '@/auth';
import { workerConfig } from '@/auth.worker';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getAuthorize(config: any) {
  return config.providers[0].options.authorize as (
    credentials: unknown,
    request: Request,
  ) => Promise<unknown>;
}

const fakeRequest = () => ({ headers: new Headers({ 'x-forwarded-for': '1.2.3.4' }) }) as Request;

const baseUser = {
  id: 'user-1',
  email: 'person@acme.com',
  // Not a real bcrypt hash — the cost-upgrade regex won't match, so the
  // rehash branch is skipped and bcrypt.compare (mocked above) is what decides.
  password: 'not-a-real-hash',
  organizationId: 'org-1',
  mfaEnabled: false,
  passwordResetRequired: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckRateLimit.mockResolvedValue({ allowed: true });
  mockUpdate.mockResolvedValue({});
});

describe('least-privilege regression guard: worker instance authorize()', () => {
  it('rejects an admin-tier user at the worker login form despite sessionAllowedRoles: ALL_ROLES', async () => {
    mockFindUnique.mockResolvedValue({ ...baseUser, role: 'owner' });
    const authorize = getAuthorize(workerConfig);

    const result = await authorize({ email: 'person@acme.com', password: 'pw' }, fakeRequest());

    expect(result).toBeNull();
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.login.failure',
        metadata: expect.objectContaining({ reason: 'role_mismatch', instance: 'worker' }),
      }),
    );
  });

  it('still allows a genuine worker-tier user through the role gate', async () => {
    mockFindUnique.mockResolvedValue({ ...baseUser, role: 'nurse' });
    const authorize = getAuthorize(workerConfig);

    const result = await authorize({ email: 'person@acme.com', password: 'pw' }, fakeRequest());

    expect(result).not.toBeNull();
    expect(mockAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ reason: 'role_mismatch' }) }),
    );
  });
});

describe('jwt() session re-validation — sessionAllowedRoles vs allowedRoles', () => {
  it('worker instance KEEPS a session whose fresh DB role is admin-tier (sessionAllowedRoles: ALL_ROLES)', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'user-1',
      role: 'owner',
      organizationId: 'org-1',
      mfaEnabled: false,
      mfaVerifiedAt: null,
      passwordResetRequired: false,
      sessionVersion: 1,
      authProvider: 'credentials',
      profile: { fullName: 'Owner Person' },
    });
    const token = { id: 'user-1', role: 'owner', sessionVersion: 1 };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (workerConfig.callbacks!.jwt as any)({ token });

    expect(result).not.toBeNull();
    expect(result.role).toBe('owner');
  });

  it('admin instance INVALIDATES a session whose fresh DB role is outside ADMIN_ROLES', async () => {
    mockFindUnique.mockResolvedValue({
      id: 'user-2',
      role: 'nurse',
      organizationId: 'org-1',
      mfaEnabled: false,
      mfaVerifiedAt: null,
      passwordResetRequired: false,
      sessionVersion: 1,
      authProvider: 'credentials',
      profile: { fullName: 'Nick Nurse' },
    });
    const token = { id: 'user-2', role: 'nurse', sessionVersion: 1 };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (adminConfig.callbacks!.jwt as any)({ token });

    expect(result).toBeNull();
  });
});
