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
 *   - Step 4 worker invites are created with role 'front_desk_admin'
 *     (DEFAULT_SELF_SERVE_WORKER_ROLE) and org name from the transaction's
 *     own org record.
 *
 * External deps (@/auth, @/lib/prisma, @/lib/email) are mocked so this stays
 * a pure unit test with no NextAuth/Next.js runtime or real DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockAuth, mockSendInviteEmail, mockLoggerWarn, txMock } = vi.hoisted(() => {
  const txMock = {
    organization: { findFirst: vi.fn(), create: vi.fn() },
    facility: { create: vi.fn() },
    facilityDocument: { createMany: vi.fn() },
    user: { update: vi.fn(), findUnique: vi.fn() },
    invite: { create: vi.fn() },
  };
  return { mockAuth: vi.fn(), mockSendInviteEmail: vi.fn(), mockLoggerWarn: vi.fn(), txMock };
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
  logger: { info: vi.fn(), warn: mockLoggerWarn, error: vi.fn(), debug: vi.fn() },
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
  step4: { managerInvites: [] },
  step5: { workerEmails: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ organizationId: null } as never);
  txMock.organization.findFirst.mockResolvedValue(null);
  txMock.organization.create.mockResolvedValue({ id: 'org-1', name: 'Acme Health' });
  txMock.facility.create.mockResolvedValue({ id: 'facility-1' });
  txMock.facilityDocument.createMany.mockResolvedValue({ count: 0 });
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

  it('creates step5 worker invites with role "front_desk_admin" (DEFAULT_SELF_SERVE_WORKER_ROLE)', async () => {
    const result = await completeOnboarding({
      ...BASE_DATA,
      step5: { workerEmails: ['worker@acme.com'] },
    });

    expect(result.success).toBe(true);
    expect(txMock.invite.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'worker@acme.com', role: 'front_desk_admin' }),
      }),
    );
  });

  it('completes successfully with empty step4/step5 (the "skip both" path)', async () => {
    const result = await completeOnboarding({
      ...BASE_DATA,
      step4: { managerInvites: [] },
      step5: { workerEmails: [] },
    });

    expect(result.success).toBe(true);
    expect(txMock.invite.create).not.toHaveBeenCalled();
  });

  it('completes successfully when step4/step5 are omitted entirely', async () => {
    const { step4: _step4, step5: _step5, ...withoutInvites } = BASE_DATA;
    void _step4;
    void _step5;

    const result = await completeOnboarding(withoutInvites);

    expect(result.success).toBe(true);
    expect(txMock.invite.create).not.toHaveBeenCalled();
  });
});

describe('completeOnboarding — step4 manager invite role validation (privilege escalation)', () => {
  it.each(['supervisor', 'hr', 'clinical_director', 'finance'])(
    'creates an invite for the manager-category role %s',
    async (role) => {
      const result = await completeOnboarding({
        ...BASE_DATA,
        step4: { managerInvites: [{ email: 'mgr@acme.com', role }] },
      });

      expect(result.success).toBe(true);
      expect(txMock.invite.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'mgr@acme.com', role }),
        }),
      );
    },
  );

  it('skips a manager invite requesting "owner" — never creates the invite, logs a warning', async () => {
    const result = await completeOnboarding({
      ...BASE_DATA,
      step4: { managerInvites: [{ email: 'wannabe-owner@acme.com', role: 'owner' }] },
    });

    expect(result.success).toBe(true);
    expect(txMock.invite.create).not.toHaveBeenCalled();
    expect(mockLoggerWarn).toHaveBeenCalledWith(expect.objectContaining({ role: 'owner' }));
  });

  it('skips a manager invite requesting a worker-category role (e.g. "nurse")', async () => {
    const result = await completeOnboarding({
      ...BASE_DATA,
      step4: { managerInvites: [{ email: 'sneaky-worker@acme.com', role: 'nurse' }] },
    });

    expect(result.success).toBe(true);
    expect(txMock.invite.create).not.toHaveBeenCalled();
  });

  it('skips a manager invite requesting a garbage/unrecognized role string', async () => {
    const result = await completeOnboarding({
      ...BASE_DATA,
      step4: { managerInvites: [{ email: 'garbage@acme.com', role: 'super-admin-hacker' }] },
    });

    expect(result.success).toBe(true);
    expect(txMock.invite.create).not.toHaveBeenCalled();
  });

  it('processes a mixed batch: valid manager rows are invited, disallowed rows are skipped', async () => {
    const result = await completeOnboarding({
      ...BASE_DATA,
      step4: {
        managerInvites: [
          { email: 'good-hr@acme.com', role: 'hr' },
          { email: 'bad-owner@acme.com', role: 'owner' },
          { email: 'bad-worker@acme.com', role: 'nurse' },
          { email: 'good-finance@acme.com', role: 'finance' },
        ],
      },
    });

    expect(result.success).toBe(true);
    expect(txMock.invite.create).toHaveBeenCalledTimes(2);
    const createdEmails = txMock.invite.create.mock.calls.map(
      (call) => (call[0] as { data: { email: string } }).data.email,
    );
    expect(createdEmails).toEqual(
      expect.arrayContaining(['good-hr@acme.com', 'good-finance@acme.com']),
    );
    expect(createdEmails).not.toContain('bad-owner@acme.com');
    expect(createdEmails).not.toContain('bad-worker@acme.com');
  });

  it('skips a manager invite row with a blank email without erroring', async () => {
    const result = await completeOnboarding({
      ...BASE_DATA,
      step4: { managerInvites: [{ email: '', role: 'hr' }] },
    });

    expect(result.success).toBe(true);
    expect(txMock.invite.create).not.toHaveBeenCalled();
  });
});

describe('completeOnboarding — step2 compliance documents', () => {
  const DOCS_DATA: OnboardingData = {
    ...BASE_DATA,
    step2: {
      ...BASE_DATA.step2,
      documents: [
        {
          url: 'gcs://bucket/onboarding/user-1/1-cert.pdf',
          name: 'cert.pdf',
          sizeBytes: 1024,
          mimeType: 'application/pdf',
        },
        {
          url: 'gcs://bucket/onboarding/user-1/2-license.pdf',
          name: 'license.pdf',
          sizeBytes: 2048,
          mimeType: 'application/pdf',
        },
      ],
    },
  };

  it('creates FacilityDocument rows linked to the new facility for each uploaded document', async () => {
    const result = await completeOnboarding(DOCS_DATA);

    expect(result.success).toBe(true);
    expect(txMock.facilityDocument.createMany).toHaveBeenCalledTimes(1);
    const created = txMock.facilityDocument.createMany.mock.calls[0][0].data as Array<{
      facilityId: string;
      url: string;
      name: string;
      sizeBytes: number;
      mimeType: string;
      uploadedById: string;
    }>;
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({
      facilityId: 'facility-1',
      url: 'gcs://bucket/onboarding/user-1/1-cert.pdf',
      name: 'cert.pdf',
      sizeBytes: 1024,
      mimeType: 'application/pdf',
      uploadedById: 'user-1',
    });
    expect(created[1]).toMatchObject({ name: 'license.pdf' });
  });

  it('skips facilityDocument.createMany entirely when step2 has no documents', async () => {
    await completeOnboarding(BASE_DATA);

    expect(txMock.facilityDocument.createMany).not.toHaveBeenCalled();
  });
});
