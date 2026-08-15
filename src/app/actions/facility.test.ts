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

const {
  mockAuth,
  mockOrgUserFacilityFindFirst,
  mockOrgUserFacilityUpsert,
  mockOrgUserFindFirst,
  mockFacilityFindFirst,
  mockFacilityUpdate,
  mockAudit,
  mockCreateInvites,
  mockLoggerWarn,
  mockLoggerInfo,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockOrgUserFacilityFindFirst: vi.fn(),
  mockOrgUserFacilityUpsert: vi.fn(),
  mockOrgUserFindFirst: vi.fn(),
  mockFacilityFindFirst: vi.fn(),
  mockFacilityUpdate: vi.fn(),
  mockAudit: vi.fn(),
  mockCreateInvites: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerInfo: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));

vi.mock('@/lib/prisma', () => ({
  default: {
    // Facility linkage is resolved via the caller's active OrganizationUserFacility
    // row, not a flat User.facilityId.
    organizationUserFacility: {
      findFirst: mockOrgUserFacilityFindFirst,
      upsert: mockOrgUserFacilityUpsert,
    },
    organizationUser: { findFirst: mockOrgUserFindFirst },
    facility: { findFirst: mockFacilityFindFirst, update: mockFacilityUpdate },
    // Stub remaining methods to avoid unexpected call errors in other actions
    organization: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock('@/lib/audit', () => ({ audit: mockAudit, getClientContext: () => ({}) }));
vi.mock('@/app/actions/invite', () => ({ createInvites: mockCreateInvites }));

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
    user: {
      id: 'user-1',
      email: 'u@acme.com',
      role,
      organizationId: 'org-1',
      organizationUserId: 'ou-1',
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFacilityUpdate.mockResolvedValue({ id: 'fac-1' });
  mockAudit.mockResolvedValue(undefined);
  mockCreateInvites.mockResolvedValue({ success: true, results: [{ status: 'sent' }] });
  mockOrgUserFacilityUpsert.mockResolvedValue({});
  mockOrgUserFindFirst.mockResolvedValue(null);
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
  // RBAC ruling: supervisor was demoted to READ-ONLY on every resource, so it no
  // longer holds `facility.edit`. It is absent from this list because PROF-002
  // re-admits it for its OWN assigned facilities only — see the dedicated
  // describe block below for both branches of that exception.
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

// ── PROF-002: supervisor may edit only their OWN assigned facilities ─────────

describe('updateFacility() — supervisor own-facility exception', () => {
  it('allows a supervisor to update the facility resolved from their own assignment', async () => {
    mockAuth.mockResolvedValue(makeSession('supervisor'));
    mockOrgUserFacilityFindFirst.mockResolvedValue({ facilityId: 'fac-own' });

    const result = await updateFacility({ name: 'Sunrise Behavioral Health' });

    expect(result.success).toBe(true);
    expect(mockFacilityUpdate).toHaveBeenCalledOnce();
    expect(mockFacilityUpdate.mock.calls[0][0].where).toEqual({ id: 'fac-own' });
    expect(mockFacilityUpdate.mock.calls[0][0].data.name).toBe('Sunrise Behavioral Health');
  });

  it('allows a supervisor to update an explicitly named facility they are assigned to', async () => {
    mockAuth.mockResolvedValue(makeSession('supervisor'));
    mockFacilityFindFirst.mockResolvedValue({ id: 'fac-99' });
    mockOrgUserFacilityFindFirst.mockResolvedValue({ id: 'ouf-1' });

    const result = await updateFacility({
      facilityId: 'fac-99',
      name: 'Northside Clinic',
      type: 'Community Mental Health Center',
      address: 'Delaware, US',
    });

    expect(result.success).toBe(true);
    expect(mockOrgUserFacilityFindFirst).toHaveBeenCalledWith({
      where: { organizationUserId: 'ou-1', facilityId: 'fac-99', active: true },
      select: { id: true },
    });
    expect(mockFacilityUpdate.mock.calls[0][0].data).toEqual({
      name: 'Northside Clinic',
      type: 'Community Mental Health Center',
      address: 'Delaware, US',
    });
  });

  it('refuses a facility in the org that the supervisor is not assigned to', async () => {
    mockAuth.mockResolvedValue(makeSession('supervisor'));
    mockFacilityFindFirst.mockResolvedValue({ id: 'fac-other' });
    mockOrgUserFacilityFindFirst.mockResolvedValue(null);

    const result = await updateFacility({ facilityId: 'fac-other', name: 'Not mine' });

    expect(result).toEqual({ success: false, error: 'Forbidden' });
    expect(mockFacilityUpdate).not.toHaveBeenCalled();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ facilityId: 'fac-other' }),
    );
  });

  // Least privilege: the exception covers the three fields on the supervisor's
  // own profile form, never staffing, credentials or compliance documents.
  it('ignores fields outside the supervisor-writable set', async () => {
    mockAuth.mockResolvedValue(makeSession('supervisor'));
    mockOrgUserFacilityFindFirst.mockResolvedValue({ facilityId: 'fac-own' });

    await updateFacility({
      name: 'Sunrise',
      staffCount: '500+',
      licenseNumber: 'HACKED-001',
      programServices: ['aging'],
      complianceDocumentUrl: 'gs://evil/doc.pdf',
      phone: '555-0000',
    });

    expect(mockFacilityUpdate.mock.calls[0][0].data).toEqual({
      name: 'Sunrise',
      type: undefined,
      address: undefined,
    });
  });

  it('refuses to let a supervisor hand the facility to someone else', async () => {
    mockAuth.mockResolvedValue(makeSession('supervisor'));
    mockOrgUserFacilityFindFirst.mockResolvedValue({ facilityId: 'fac-own' });

    const result = await updateFacility({ name: 'Sunrise', supervisorEmail: 'other@acme.com' });

    expect(result).toEqual({ success: false, error: 'Forbidden' });
    expect(mockFacilityUpdate).not.toHaveBeenCalled();
    expect(mockOrgUserFacilityUpsert).not.toHaveBeenCalled();
    expect(mockCreateInvites).not.toHaveBeenCalled();
  });
});

// ── Allowed roles (facility.edit) ─────────────────────────────────────────────

describe('updateFacility() — owner is allowed', () => {
  it('succeeds and calls facility.update with the correct facilityId', async () => {
    mockAuth.mockResolvedValue(makeSession('owner'));
    mockOrgUserFacilityFindFirst.mockResolvedValue({ facilityId: 'fac-42' });

    const result = await updateFacility({ phone: '555-9000', address: '1 Main St' });

    expect(result.success).toBe(true);
    expect(mockFacilityUpdate).toHaveBeenCalledOnce();
    expect(mockFacilityUpdate.mock.calls[0][0].where).toEqual({ id: 'fac-42' });
    expect(mockFacilityUpdate.mock.calls[0][0].data.phone).toBe('555-9000');
  });
});

describe('updateFacility() — admin (Owner-equivalent) is allowed', () => {
  it('succeeds and calls facility.update with the correct facilityId', async () => {
    mockAuth.mockResolvedValue(makeSession('admin'));
    mockOrgUserFacilityFindFirst.mockResolvedValue({ facilityId: 'fac-7' });

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
    mockOrgUserFacilityFindFirst.mockResolvedValue({ facilityId: 'fac-42' });

    const result = await updateFacility({ name: 'Acme Downtown Clinic', type: 'clinic' });

    expect(result.success).toBe(true);
    const data = mockFacilityUpdate.mock.calls[0][0].data;
    expect(data.name).toBe('Acme Downtown Clinic');
    expect(data.type).toBe('clinic');
  });

  it('leaves name/type as undefined (no-op update) when not supplied', async () => {
    mockAuth.mockResolvedValue(makeSession('owner'));
    mockOrgUserFacilityFindFirst.mockResolvedValue({ facilityId: 'fac-42' });

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
    mockOrgUserFacilityFindFirst.mockResolvedValue(null);

    const result = await updateFacility({ phone: '555-0001' });

    expect(result.success).toBe(false);
    expect(result.error).toBe('No facility found');
    expect(mockFacilityUpdate).not.toHaveBeenCalled();
  });
});

// ── Explicit facilityId (Settings → Facility card list) ──────────────────────

describe('updateFacility() — explicit facilityId tenancy', () => {
  it('updates the named facility once it is proven to be in the caller organization', async () => {
    mockAuth.mockResolvedValue(makeSession('owner'));
    mockFacilityFindFirst.mockResolvedValue({ id: 'fac-99' });

    const result = await updateFacility({ facilityId: 'fac-99', name: 'Northside Clinic' });

    expect(result.success).toBe(true);
    expect(mockFacilityFindFirst).toHaveBeenCalledWith({
      where: { id: 'fac-99', organizationId: 'org-1' },
      select: { id: true },
    });
    expect(mockFacilityUpdate.mock.calls[0][0].where).toEqual({ id: 'fac-99' });
    // The caller's own membership must not be consulted once an id is given.
    expect(mockOrgUserFacilityFindFirst).not.toHaveBeenCalled();
  });

  it('refuses a facility belonging to another organization and writes nothing', async () => {
    mockAuth.mockResolvedValue(makeSession('owner'));
    mockFacilityFindFirst.mockResolvedValue(null);

    const result = await updateFacility({ facilityId: 'fac-in-other-org', name: 'Hijacked' });

    expect(result).toEqual({ success: false, error: 'Facility not found' });
    expect(mockFacilityUpdate).not.toHaveBeenCalled();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ facilityId: 'fac-in-other-org' }),
    );
  });

  it('returns No organization found when the session carries no organizationId', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', role: 'owner', organizationId: null, organizationUserId: 'ou-1' },
    });

    const result = await updateFacility({ facilityId: 'fac-99', name: 'Northside Clinic' });

    expect(result).toEqual({ success: false, error: 'No organization found' });
    expect(mockFacilityFindFirst).not.toHaveBeenCalled();
    expect(mockFacilityUpdate).not.toHaveBeenCalled();
  });
});

// ── Supervisor hand-over (shared with createFacility) ────────────────────────

describe('updateFacility() — supervisor assignment', () => {
  beforeEach(() => {
    mockAuth.mockResolvedValue(makeSession('owner'));
    mockFacilityFindFirst.mockResolvedValue({ id: 'fac-99' });
  });

  it('assigns an existing supervisor by reactivating/creating their facility row', async () => {
    mockOrgUserFindFirst.mockResolvedValue({ id: 'ou-sup', role: 'supervisor' });

    const result = await updateFacility({
      facilityId: 'fac-99',
      supervisorEmail: 'Sup@Acme.com',
    });

    expect(result).toMatchObject({ success: true, supervisorAssigned: true });
    expect(mockOrgUserFacilityUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationUserId_facilityId: { organizationUserId: 'ou-sup', facilityId: 'fac-99' },
        },
        update: { active: true, deactivatedAt: null },
      }),
    );
    expect(mockCreateInvites).not.toHaveBeenCalled();
  });

  it('invites a stranger instead of assigning them', async () => {
    mockOrgUserFindFirst.mockResolvedValue(null);

    const result = await updateFacility({
      facilityId: 'fac-99',
      supervisorEmail: 'stranger@acme.com',
    });

    expect(result).toMatchObject({ success: true, supervisorInvited: true });
    expect(mockCreateInvites).toHaveBeenCalledWith(
      [{ email: 'stranger@acme.com', role: 'supervisor' }],
      { facilityId: 'fac-99' },
    );
    expect(mockOrgUserFacilityUpsert).not.toHaveBeenCalled();
  });

  // Re-roling someone from a facility form would be a privilege change made
  // outside Staff Management, so the whole update is refused before any write.
  it('refuses a member who holds a different role, before touching the facility', async () => {
    mockOrgUserFindFirst.mockResolvedValue({ id: 'ou-hr', role: 'hr' });

    const result = await updateFacility({
      facilityId: 'fac-99',
      name: 'Northside',
      supervisorEmail: 'hr@acme.com',
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already a member of this organization/);
    expect(mockFacilityUpdate).not.toHaveBeenCalled();
  });
});
