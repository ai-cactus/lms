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

const { mockAuth, txMock } = vi.hoisted(() => {
  const txMock = {
    organization: { create: vi.fn(), findFirst: vi.fn() },
    facility: { create: vi.fn() },
    user: { update: vi.fn() },
  };
  return { mockAuth: vi.fn(), txMock };
});

vi.mock('@/auth', () => ({ auth: mockAuth }));
// F-001 audit is a best-effort side-channel — stub it so business-logic tests
// don't depend on the audit sink or the request-scoped headers() it reads.
vi.mock('@/lib/audit', () => ({ audit: vi.fn(), getClientContext: () => ({}) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

// Mock the prisma client
vi.mock('@/lib/prisma', () => {
  const prisma = {
    organization: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    facility: {
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(async (cb: (tx: typeof txMock) => unknown) => cb(txMock)),
  };
  return { prisma, default: prisma };
});

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  checkOrganizationNameAvailable,
  createOrganization,
  updateOrganization,
  updateFacility,
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
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ organizationId: null } as never);
    // Reset any leftover mock state from other describe blocks in this file
    // (vi.clearAllMocks() clears call history but not a previously-set
    // mockResolvedValue implementation).
    vi.mocked(prisma.organization.findFirst).mockResolvedValue(null);
    txMock.organization.findFirst.mockResolvedValue(null);
    txMock.organization.create.mockResolvedValue({ id: 'org-1', name: 'Acme Health' });
    txMock.facility.create.mockResolvedValue({ id: 'facility-1' });
    txMock.user.update.mockResolvedValue({});
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

  it('links the founding user with facilityId and role "owner"', async () => {
    await createOrganization(baseData);

    expect(txMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: {
        organizationId: 'org-1',
        facilityId: 'facility-1',
        role: 'owner',
        roleAssignedAt: expect.any(Date),
      },
    });
  });

  it('rejects when the user already belongs to an organization', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      organizationId: 'org-existing',
    } as never);

    const result = await createOrganization(baseData);

    expect(result.success).toBe(false);
    expect(txMock.facility.create).not.toHaveBeenCalled();
  });
});

// ── updateOrganization ──────────────────────────────────────────────────────────

describe('updateOrganization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
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
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      organizationId: 'org-1',
      facilityId: 'facility-1',
      role: 'nurse',
    } as never);

    const result = await updateOrganization(updateData);

    expect(result.success).toBe(false);
    expect(prisma.organization.update).not.toHaveBeenCalled();
  });

  it.each(['owner', 'supervisor', 'hr', 'clinical_director', 'finance'])(
    'allows an admin-tier role (%s) to update the organization',
    async (role) => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        organizationId: 'org-1',
        facilityId: 'facility-1',
        role,
      } as never);

      const result = await updateOrganization(updateData);

      expect(result.success).toBe(true);
    },
  );

  it('writes only org-level fields to Organization (no location/timezone/compliance)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      organizationId: 'org-1',
      facilityId: 'facility-1',
      role: 'owner',
    } as never);

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

  it('writes location, compliance, and timezone fields to the Facility', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      organizationId: 'org-1',
      facilityId: 'facility-1',
      role: 'owner',
    } as never);

    await updateOrganization(updateData);

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

  it('does not attempt a facility update when the user has no facilityId', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      organizationId: 'org-1',
      facilityId: null,
      role: 'owner',
    } as never);

    const result = await updateOrganization(updateData);

    expect(result.success).toBe(true);
    expect(prisma.facility.update).not.toHaveBeenCalled();
  });
});

// ── updateFacility ──────────────────────────────────────────────────────────────

describe('updateFacility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const facilityData = { phone: '555-1111', address: '789 Pine Rd', staffCount: '10' };

  it('rejects when the caller lacks facility.edit (e.g. finance)', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'finance' } });

    const result = await updateFacility(facilityData);

    expect(result.success).toBe(false);
    expect(prisma.facility.update).not.toHaveBeenCalled();
  });

  it('allows owner (has facility.edit) to update the facility', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'owner' } });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ facilityId: 'facility-1' } as never);

    const result = await updateFacility(facilityData);

    expect(result.success).toBe(true);
    expect(prisma.facility.update).toHaveBeenCalledWith({
      where: { id: 'facility-1' },
      data: expect.objectContaining(facilityData),
    });
  });

  it('allows supervisor (has facility.edit) to update the facility', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'supervisor' } });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ facilityId: 'facility-1' } as never);

    const result = await updateFacility(facilityData);

    expect(result.success).toBe(true);
  });

  it('writes the new name and type fields to the facility', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'owner' } });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ facilityId: 'facility-1' } as never);

    const result = await updateFacility({ name: 'Sunrise Behavioral', type: 'Behavioral health' });

    expect(result.success).toBe(true);
    expect(prisma.facility.update).toHaveBeenCalledWith({
      where: { id: 'facility-1' },
      data: expect.objectContaining({ name: 'Sunrise Behavioral', type: 'Behavioral health' }),
    });
  });

  it('regression: a stale/unknown role (e.g. the retired "worker" role) is denied cleanly, not thrown', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'nurse' } });

    const result = await updateFacility(facilityData);

    expect(result).toEqual({ success: false, error: 'Forbidden' });
    expect(prisma.facility.update).not.toHaveBeenCalled();
  });

  it('regression: an entirely bogus role string is denied cleanly, not thrown', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1', role: 'nope' } });

    const result = await updateFacility(facilityData);

    expect(result).toEqual({ success: false, error: 'Forbidden' });
    expect(prisma.facility.update).not.toHaveBeenCalled();
  });
});
