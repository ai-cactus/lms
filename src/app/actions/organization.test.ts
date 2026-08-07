/**
 * Unit tests for src/app/actions/organization.ts
 *
 * Covers the Organization/Facility split reconciliation:
 *   - createOrganization: facility receives location + timezone (derived from
 *     state); organization does NOT; founding user is linked with facilityId
 *     and role 'owner'.
 *   - updateOrganization: admin gate via isAdminRole; org-only fields go to
 *     Organization, moved (location/compliance/timezone) fields go to the
 *     user's Facility.
 *   - updateFacility: permission-gated on facility.edit (owner/supervisor only).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import prisma from '@/lib/prisma';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockAuth, mockCreateMembership, txMock } = vi.hoisted(() => {
  const txMock = {
    organization: { create: vi.fn(), findFirst: vi.fn() },
    facility: { create: vi.fn() },
  };
  return { mockAuth: vi.fn(), mockCreateMembership: vi.fn(), txMock };
});

const { mockCreateInvites } = vi.hoisted(() => ({ mockCreateInvites: vi.fn() }));

vi.mock('@/auth', () => ({ auth: mockAuth }));
// F-001 audit is a best-effort side-channel — stub it so business-logic tests
// don't depend on the audit sink or the request-scoped headers() it reads.
vi.mock('@/lib/audit', () => ({ audit: vi.fn(), getClientContext: () => ({}) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// createFacility's supervisor invite is best-effort — stub it so createFacility
// tests exercise its own gate/validation/persistence, not invite.ts's logic
// (which has its own test suite).
vi.mock('@/app/actions/invite', () => ({ createInvites: mockCreateInvites }));

// Mock the prisma client
vi.mock('@/lib/prisma', () => {
  const prisma = {
    organization: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    facility: {
      update: vi.fn(),
      create: vi.fn(),
    },
    // One-org-per-user guard reads OrganizationUser; moved location/compliance
    // fields resolve the caller's facility via OrganizationUserFacility.
    organizationUser: {
      findFirst: vi.fn(),
    },
    organizationUserFacility: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: typeof txMock) => unknown) => cb(txMock)),
  };
  return { prisma, default: prisma };
});

// createOrganization() links the founder via createMembership(), not a direct
// user.update inside the org/facility transaction.
vi.mock('@/lib/auth/membership', () => ({ createMembership: mockCreateMembership }));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  // createFacility masks the supervisor's email before logging a failed-invite warning.
  maskEmail: (email: string) => email,
}));

import {
  checkOrganizationNameAvailable,
  createOrganization,
  updateOrganization,
  updateFacility,
  createFacility,
} from './organization';

describe('checkOrganizationNameAvailable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return true when organization name does not exist', async () => {
    // Mock findFirst to return null (no organization found)
    vi.mocked(prisma.organization.findFirst).mockResolvedValue(null);

    const result = await checkOrganizationNameAvailable('New Org Name');

    expect(result.available).toBe(true);
    expect(prisma.organization.findFirst).toHaveBeenCalledWith({
      where: {
        name: {
          equals: 'New Org Name',
          mode: 'insensitive',
        },
      },
    });
  });

  it('should return false when organization name already exists', async () => {
    // Mock findFirst to return an existing organization
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({
      id: 'existing-id',
      name: 'Existing Org Name',
      dba: null,
      ein: null,
      staffCount: null,
      primaryContact: null,
      primaryEmail: 'test@example.com',
      phone: null,
      address: null,
      country: null,
      state: null,
      zipCode: null,
      city: null,
      licenseNumber: null,
      isHipaaCompliant: false,
      primaryBusinessType: null,
      additionalBusinessTypes: [],
      programServices: [],
      slug: 'existing-org-name',
      createdAt: new Date(),
      updatedAt: new Date(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await checkOrganizationNameAvailable('Existing Org Name');

    expect(result.available).toBe(false);
    expect(prisma.organization.findFirst).toHaveBeenCalledWith({
      where: {
        name: {
          equals: 'Existing Org Name',
          mode: 'insensitive',
        },
      },
    });
  });
});

// ── createOrganization ────────────────────────────────────────────────────────

describe('createOrganization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    vi.mocked(prisma.organizationUser.findFirst).mockResolvedValue(null);
    mockCreateMembership.mockResolvedValue({
      organizationUserId: 'ou-1',
      organizationId: 'org-1',
      organizationName: 'Acme Health',
      organizationSlug: 'acme-health',
      role: 'owner',
    });
    // Reset any leftover mock state from other describe blocks in this file
    // (vi.clearAllMocks() clears call history but not a previously-set
    // mockResolvedValue implementation).
    vi.mocked(prisma.organization.findFirst).mockResolvedValue(null);
    txMock.organization.findFirst.mockResolvedValue(null);
    txMock.organization.create.mockResolvedValue({ id: 'org-1', name: 'Acme Health' });
    txMock.facility.create.mockResolvedValue({ id: 'facility-1' });
  });

  const baseData = {
    legalName: 'Acme Health',
    primaryContactEmail: 'owner@acme.com',
    state: 'CA',
    streetAddress: '123 Main St',
    zipCode: '90001',
    country: 'US',
    phone: '555-0100',
    staffCount: '25',
  };

  it('creates the facility with location fields and a timezone derived from state; organization gets none of them', async () => {
    await createOrganization(baseData);

    expect(txMock.organization.create).toHaveBeenCalledTimes(1);
    const orgCreateData = txMock.organization.create.mock.calls[0][0].data;
    expect(orgCreateData).not.toHaveProperty('timezone');
    expect(orgCreateData).not.toHaveProperty('address');
    expect(orgCreateData).not.toHaveProperty('state');
    expect(orgCreateData).not.toHaveProperty('zipCode');
    expect(orgCreateData).not.toHaveProperty('phone');
    expect(orgCreateData).not.toHaveProperty('staffCount');

    expect(txMock.facility.create).toHaveBeenCalledTimes(1);
    const facilityCreateData = txMock.facility.create.mock.calls[0][0].data;
    expect(facilityCreateData).toMatchObject({
      organizationId: 'org-1',
      address: '123 Main St',
      zipCode: '90001',
      country: 'US',
      phone: '555-0100',
      staffCount: '25',
      state: 'CA',
    });
    // CA → America/Los_Angeles per deriveTimezoneFromState (real, unmocked).
    expect(facilityCreateData.timezone).toBe('America/Los_Angeles');
  });

  it('falls back to DEFAULT_TZ (America/New_York) when state is omitted', async () => {
    await createOrganization({ ...baseData, state: undefined });

    const facilityCreateData = txMock.facility.create.mock.calls[0][0].data;
    expect(facilityCreateData.timezone).toBe('America/New_York');
  });

  it('links the founding user with facilityId and role "owner" via createMembership', async () => {
    await createOrganization(baseData);

    expect(mockCreateMembership).toHaveBeenCalledWith({
      userId: 'user-1',
      organizationId: 'org-1',
      facilityId: 'facility-1',
      role: 'owner',
    });
  });

  it('rejects when the user already belongs to an organization', async () => {
    vi.mocked(prisma.organizationUser.findFirst).mockResolvedValue({ id: 'ou-existing' } as never);

    const result = await createOrganization(baseData);

    expect(result.success).toBe(false);
    expect(txMock.facility.create).not.toHaveBeenCalled();
  });
});

// ── updateOrganization ──────────────────────────────────────────────────────────

describe('updateOrganization', () => {
  function makeSession(role: string, overrides: Record<string, unknown> = {}) {
    return {
      user: {
        id: 'user-1',
        organizationId: 'org-1',
        organizationUserId: 'ou-1',
        role,
        ...overrides,
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.organizationUserFacility.findFirst).mockResolvedValue({
      facilityId: 'facility-1',
    } as never);
  });

  const updateData = {
    name: 'Acme Renamed',
    isHipaaCompliant: true,
    phone: '555-9999',
    address: '456 Oak Ave',
    city: 'Sacramento',
    state: 'CA',
    zipCode: '95814',
    country: 'US',
    timezone: 'America/Los_Angeles',
    licenseNumber: 'LIC-123',
    programServices: ['home-health'],
    complianceDocumentUrl: 'https://storage/doc.pdf',
    complianceDocumentName: 'doc.pdf',
  };

  it('rejects a non-admin (worker) — regression guard for role === "admin" style checks', async () => {
    mockAuth.mockResolvedValue(makeSession('nurse'));

    const result = await updateOrganization(updateData);

    expect(result.success).toBe(false);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it.each(['owner', 'admin'])(
    'allows an Owner-equivalent role (%s) to update the organization — organization.edit holder',
    async (role) => {
      mockAuth.mockResolvedValue(makeSession(role));

      const result = await updateOrganization(updateData);

      expect(result.success).toBe(true);
    },
  );

  // RBAC ruling: `organization.edit` resolves to Owner/Admin ONLY. Supervisor was
  // demoted to read-only everywhere (no writes anywhere, incl. org settings), and
  // HR/Clinical Director/Finance never held organization write access — they only
  // ever had `organization.read`. Previously this suite asserted all five of these
  // admin-tier roles could write, which predates the ruling; now asserting denial.
  it.each(['supervisor', 'hr', 'clinical_director', 'finance'])(
    'denies a non-Owner-equivalent admin-tier role (%s) — lacks organization.edit',
    async (role) => {
      mockAuth.mockResolvedValue(makeSession(role));

      const result = await updateOrganization(updateData);

      expect(result.success).toBe(false);
      expect(prisma.organization.update).not.toHaveBeenCalled();
    },
  );

  it('writes only org-level fields to Organization (no location/timezone/compliance)', async () => {
    mockAuth.mockResolvedValue(makeSession('owner'));

    await updateOrganization(updateData);

    expect(prisma.organization.update).toHaveBeenCalledTimes(1);
    const orgData = vi.mocked(prisma.organization.update).mock.calls[0][0].data;
    expect(orgData).not.toHaveProperty('timezone');
    expect(orgData).not.toHaveProperty('address');
    expect(orgData).not.toHaveProperty('phone');
    expect(orgData).not.toHaveProperty('licenseNumber');
    expect(orgData).not.toHaveProperty('complianceDocumentUrl');
    expect(orgData.name).toBe('Acme Renamed');
    expect(orgData.isHipaaCompliant).toBe(true);
  });

  it('writes location, compliance, and timezone fields to the Facility resolved via OrganizationUserFacility', async () => {
    mockAuth.mockResolvedValue(makeSession('owner'));

    await updateOrganization(updateData);

    expect(prisma.organizationUserFacility.findFirst).toHaveBeenCalledWith({
      where: { organizationUserId: 'ou-1', active: true },
      select: { facilityId: true },
    });
    expect(prisma.facility.update).toHaveBeenCalledWith({
      where: { id: 'facility-1' },
      data: expect.objectContaining({
        phone: '555-9999',
        address: '456 Oak Ave',
        city: 'Sacramento',
        state: 'CA',
        zipCode: '95814',
        timezone: 'America/Los_Angeles',
        licenseNumber: 'LIC-123',
        complianceDocumentUrl: 'https://storage/doc.pdf',
        complianceDocumentName: 'doc.pdf',
      }),
    });
  });

  it('does not attempt a facility update when the caller has no active OrganizationUserFacility', async () => {
    mockAuth.mockResolvedValue(makeSession('owner'));
    vi.mocked(prisma.organizationUserFacility.findFirst).mockResolvedValue(null);

    const result = await updateOrganization(updateData);

    expect(result.success).toBe(true);
    expect(prisma.facility.update).not.toHaveBeenCalled();
  });
});

// ── updateFacility ──────────────────────────────────────────────────────────────

describe('updateFacility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.organizationUserFacility.findFirst).mockResolvedValue({
      facilityId: 'facility-1',
    } as never);
  });

  const facilityData = { phone: '555-1111', address: '789 Pine Rd', staffCount: '10' };

  it('rejects when the caller lacks facility.edit (e.g. finance)', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', organizationUserId: 'ou-1', role: 'finance' },
    });

    const result = await updateFacility(facilityData);

    expect(result.success).toBe(false);
    expect(prisma.facility.update).not.toHaveBeenCalled();
  });

  it('allows owner (has facility.edit) to update the facility', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', organizationUserId: 'ou-1', role: 'owner' },
    });

    const result = await updateFacility(facilityData);

    expect(result.success).toBe(true);
    expect(prisma.facility.update).toHaveBeenCalledWith({
      where: { id: 'facility-1' },
      data: expect.objectContaining(facilityData),
    });
  });

  // RBAC ruling: supervisor was demoted to READ-ONLY on every resource, incl.
  // facilities — `facility.edit` now resolves to owner/admin only. Previously
  // this test asserted supervisor could write, which predates the ruling.
  // Representative "supervisor write denied" coverage at the action level.
  it('denies supervisor — demoted to read-only, no longer holds facility.edit', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', organizationUserId: 'ou-1', role: 'supervisor' },
    });

    const result = await updateFacility(facilityData);

    expect(result).toEqual({ success: false, error: 'Forbidden' });
    expect(prisma.facility.update).not.toHaveBeenCalled();
  });

  it('allows admin (Owner-equivalent, has facility.edit) to update the facility', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', organizationUserId: 'ou-1', role: 'admin' },
    });

    const result = await updateFacility(facilityData);

    expect(result.success).toBe(true);
  });

  it('writes the new name and type fields to the facility', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', organizationUserId: 'ou-1', role: 'owner' },
    });

    const result = await updateFacility({ name: 'Sunrise Behavioral', type: 'Behavioral health' });

    expect(result.success).toBe(true);
    expect(prisma.facility.update).toHaveBeenCalledWith({
      where: { id: 'facility-1' },
      data: expect.objectContaining({ name: 'Sunrise Behavioral', type: 'Behavioral health' }),
    });
  });

  it('regression: a stale/unknown role (e.g. the retired "worker" role) is denied cleanly, not thrown', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', organizationUserId: 'ou-1', role: 'nurse' },
    });

    const result = await updateFacility(facilityData);

    expect(result).toEqual({ success: false, error: 'Forbidden' });
    expect(prisma.facility.update).not.toHaveBeenCalled();
  });

  it('regression: an entirely bogus role string is denied cleanly, not thrown', async () => {
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', organizationUserId: 'ou-1', role: 'nope' },
    });

    const result = await updateFacility(facilityData);

    expect(result).toEqual({ success: false, error: 'Forbidden' });
    expect(prisma.facility.update).not.toHaveBeenCalled();
  });
});

// ── createFacility ────────────────────────────────────────────────────────────

describe('createFacility', () => {
  function makeSession(role: string, overrides: Record<string, unknown> = {}) {
    return { user: { id: 'user-1', organizationId: 'org-1', role, ...overrides } };
  }

  const input = { name: 'Sunrise Behavioral', type: 'Behavioral health', address: '1 Main St' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue(makeSession('owner'));
    vi.mocked(prisma.facility.create).mockResolvedValue({ id: 'facility-new' } as never);
    mockCreateInvites.mockResolvedValue({
      success: true,
      results: [{ email: 'sup@acme.com', status: 'sent' }],
    });
  });

  it('rejects when not authenticated', async () => {
    mockAuth.mockResolvedValue(null);

    const result = await createFacility(input);

    expect(result).toEqual({ success: false, error: 'Not authenticated' });
    expect(prisma.facility.create).not.toHaveBeenCalled();
  });

  it('rejects when the session carries no organization', async () => {
    mockAuth.mockResolvedValue(makeSession('owner', { organizationId: undefined }));

    const result = await createFacility(input);

    expect(result).toEqual({ success: false, error: 'No organization found' });
    expect(prisma.facility.create).not.toHaveBeenCalled();
  });

  it.each(['supervisor', 'hr', 'clinical_director', 'finance'])(
    'denies role=%s — facility.create is Owner/Admin only',
    async (role) => {
      mockAuth.mockResolvedValue(makeSession(role));

      const result = await createFacility(input);

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/permission/i);
      expect(prisma.facility.create).not.toHaveBeenCalled();
    },
  );

  it.each(['owner', 'admin'])('allows role=%s (holds facility.create)', async (role) => {
    mockAuth.mockResolvedValue(makeSession(role));

    const result = await createFacility(input);

    expect(result.success).toBe(true);
    expect(result.facilityId).toBe('facility-new');
  });

  it("scopes the created facility to the caller's organization", async () => {
    await createFacility(input);

    expect(prisma.facility.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        name: 'Sunrise Behavioral',
        type: 'Behavioral health',
        address: '1 Main St',
      },
      select: { id: true },
    });
  });

  it('rejects an empty facility name', async () => {
    const result = await createFacility({ ...input, name: '   ' });

    expect(result.success).toBe(false);
    expect(prisma.facility.create).not.toHaveBeenCalled();
  });

  it('rejects an empty facility type', async () => {
    const result = await createFacility({ ...input, type: '' });

    expect(result.success).toBe(false);
    expect(prisma.facility.create).not.toHaveBeenCalled();
  });

  it('rejects a malformed supervisor email', async () => {
    const result = await createFacility({ ...input, supervisorEmail: 'not-an-email' });

    expect(result.success).toBe(false);
    expect(prisma.facility.create).not.toHaveBeenCalled();
  });

  it('accepts an empty-string supervisor email as "no invite requested"', async () => {
    const result = await createFacility({ ...input, supervisorEmail: '' });

    expect(result.success).toBe(true);
    expect(mockCreateInvites).not.toHaveBeenCalled();
  });

  it('does not invite anyone when supervisorEmail is omitted — facility still created', async () => {
    const result = await createFacility(input);

    expect(result.success).toBe(true);
    expect(result.supervisorInvited).toBe(false);
    expect(mockCreateInvites).not.toHaveBeenCalled();
  });

  it('invites the supervisor to the new facility when an email is given', async () => {
    const result = await createFacility({ ...input, supervisorEmail: 'Sup@Acme.com' });

    expect(result.success).toBe(true);
    expect(result.supervisorInvited).toBe(true);
    expect(mockCreateInvites).toHaveBeenCalledWith(
      [{ email: 'sup@acme.com', role: 'supervisor' }],
      { facilityId: 'facility-new' },
    );
  });

  it('still succeeds (facility created) when the supervisor invite fails — best-effort', async () => {
    mockCreateInvites.mockResolvedValue({ success: false, results: [], error: 'Rate limited' });

    const result = await createFacility({ ...input, supervisorEmail: 'sup@acme.com' });

    expect(result.success).toBe(true);
    expect(result.facilityId).toBe('facility-new');
    expect(result.supervisorInvited).toBe(false);
  });

  it('treats a non-"sent" invite status (e.g. "exists") as not-invited', async () => {
    mockCreateInvites.mockResolvedValue({
      success: true,
      results: [{ email: 'sup@acme.com', status: 'exists' }],
    });

    const result = await createFacility({ ...input, supervisorEmail: 'sup@acme.com' });

    expect(result.success).toBe(true);
    expect(result.supervisorInvited).toBe(false);
  });
});
