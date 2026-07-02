/**
 * Unit tests for src/app/actions/onboarding-complete.ts — completeOnboarding()
 *
 * Covers the Organization/Facility split reconciliation for the onboarding
 * wizard's final step:
 *   - Facility receives step1's location fields + a timezone derived from
 *     step1.state; Organization receives only org-level fields (slug,
 *     isHipaaCompliant, business type) and none of the moved fields.
 *   - The founding user is linked with organizationId + facilityId and role
 *     'owner'.
 *   - Step 4 worker invites are created with role 'worker' and org name from
 *     the transaction's own org record.
 *
 * External deps (@/auth, @/lib/prisma, @/lib/email) are mocked so this stays
 * a pure unit test with no NextAuth/Next.js runtime or real DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockAuth, mockSendInviteEmail, txMock } = vi.hoisted(() => {
  const txMock = {
    organization: { findFirst: vi.fn(), create: vi.fn() },
    facility: { create: vi.fn() },
    user: { update: vi.fn(), findUnique: vi.fn() },
    invite: { create: vi.fn() },
  };
  return { mockAuth: vi.fn(), mockSendInviteEmail: vi.fn(), txMock };
});

vi.mock('@/auth', () => ({ auth: mockAuth }));

vi.mock('@/lib/prisma', () => {
  const prisma = {
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(async (cb: (tx: typeof txMock) => unknown) => cb(txMock)),
  };
  return { prisma, default: prisma };
});

vi.mock('@/lib/email', () => ({ sendInviteEmail: mockSendInviteEmail }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { completeOnboarding, type OnboardingData } from './onboarding-complete';
import prisma from '@/lib/prisma';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BASE_DATA: OnboardingData = {
  step1: {
    legalName: 'Acme Health',
    primaryContactEmail: 'owner@acme.com',
    primaryContactName: 'Jane Owner',
    state: 'CA',
    streetAddress: '123 Main St',
    city: 'Los Angeles',
    zipCode: '90001',
    country: 'US',
    phone: '555-0100',
    staffCount: '25',
  },
  step2: { hipaaCompliant: 'yes', licenseNumber: 'LIC-1' },
  step3: { primaryBusinessType: 'home-health', services: ['skilled-nursing'] },
  step4: { workerEmails: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ organizationId: null } as never);
  txMock.organization.findFirst.mockResolvedValue(null);
  txMock.organization.create.mockResolvedValue({ id: 'org-1', name: 'Acme Health' });
  txMock.facility.create.mockResolvedValue({ id: 'facility-1' });
  txMock.user.update.mockResolvedValue({});
  txMock.user.findUnique.mockResolvedValue(null); // no existing user for invite emails
  txMock.invite.create.mockResolvedValue({});
  mockSendInviteEmail.mockResolvedValue(undefined);
});

describe('completeOnboarding — Organization/Facility split', () => {
  it('creates the facility with step1 location fields and a timezone derived from state', async () => {
    await completeOnboarding(BASE_DATA);

    expect(txMock.facility.create).toHaveBeenCalledTimes(1);
    const facilityData = txMock.facility.create.mock.calls[0][0].data;
    expect(facilityData).toMatchObject({
      organizationId: 'org-1',
      address: '123 Main St',
      city: 'Los Angeles',
      zipCode: '90001',
      country: 'US',
      phone: '555-0100',
      staffCount: '25',
      state: 'CA',
      licenseNumber: 'LIC-1',
      programServices: ['skilled-nursing'],
    });
    // CA → America/Los_Angeles (real deriveTimezoneFromState, unmocked).
    expect(facilityData.timezone).toBe('America/Los_Angeles');
  });

  it('does not put location/compliance/timezone fields on the Organization', async () => {
    await completeOnboarding(BASE_DATA);

    expect(txMock.organization.create).toHaveBeenCalledTimes(1);
    const orgData = txMock.organization.create.mock.calls[0][0].data;
    expect(orgData).not.toHaveProperty('timezone');
    expect(orgData).not.toHaveProperty('address');
    expect(orgData).not.toHaveProperty('city');
    expect(orgData).not.toHaveProperty('state');
    expect(orgData).not.toHaveProperty('zipCode');
    expect(orgData).not.toHaveProperty('phone');
    expect(orgData).not.toHaveProperty('staffCount');
    expect(orgData).not.toHaveProperty('licenseNumber');
    expect(orgData).not.toHaveProperty('programServices');
    // Org-level fields are still set correctly.
    expect(orgData.name).toBe('Acme Health');
    expect(orgData.isHipaaCompliant).toBe(true);
    expect(orgData.primaryBusinessType).toBe('home-health');
  });

  it('falls back to DEFAULT_TZ (America/New_York) when step1.state is omitted', async () => {
    await completeOnboarding({
      ...BASE_DATA,
      step1: { ...BASE_DATA.step1, state: undefined },
    });

    const facilityData = txMock.facility.create.mock.calls[0][0].data;
    expect(facilityData.timezone).toBe('America/New_York');
  });

  it('links the founding user with organizationId, facilityId, and role "owner"', async () => {
    await completeOnboarding(BASE_DATA);

    expect(txMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { organizationId: 'org-1', facilityId: 'facility-1', role: 'owner' },
    });
  });

  it('rejects when the user already belongs to an organization', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      organizationId: 'org-existing',
    } as never);

    const result = await completeOnboarding(BASE_DATA);

    expect(result.success).toBe(false);
    expect(txMock.facility.create).not.toHaveBeenCalled();
  });

  it('creates step4 worker invites with role "worker"', async () => {
    const result = await completeOnboarding({
      ...BASE_DATA,
      step4: { workerEmails: ['worker@acme.com'] },
    });

    expect(result.success).toBe(true);
    expect(txMock.invite.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'worker@acme.com', role: 'worker' }),
      }),
    );
  });
});
