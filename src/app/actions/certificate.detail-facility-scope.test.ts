/**
 * `getCertificateDetails` is id-addressed and was gated on
 * `isAdminRole(role) && certificate.organizationUser.organizationId === caller's org`.
 *
 * `isAdminRole` admits Facility Supervisor, and nothing narrowed by facility —
 * so a supervisor holding any certificate id could read that certificate's
 * holder name, email, course and score even for staff in a facility they have
 * no access to. Its sibling `getAdminWorkerCertificates` was already scoped;
 * this is the id-addressed hole beside it.
 *
 * The self-access branch must stay AHEAD of the narrowing: a member with no
 * active facility assignment resolves to `[]`, which would otherwise hide their
 * own certificate from them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAdminAuth, mockWorkerAuth, prismaMock, mockListAccessibleFacilities } = vi.hoisted(
  () => ({
    mockAdminAuth: vi.fn(),
    mockWorkerAuth: vi.fn(),
    prismaMock: { certificate: { findUnique: vi.fn(), findFirst: vi.fn() } },
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
  maskEmail: (e: string) => e,
}));
vi.mock('@/lib/storage', () => ({ uploadFile: vi.fn() }));
vi.mock('@/lib/certificate-generator', () => ({ generateCertificatePDF: vi.fn() }));
vi.mock('@/lib/facility/scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/facility/scope')>()),
  listAccessibleFacilities: mockListAccessibleFacilities,
}));

import { getCertificateDetails } from './certificate';

const ORG_ID = 'org-1';
const HOLDER_OU = 'ou-holder';

const CERTIFICATE = {
  id: 'cert-1',
  organizationUserId: HOLDER_OU,
  organizationUser: {
    organizationId: ORG_ID,
    user: { fullName: 'Dana Holder', email: 'dana@example.com' },
    organization: { name: 'Org One' },
  },
  course: { title: 'Infection Control' },
};

function setAdminSession(role: string, organizationUserId = 'ou-viewer') {
  mockAdminAuth.mockResolvedValue({
    user: { id: 'viewer-1', role, organizationId: ORG_ID, organizationUserId },
  });
  mockWorkerAuth.mockResolvedValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.certificate.findUnique.mockResolvedValue(CERTIFICATE);
  // The scoped re-read answers by default; each test that models an
  // out-of-scope target overrides it with null.
  prismaMock.certificate.findFirst.mockResolvedValue({ id: 'cert-1' });
  mockListAccessibleFacilities.mockResolvedValue([]);
});

describe('getCertificateDetails — the owning learner', () => {
  it('reads their own certificate without any facility resolution', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'w-1', role: 'nurse', organizationId: ORG_ID, organizationUserId: HOLDER_OU },
    });

    await expect(getCertificateDetails('cert-1')).resolves.toBe(CERTIFICATE);

    expect(mockListAccessibleFacilities).not.toHaveBeenCalled();
    expect(prismaMock.certificate.findFirst).not.toHaveBeenCalled();
  });

  it('keeps their own certificate even with NO active facility assignment (which narrows to `[]`)', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'w-1', role: 'nurse', organizationId: ORG_ID, organizationUserId: HOLDER_OU },
    });
    mockListAccessibleFacilities.mockResolvedValue([]);

    await expect(getCertificateDetails('cert-1')).resolves.toBe(CERTIFICATE);
  });

  it('a worker reading SOMEONE ELSE’s certificate is refused by the role tier, before any query', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'w-2', role: 'nurse', organizationId: ORG_ID, organizationUserId: 'ou-other' },
    });

    await expect(getCertificateDetails('cert-1')).rejects.toThrow('Unauthorized');
    // Not by the facility predicate coming back empty — the tier check refuses
    // first, so this never depends on how the target's facilities happen to sit.
    expect(prismaMock.certificate.findFirst).not.toHaveBeenCalled();
  });
});

describe('getCertificateDetails — facility scope', () => {
  it('THE FIX: a supervisor is REFUSED a certificate outside their facilities', async () => {
    setAdminSession('supervisor');
    mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-1' }]);
    // Models what the scoped query genuinely yields for an out-of-facility
    // holder: no row.
    prismaMock.certificate.findFirst.mockResolvedValue(null);

    await expect(getCertificateDetails('cert-1')).rejects.toThrow('Unauthorized');
  });

  it('a supervisor narrows the scoped re-read to their accessible facilities', async () => {
    setAdminSession('supervisor');
    mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-1' }]);

    await getCertificateDetails('cert-1');

    const where = prismaMock.certificate.findFirst.mock.calls[0][0].where;
    expect(where.organizationUser.facilities).toEqual({
      some: { facilityId: { in: ['fac-1'] }, active: true },
    });
  });

  it('FAIL-CLOSED: a supervisor with no accessible facilities narrows to an impossible `in: []`, never to the whole org', async () => {
    setAdminSession('supervisor');
    mockListAccessibleFacilities.mockResolvedValue([]);

    await getCertificateDetails('cert-1');

    const where = prismaMock.certificate.findFirst.mock.calls[0][0].where;
    expect(where.organizationUser.facilities).toEqual({
      some: { facilityId: { in: [] }, active: true },
    });
  });

  it('an ORG-WIDE role (owner) applies NO facility predicate', async () => {
    setAdminSession('owner');

    await getCertificateDetails('cert-1');

    const where = prismaMock.certificate.findFirst.mock.calls[0][0].where;
    expect(where.organizationUser.facilities).toBeUndefined();
  });

  it('tenant isolation is expressed in the query, not compared in JS', async () => {
    setAdminSession('owner');

    await getCertificateDetails('cert-1');

    const where = prismaMock.certificate.findFirst.mock.calls[0][0].where;
    expect(where.id).toBe('cert-1');
    expect(where.organizationUser.organizationId).toBe(ORG_ID);
  });
});

describe('getCertificateDetails — permission gate', () => {
  /**
   * `isAdminRole && certificate.read` — BOTH halves, and this block exists
   * because dropping either one re-opens a different hole.
   *
   * All eight WORKER roles hold `certificate.read` (`workerPermissions` in the
   * registry) so a learner can read their OWN. On an id-addressed action the
   * verb therefore does not separate "my certificate" from "theirs": without
   * the `isAdminRole` half a nurse gets any colleague's name, course and score
   * within their facility. The original `isAdminRole`-only gate refused them —
   * so a verb-only gate would be a REGRESSION, not a partial fix.
   */
  it.each(['nurse', 'therapist_clinician', 'front_desk_admin'])(
    '%s holds certificate.read but is still denied someone else’s certificate',
    async (role) => {
      mockAdminAuth.mockResolvedValue(null);
      mockWorkerAuth.mockResolvedValue({
        user: { id: 'w-2', role, organizationId: ORG_ID, organizationUserId: 'ou-other' },
      });

      await expect(getCertificateDetails('cert-1')).rejects.toThrow('Unauthorized');
      expect(prismaMock.certificate.findFirst).not.toHaveBeenCalled();
    },
  );

  it('a worker role signed in on the ADMIN instance is denied too — the cookie is not the role', async () => {
    setAdminSession('nurse', 'ou-other');

    await expect(getCertificateDetails('cert-1')).rejects.toThrow('Unauthorized');
    expect(prismaMock.certificate.findFirst).not.toHaveBeenCalled();
  });

  it.each(['owner', 'admin', 'supervisor', 'hr', 'clinical_director'])(
    '%s is admitted — founder Q7',
    async (role) => {
      setAdminSession(role);

      await expect(getCertificateDetails('cert-1')).resolves.toBe(CERTIFICATE);
    },
  );

  it('an unknown/stale role key is denied before any scope resolution', async () => {
    setAdminSession('not_a_real_role');

    await expect(getCertificateDetails('cert-1')).rejects.toThrow('Unauthorized');
    expect(prismaMock.certificate.findFirst).not.toHaveBeenCalled();
  });

  it('a session with no organizationId is denied rather than querying without a tenant predicate', async () => {
    mockAdminAuth.mockResolvedValue({
      user: { id: 'viewer-1', role: 'owner', organizationId: null, organizationUserId: 'ou-v' },
    });
    mockWorkerAuth.mockResolvedValue(null);

    await expect(getCertificateDetails('cert-1')).rejects.toThrow('Unauthorized');
    expect(prismaMock.certificate.findFirst).not.toHaveBeenCalled();
  });

  it('a missing certificate still reports "not found", not "unauthorized"', async () => {
    setAdminSession('owner');
    prismaMock.certificate.findUnique.mockResolvedValue(null);

    await expect(getCertificateDetails('nope')).rejects.toThrow('Certificate not found');
  });
});
