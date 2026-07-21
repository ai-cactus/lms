/**
 * Unit tests for updateFacility() in src/app/actions/organization.ts
 *
 * Permission gate (facility.edit) is held only by owner and supervisor per the
 * RBAC matrix. All other roles must receive a 403.
 *
 * External deps (@/auth, @/lib/prisma) are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockAuth, mockUserFindUnique, mockFacilityUpdate, mockLoggerWarn, mockLoggerInfo } =
  vi.hoisted(() => ({
    mockAuth: vi.fn(),
    mockUserFindUnique: vi.fn(),
    mockFacilityUpdate: vi.fn(),
    mockLoggerWarn: vi.fn(),
    mockLoggerInfo: vi.fn(),
  }));

vi.mock('@/auth', () => ({ auth: mockAuth }));

vi.mock('@/lib/prisma', () => ({
  default: {
    user: { findUnique: mockUserFindUnique },
    facility: { update: mockFacilityUpdate },
    // Stub remaining methods to avoid unexpected call errors in other actions
    organization: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: mockLoggerWarn,
    info: mockLoggerInfo,
    error: vi.fn(),
    debug: vi.fn(),
  },
  maskEmail: (email: string) => `${email.slice(0, 2)}***@masked`,
}));

import { updateFacility } from './organization';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSession(role: string) {
  return {
    user: { id: 'user-1', email: 'u@acme.com', role, organizationId: 'org-1' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFacilityUpdate.mockResolvedValue({ id: 'fac-1' });
});

// ── Not authenticated ─────────────────────────────────────────────────────────

describe('updateFacility() — unauthenticated', () => {
  it('returns Not authenticated when session is null', async () => {
    mockAuth.mockResolvedValue(null);
    const result = await updateFacility({ phone: '555-0000' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Not authenticated');
  });
});

// ── Forbidden roles (no facility.edit) ───────────────────────────────────────

describe('updateFacility() — permission denied (403)', () => {
  it.each(['hr', 'clinical_director', 'finance', 'nurse'] as const)(
    '%s is forbidden from updating the facility',
    async (role) => {
      mockAuth.mockResolvedValue(makeSession(role));
      const result = await updateFacility({ phone: '555-1111' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Forbidden');
      expect(mockFacilityUpdate).not.toHaveBeenCalled();
      expect(mockLoggerWarn).toHaveBeenCalledOnce();
    },
  );
});

// ── Allowed roles (facility.edit) ─────────────────────────────────────────────

describe('updateFacility() — owner is allowed', () => {
  it('succeeds and calls facility.update with the correct facilityId', async () => {
    mockAuth.mockResolvedValue(makeSession('owner'));
    mockUserFindUnique.mockResolvedValue({ facilityId: 'fac-42' });

    const result = await updateFacility({ phone: '555-9000', address: '1 Main St' });

    expect(result.success).toBe(true);
    expect(mockFacilityUpdate).toHaveBeenCalledOnce();
    expect(mockFacilityUpdate.mock.calls[0][0].where).toEqual({ id: 'fac-42' });
    expect(mockFacilityUpdate.mock.calls[0][0].data.phone).toBe('555-9000');
  });
});

describe('updateFacility() — supervisor is allowed', () => {
  it('succeeds and calls facility.update with the correct facilityId', async () => {
    mockAuth.mockResolvedValue(makeSession('supervisor'));
    mockUserFindUnique.mockResolvedValue({ facilityId: 'fac-7' });

    const result = await updateFacility({ city: 'Denver', state: 'CO' });

    expect(result.success).toBe(true);
    expect(mockFacilityUpdate).toHaveBeenCalledOnce();
    expect(mockFacilityUpdate.mock.calls[0][0].where).toEqual({ id: 'fac-7' });
  });
});

// ── Settings → Facility tab: name/type fields (new in this session) ─────────

describe('updateFacility() — name/type fields (Settings Facility tab)', () => {
  it('persists name and type alongside the existing location fields', async () => {
    mockAuth.mockResolvedValue(makeSession('owner'));
    mockUserFindUnique.mockResolvedValue({ facilityId: 'fac-42' });

    const result = await updateFacility({ name: 'Acme Downtown Clinic', type: 'clinic' });

    expect(result.success).toBe(true);
    const data = mockFacilityUpdate.mock.calls[0][0].data;
    expect(data.name).toBe('Acme Downtown Clinic');
    expect(data.type).toBe('clinic');
  });

  it('leaves name/type as undefined (no-op update) when not supplied', async () => {
    mockAuth.mockResolvedValue(makeSession('owner'));
    mockUserFindUnique.mockResolvedValue({ facilityId: 'fac-42' });

    await updateFacility({ phone: '555-2222' });

    const data = mockFacilityUpdate.mock.calls[0][0].data;
    expect(data.name).toBeUndefined();
    expect(data.type).toBeUndefined();
  });
});

// ── Missing facilityId ────────────────────────────────────────────────────────

describe('updateFacility() — user has no facility', () => {
  it('returns No facility found when facilityId is null', async () => {
    mockAuth.mockResolvedValue(makeSession('owner'));
    mockUserFindUnique.mockResolvedValue({ facilityId: null });

    const result = await updateFacility({ phone: '555-0001' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('No facility found');
    expect(mockFacilityUpdate).not.toHaveBeenCalled();
  });
});
