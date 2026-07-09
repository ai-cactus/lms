/**
 * Unit tests for src/lib/rbac/authorize.ts
 *
 * Verifies the three outcome paths:
 *   401 — no authenticated session
 *   403 — session exists but the role lacks the requested permission
 *         (logger.warn must be called; email must be masked via maskEmail)
 *   ok  — session exists and role has the requested permission
 *         (returns { ok: true, ctx } with correct shape)
 *
 * All external deps (@/auth, @/lib/logger, @/lib/api-response) are mocked
 * so the test remains a pure unit test with no NextAuth or Next.js runtime.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, mockLoggerWarn, mockLoggerError, mockMaskEmail, mockApiError } = vi.hoisted(
  () => {
    const mockAuth = vi.fn();
    const mockLoggerWarn = vi.fn();
    const mockLoggerError = vi.fn();
    // Return a predictably masked form so we can assert it was applied.
    const mockMaskEmail = vi.fn((email: string) => `${email.slice(0, 2)}***@masked`);
    const mockApiError = vi.fn(
      (message: string, status: number, code?: string) =>
        ({ _tag: 'apiError', message, status, code }) as unknown as Response,
    );
    return { mockAuth, mockLoggerWarn, mockLoggerError, mockMaskEmail, mockApiError };
  },
);

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/logger', () => ({
  logger: { warn: mockLoggerWarn, error: mockLoggerError, info: vi.fn(), debug: vi.fn() },
  maskEmail: mockMaskEmail,
}));
vi.mock('@/lib/api-response', () => ({
  apiError: mockApiError,
}));

import { authorize } from './authorize';

function makeSession(role: string, overrides: Record<string, unknown> = {}) {
  return {
    user: {
      id: 'user-123',
      email: 'admin@example.com',
      role,
      organizationId: 'org-abc',
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('authorize() — unauthenticated (401)', () => {
  it('returns ok:false with a 401 response when session is null', async () => {
    mockAuth.mockResolvedValue(null);

    const result = await authorize('billing.read');

    expect(result.ok).toBe(false);
    expect(mockApiError).toHaveBeenCalledWith('Unauthorized', 401);
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('returns ok:false with a 401 response when session has no user.id', async () => {
    mockAuth.mockResolvedValue({ user: {} });

    const result = await authorize('course.read');

    expect(result.ok).toBe(false);
    expect(mockApiError).toHaveBeenCalledWith('Unauthorized', 401);
  });
});

describe('authorize() — authenticated but permission denied (403)', () => {
  it('returns ok:false with a 403 response when a worker-category role requests billing.read', async () => {
    mockAuth.mockResolvedValue(makeSession('nurse'));

    const result = await authorize('billing.read');

    expect(result.ok).toBe(false);
    expect(mockApiError).toHaveBeenCalledWith('Forbidden', 403, 'INSUFFICIENT_PERMISSIONS');
  });

  it('calls logger.warn with masked email on 403', async () => {
    const session = makeSession('nurse', { email: 'worker@acme.com' });
    mockAuth.mockResolvedValue(session);

    await authorize('billing.read');

    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
    const call = mockLoggerWarn.mock.calls[0][0];
    expect(call.msg).toContain('[rbac]');
    expect(call.userId).toBe('user-123');
    expect(call.role).toBe('nurse');
    expect(call.permission).toBe('billing.read');
    // maskEmail must have been applied — the raw email must NOT appear in the log
    expect(mockMaskEmail).toHaveBeenCalledWith('worker@acme.com');
    // The log should carry the masked form (what mockMaskEmail returns)
    expect(call.email).toBe('wo***@masked');
  });

  it('returns ok:false when hr requests facility.edit', async () => {
    mockAuth.mockResolvedValue(makeSession('hr'));

    const result = await authorize('facility.edit');

    expect(result.ok).toBe(false);
    expect(mockApiError).toHaveBeenCalledWith('Forbidden', 403, 'INSUFFICIENT_PERMISSIONS');
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
  });

  it('returns ok:false when finance requests facility.read', async () => {
    mockAuth.mockResolvedValue(makeSession('finance'));

    const result = await authorize('facility.read');

    expect(result.ok).toBe(false);
    expect(mockApiError).toHaveBeenCalledWith('Forbidden', 403, 'INSUFFICIENT_PERMISSIONS');
  });

  it('returns ok:false when supervisor requests billing.read', async () => {
    mockAuth.mockResolvedValue(makeSession('supervisor'));

    const result = await authorize('billing.read');

    expect(result.ok).toBe(false);
    expect(mockApiError).toHaveBeenCalledWith('Forbidden', 403, 'INSUFFICIENT_PERMISSIONS');
  });
});

describe('authorize() — regression: stale/unknown role denies cleanly instead of throwing', () => {
  it('returns ok:false with a 403 response (not a thrown TypeError) for the retired "worker" role', async () => {
    mockAuth.mockResolvedValue(makeSession('worker'));

    const result = await authorize('course.read');

    expect(result.ok).toBe(false);
    expect(mockApiError).toHaveBeenCalledWith('Forbidden', 403, 'INSUFFICIENT_PERMISSIONS');
  });

  it('logs a single [rbac] warn for the unknown role, distinct from the permission-denied warn', async () => {
    mockAuth.mockResolvedValue(makeSession('worker'));

    await authorize('course.read');

    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
    const call = mockLoggerWarn.mock.calls[0][0];
    expect(call.msg).toContain('[rbac]');
    expect(call.msg.toLowerCase()).toContain('unknown or stale role');
    expect(call.userId).toBe('user-123');
    expect(call.role).toBe('worker');
    expect(call.permission).toBe('course.read');
  });

  it('returns ok:false for an entirely bogus role string', async () => {
    mockAuth.mockResolvedValue(makeSession('nope'));

    const result = await authorize('course.read');

    expect(result.ok).toBe(false);
    expect(mockApiError).toHaveBeenCalledWith('Forbidden', 403, 'INSUFFICIENT_PERMISSIONS');
  });
});

describe('authorize() — authenticated and permitted (ok)', () => {
  it('returns ok:true with ctx when owner requests billing.read', async () => {
    mockAuth.mockResolvedValue(makeSession('owner'));

    const result = await authorize('billing.read');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected ok');
    expect(result.ctx.userId).toBe('user-123');
    expect(result.ctx.role).toBe('owner');
    expect(result.ctx.roleKey).toBe('owner');
    expect(result.ctx.organizationId).toBe('org-abc');
    expect(result.ctx.email).toBe('admin@example.com');
    expect(mockLoggerWarn).not.toHaveBeenCalled();
  });

  it('returns ok:true when supervisor requests facility.edit', async () => {
    mockAuth.mockResolvedValue(makeSession('supervisor'));

    const result = await authorize('facility.edit');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected ok');
    expect(result.ctx.roleKey).toBe('supervisor');
  });

  it('returns ok:true when finance requests billing.read', async () => {
    mockAuth.mockResolvedValue(makeSession('finance'));

    const result = await authorize('billing.read');

    expect(result.ok).toBe(true);
  });

  it('ctx.roleKey uses clinicalDirector (camelCase) for clinical_director DB role', async () => {
    mockAuth.mockResolvedValue(makeSession('clinical_director'));

    const result = await authorize('course.read');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected ok');
    expect(result.ctx.roleKey).toBe('clinicalDirector');
  });

  it('ctx.organizationId is null when user has no org', async () => {
    mockAuth.mockResolvedValue(makeSession('owner', { organizationId: null }));

    const result = await authorize('billing.read');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected ok');
    expect(result.ctx.organizationId).toBeNull();
  });
});
