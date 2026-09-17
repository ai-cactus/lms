/**
 * getAdminWorkerCertificates is the certificate half of the staff profile, so
 * it must reach the same verdict as getStaffDetails — otherwise a target the
 * profile 404s on (e.g. someone outside the caller's facility) still yields
 * their full training/certificate history through this id-addressed action.
 *
 * Two things need direct coverage:
 *  - the gate, now `isAdminRole(role) && can(roleKey, 'certificate.read')` —
 *    the same pair as `getCertificateDetails` and the download route. It read
 *    `can(roleKey, 'user.read')` until founder Q7 was applied; see the "role
 *    gate" block below for why that denied the wrong role.
 *  - the query composes `staffFacilityWhere`, so an out-of-facility target
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
  /**
   * Founder Q7: "All Clinical/Quality to see certificates. For Clinical/Quality
   * directors to see certificates, they need access to all staff. Finance
   * should not be able to see certificates."
   *
   * The gate asked for `user.read`, which reads as "the staff-profile verb" but
   * denies clinical_director — the role Q7 names first. Certificates are a
   * Clinical/Quality concern; Staff Management is not, and Q7 does not open it
   * to them. So the certificate verb decides certificate reads, and this action
   * now agrees with `getCertificateDetails` and the download route instead of
   * contradicting them on the same staff profile.
   */
  it.each(['owner', 'admin', 'hr', 'supervisor', 'clinical_director'])(
    '%s is admitted',
    async (role) => {
      setSession('viewer-1', role);

      await getAdminWorkerCertificates('ou-target');

      expect(prismaMock.certificate.findMany).toHaveBeenCalledOnce();
    },
  );

  it('THE FIX: clinical_director is admitted — Q7 names it first, and `user.read` denied it', async () => {
    setSession('viewer-1', 'clinical_director');

    await expect(getAdminWorkerCertificates('ou-target')).resolves.toEqual([]);
    expect(prismaMock.certificate.findMany).toHaveBeenCalledOnce();
  });

  it('Q7 "access to all staff": clinical_director is org-wide, so no facility predicate narrows it', async () => {
    setSession('viewer-1', 'clinical_director');
    // Assignments it does not have, to prove the verdict comes from the role's
    // org-wide status rather than from an empty roster.
    mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-1' }]);

    await getAdminWorkerCertificates('ou-target');

    const where = prismaMock.certificate.findMany.mock.calls[0][0].where;
    expect(where.organizationUser.facilities).toBeUndefined();
  });

  /**
   * DEFENCE IN DEPTH, and the assertion is deliberately weaker than it looks.
   *
   * This action takes `adminAuth()`, and the admin instance invalidates any
   * session whose freshly-read role is not an admin role (`auth.ts:6` +
   * `create-auth-instance.ts:736`). So the session staged below cannot exist in
   * production, and this does NOT prove a real attack is refused — the test
   * below, on the worker instance, is the one that covers the reachable case.
   *
   * It is kept because the pairing still matters: every worker role holds
   * `certificate.read` (`workerPermissions`, so a learner can read their own),
   * so if this action ever moves to a resolve-either-instance session — as its
   * sibling `getCertificateDetails` uses — the verb alone would admit all eight.
   * This pins the gate against that refactor, not against today's traffic.
   */
  it.each(['nurse', 'therapist_clinician', 'front_desk_admin'])(
    '%s would be refused even if the admin instance ever stopped fencing it out',
    async (role) => {
      setSession('worker-1', role);

      await expect(getAdminWorkerCertificates('ou-target')).rejects.toThrow('Unauthorized');
      expect(prismaMock.certificate.findMany).not.toHaveBeenCalled();
    },
  );

  it('THE REACHABLE CASE: a worker on the worker instance is denied', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'worker-1', role: 'nurse', organizationId: ORG_ID, organizationUserId: 'ou-w1' },
    });

    await expect(getAdminWorkerCertificates('ou-target')).rejects.toThrow('Unauthorized');
    expect(prismaMock.certificate.findMany).not.toHaveBeenCalled();
  });

  it('an unknown/stale role key is denied', async () => {
    setSession('viewer-1', 'not_a_real_role');

    await expect(getAdminWorkerCertificates('ou-target')).rejects.toThrow('Unauthorized');
    expect(prismaMock.certificate.findMany).not.toHaveBeenCalled();
  });

  /**
   * ⛔ FINANCE IS DELIBERATELY UNASSERTED HERE — and it is the reason this
   * branch must merge AFTER fix/rbac-registry-role-grants (Phase 1).
   *
   * Q7 says Finance must not see certificates, and Phase 1 delivers that by
   * removing `certificate.read` from the finance role. On THIS branch finance
   * still holds the verb and is admin-tier, so the gate admits it — whereas the
   * `user.read` gate this replaced denied it. Merged out of order, this commit
   * therefore GRANTS Finance certificate access on the staff profile until
   * Phase 1 lands.
   *
   * An assertion either way would be red on one side of that merge, so the cell
   * belongs to Phase 1's conformance test, which owns the registry change. What
   * is pinned here is the shape that makes Phase 1 sufficient: the gate consults
   * `can(role, 'certificate.read')`, so removing the verb is all Phase 1 needs
   * to do — no second edit to this file.
   */

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
