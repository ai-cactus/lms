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

  it('a worker reading SOMEONE ELSE’s certificate goes through the administrative gate', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'w-2', role: 'nurse', organizationId: ORG_ID, organizationUserId: 'ou-other' },
    });
    // A worker holds `certificate.read` but is facility-bound; with no
    // assignment the predicate narrows to nothing.
    prismaMock.certificate.findFirst.mockResolvedValue(null);

    await expect(getCertificateDetails('cert-1')).rejects.toThrow('Unauthorized');
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
