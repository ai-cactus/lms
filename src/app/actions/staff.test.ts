/**
 * Unit tests for updateStaffDetails() in src/app/actions/staff.ts
 *
 * Key invariant: the Owner role is established ONLY at org creation.
 * - Promoting a non-owner to owner via updateStaffDetails must be rejected.
 * - An existing owner keeping their role while editing name/title is allowed.
 *
 * External deps (@/auth, @/lib/prisma, next/cache) are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockAuth,
  mockUserFindUnique,
  mockUserUpdate,
  mockProfileUpsert,
  mockRevalidatePath,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockUserUpdate: vi.fn(),
  mockProfileUpsert: vi.fn(),
  mockRevalidatePath: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));

vi.mock('@/lib/prisma', () => ({
  default: {
    user: { findUnique: mockUserFindUnique, update: mockUserUpdate },
    profile: { upsert: mockProfileUpsert },
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));

import { updateStaffDetails } from './staff';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

beforeEach(() => {
  vi.clearAllMocks();
  mockUserUpdate.mockResolvedValue({ id: 'target-1', email: 'target@acme.com' });
  mockProfileUpsert.mockResolvedValue({});
});

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
