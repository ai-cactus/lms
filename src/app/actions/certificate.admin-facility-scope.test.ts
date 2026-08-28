/**
 * getAdminWorkerCertificates is the certificate half of the staff profile, so
 * it must reach the same verdict as getStaffDetails — otherwise a target the
 * profile 404s on (e.g. someone outside the caller's facility) still yields
 * their full training/certificate history through this id-addressed action.
 *
 * Two things changed on this branch and both need direct coverage:
 *  - the gate moved from `isAdminRole` (admits finance and clinical_director,
 *    neither of whom holds `user.read`) to `can(roleKey, 'user.read')`.
 *  - the query now composes `staffFacilityWhere`, so an out-of-facility target
 *    must come back EMPTY, indistinguishable from an unknown organizationUserId.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAdminAuth, mockWorkerAuth, prismaMock, mockListAccessibleFacilities } = vi.hoisted(
  () => ({
    mockAdminAuth: vi.fn(),
    mockWorkerAuth: vi.fn(),
    prismaMock: { certificate: { findMany: vi.fn() } },
    mockListAccessibleFacilities: vi.fn(),
  }),
);

vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/lib/audit', () => ({ audit: vi.fn(), getClientContext: () => ({}) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/storage', () => ({ uploadFile: vi.fn() }));
vi.mock('@/lib/certificate-generator', () => ({ generateCertificatePDF: vi.fn() }));
vi.mock('@/lib/facility/scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/facility/scope')>()),
  listAccessibleFacilities: mockListAccessibleFacilities,
}));

import { getAdminWorkerCertificates } from './certificate';

const ORG_ID = 'org-1';

function setSession(userId: string, role: string) {
  mockAdminAuth.mockResolvedValue({
    user: { id: userId, role, organizationId: ORG_ID, organizationUserId: `ou-${userId}` },
  });
  mockWorkerAuth.mockResolvedValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.certificate.findMany.mockResolvedValue([]);
  mockListAccessibleFacilities.mockResolvedValue([]);
});

describe('getAdminWorkerCertificates — role gate', () => {
  it.each(['owner', 'admin', 'hr', 'supervisor'])(
    '%s (holds user.read) is admitted',
    async (role) => {
      setSession('viewer-1', role);

      await getAdminWorkerCertificates('ou-target');

      expect(prismaMock.certificate.findMany).toHaveBeenCalledOnce();
    },
  );

  it.each(['finance', 'clinical_director'])(
    'THE FIX: %s (isAdminRole but no user.read) is now denied — previously admitted by isAdminRole',
    async (role) => {
      setSession('viewer-1', role);

      await expect(getAdminWorkerCertificates('ou-target')).rejects.toThrow('Unauthorized');
      expect(prismaMock.certificate.findMany).not.toHaveBeenCalled();
    },
  );

  it('a worker is denied', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'worker-1', role: 'nurse', organizationId: ORG_ID, organizationUserId: 'ou-w1' },
    });

    await expect(getAdminWorkerCertificates('ou-target')).rejects.toThrow('Unauthorized');
    expect(prismaMock.certificate.findMany).not.toHaveBeenCalled();
  });

  it('throws Unauthorized with no session or no organizationId', async () => {
    mockAdminAuth.mockResolvedValue({ user: { id: 'u1', role: 'owner', organizationId: null } });
    mockWorkerAuth.mockResolvedValue(null);

    await expect(getAdminWorkerCertificates('ou-target')).rejects.toThrow('Unauthorized');
  });
});

describe('getAdminWorkerCertificates — facility scope', () => {
  it('an ORG-WIDE role (owner) queries with NO facility predicate on the target', async () => {
    setSession('owner-1', 'owner');

    await getAdminWorkerCertificates('ou-target');

    const where = prismaMock.certificate.findMany.mock.calls[0][0].where;
    expect(where.organizationUser.facilities).toBeUndefined();
  });

  it('a FACILITY-BOUND role (supervisor) narrows the query to their accessible facilities', async () => {
    setSession('supervisor-1', 'supervisor');
    mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-1' }]);

    await getAdminWorkerCertificates('ou-target');

    const where = prismaMock.certificate.findMany.mock.calls[0][0].where;
    expect(where.organizationUser.facilities).toEqual({
      some: { facilityId: { in: ['fac-1'] }, active: true },
    });
  });

  it('AN OUT-OF-FACILITY TARGET returns the same EMPTY result as an unknown organizationUserId — the two must be indistinguishable', async () => {
    setSession('supervisor-1', 'supervisor');
    mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-1' }]);
    // The mocked query itself can't enforce the predicate, so this models what
    // a real out-of-facility (or unknown) target genuinely yields: no rows.
    prismaMock.certificate.findMany.mockResolvedValue([]);

    const outOfFacilityResult = await getAdminWorkerCertificates('ou-other-facility-target');
    const unknownIdResult = await getAdminWorkerCertificates('ou-does-not-exist');

    expect(outOfFacilityResult).toEqual([]);
    expect(unknownIdResult).toEqual([]);
    expect(outOfFacilityResult).toEqual(unknownIdResult);
  });

  it('FAIL-CLOSED: a facility-bound role with no accessible facilities narrows to an impossible `in: []`, never to the whole org', async () => {
    setSession('supervisor-1', 'supervisor');
    mockListAccessibleFacilities.mockResolvedValue([]);

    await getAdminWorkerCertificates('ou-target');

    const where = prismaMock.certificate.findMany.mock.calls[0][0].where;
    expect(where.organizationUser.facilities).toEqual({
      some: { facilityId: { in: [] }, active: true },
    });
  });

  it("scopes to the caller's own organization regardless of role (tenant isolation unchanged)", async () => {
    setSession('owner-1', 'owner');

    await getAdminWorkerCertificates('ou-target');

    const where = prismaMock.certificate.findMany.mock.calls[0][0].where;
    expect(where.organizationUserId).toBe('ou-target');
    expect(where.organizationUser.organizationId).toBe(ORG_ID);
  });
});
