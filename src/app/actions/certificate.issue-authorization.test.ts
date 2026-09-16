/**
 * `issueCertificate` is the create path for the Certificates row, which the
 * founder's latest matrix moves from `R` to `CR`
 * (docs/local/RBAC_for_multi-tenancy-updated.md). Before that revision the
 * action gated on `isAdminRole(role)` + an org match and checked no permission
 * at all — so Finance, which founder Q7 removed from certificates entirely,
 * could still trigger issuance, and a Facility Supervisor could issue for a
 * learner in a facility they cannot even read.
 *
 * Two invariants this file exists to hold:
 *
 *   - The learner's own branch stays AHEAD of both new checks. A worker holds no
 *     `certificate.create`, and one with no active facility assignment narrows
 *     to `[]` — either check alone would lock them out of the certificate they
 *     just earned.
 *   - `isAdminRole` stays in the conjunction. This action takes the module's
 *     `resolveSession()`, which falls back to the WORKER auth instance, so a
 *     worker session genuinely reaches the administrative branch.
 */
import { describe, it, expect, vi, beforeEach, assert } from 'vitest';

const {
  mockAdminAuth,
  mockWorkerAuth,
  prismaMock,
  mockUploadFile,
  mockGeneratePdf,
  mockListAccessibleFacilities,
} = vi.hoisted(() => ({
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  prismaMock: {
    enrollment: { findUnique: vi.fn(), findFirst: vi.fn() },
    certificate: { create: vi.fn() },
  },
  mockUploadFile: vi.fn(),
  mockGeneratePdf: vi.fn(),
  mockListAccessibleFacilities: vi.fn(),
}));

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
vi.mock('@/lib/storage', () => ({ uploadFile: mockUploadFile }));
vi.mock('@/lib/certificate-generator', () => ({ generateCertificatePDF: mockGeneratePdf }));
vi.mock('@/lib/facility/scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/facility/scope')>()),
  listAccessibleFacilities: mockListAccessibleFacilities,
}));

import { issueCertificate } from './certificate';

const ORG_ID = 'org-1';
const ENROLLMENT_ID = 'enrollment-abc-123';
const HOLDER_OU = 'ou-holder';
const FACILITY_ID = 'fac-1';

function makeEnrollment(overrides: Record<string, unknown> = {}) {
  return {
    id: ENROLLMENT_ID,
    organizationUserId: HOLDER_OU,
    courseId: 'course-1',
    status: 'completed',
    score: 88,
    certificate: null,
    organizationUser: {
      organizationId: ORG_ID,
      user: { fullName: 'Dana Holder' },
      organization: { name: 'Org One' },
    },
    course: { title: 'Infection Control' },
    ...overrides,
  };
}

function setAdminSession(role: string, organizationUserId = 'ou-viewer') {
  mockAdminAuth.mockResolvedValue({
    user: { id: 'viewer-1', role, organizationId: ORG_ID, organizationUserId },
  });
  mockWorkerAuth.mockResolvedValue(null);
}

function expectNothingIssued() {
  expect(prismaMock.certificate.create).not.toHaveBeenCalled();
  expect(mockGeneratePdf).not.toHaveBeenCalled();
  expect(mockUploadFile).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment());
  // The scoped re-read answers by default; each out-of-scope test overrides it.
  prismaMock.enrollment.findFirst.mockResolvedValue({ id: ENROLLMENT_ID });
  prismaMock.certificate.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'cert-1', ...data }),
  );
  mockUploadFile.mockResolvedValue({ storageUri: 'minio://certs/cert.pdf' });
  mockGeneratePdf.mockResolvedValue(Buffer.from('pdf-bytes'));
  mockListAccessibleFacilities.mockResolvedValue([
    { id: FACILITY_ID, name: 'Facility One', type: null, city: null },
  ]);
});

describe('issueCertificate — roles the CR row grants', () => {
  it.each(['hr', 'clinical_director'] as const)(
    '%s may issue, org-wide and with no facility predicate applied',
    async (role) => {
      setAdminSession(role);

      const result = await issueCertificate(ENROLLMENT_ID);

      assert(result.ok);
      expect(prismaMock.certificate.create).toHaveBeenCalledTimes(1);
      // Org-wide roles resolve to `null`, so the re-read carries the org clause
      // and no facility clause.
      const where = prismaMock.enrollment.findFirst.mock.calls[0][0].where;
      expect(where.organizationUser).toEqual({ organizationId: ORG_ID });
    },
  );

  it('supervisor may issue for a learner inside their facilities, narrowed by the facility predicate', async () => {
    setAdminSession('supervisor');

    const result = await issueCertificate(ENROLLMENT_ID);

    assert(result.ok);
    expect(prismaMock.certificate.create).toHaveBeenCalledTimes(1);
    const where = prismaMock.enrollment.findFirst.mock.calls[0][0].where;
    expect(where.organizationUser).toEqual({
      organizationId: ORG_ID,
      facilities: { some: { facilityId: { in: [FACILITY_ID] }, active: true } },
    });
  });

  it('supervisor is refused for a learner OUTSIDE their facilities', async () => {
    setAdminSession('supervisor');
    // The narrowed re-read is what refuses: the enrollment exists, but not
    // within this caller's facility scope.
    prismaMock.enrollment.findFirst.mockResolvedValue(null);

    await expect(issueCertificate(ENROLLMENT_ID)).rejects.toThrow('Unauthorized');
    expectNothingIssued();
  });

  it('supervisor with no active facility assignment narrows to nothing rather than to everything', async () => {
    setAdminSession('supervisor');
    mockListAccessibleFacilities.mockResolvedValue([]);

    await issueCertificate(ENROLLMENT_ID).catch(() => undefined);

    const where = prismaMock.enrollment.findFirst.mock.calls[0][0].where;
    expect(where.organizationUser).toEqual({
      organizationId: ORG_ID,
      facilities: { some: { facilityId: { in: [] }, active: true } },
    });
  });
});

describe('issueCertificate — roles the CR row withholds', () => {
  it('finance is refused despite passing isAdminRole — founder Q7 removed it from certificates', async () => {
    setAdminSession('finance');

    await expect(issueCertificate(ENROLLMENT_ID)).rejects.toThrow('Unauthorized');
    // Refused on the verb, so the scope query is never reached.
    expect(prismaMock.enrollment.findFirst).not.toHaveBeenCalled();
    expectNothingIssued();
  });

  it('a worker is refused for someone ELSE’s enrollment — certificate.read is not certificate.create', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'w-2', role: 'nurse', organizationId: ORG_ID, organizationUserId: 'ou-other' },
    });

    await expect(issueCertificate(ENROLLMENT_ID)).rejects.toThrow('Unauthorized');
    expect(prismaMock.enrollment.findFirst).not.toHaveBeenCalled();
    expectNothingIssued();
  });

  it('an unknown/stale role claim denies rather than throwing on the lookup', async () => {
    setAdminSession('not_a_real_role');

    await expect(issueCertificate(ENROLLMENT_ID)).rejects.toThrow('Unauthorized');
    expectNothingIssued();
  });
});

describe('issueCertificate — the learner’s own branch is untouched', () => {
  it('a worker still earns their own certificate, holding no certificate.create', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue({
      user: { id: 'w-1', role: 'nurse', organizationId: ORG_ID, organizationUserId: HOLDER_OU },
    });

    const result = await issueCertificate(ENROLLMENT_ID);

    assert(result.ok);
    expect(prismaMock.certificate.create).toHaveBeenCalledTimes(1);
    // Neither new check runs on the self path.
    expect(mockListAccessibleFacilities).not.toHaveBeenCalled();
    expect(prismaMock.enrollment.findFirst).not.toHaveBeenCalled();
  });

  it('a supervisor earning their OWN certificate skips the facility narrowing that would hide it', async () => {
    // A supervisor is facility-bound, so had the self branch not come first this
    // caller's own record would be subject to their own scope resolution.
    setAdminSession('supervisor', HOLDER_OU);
    mockListAccessibleFacilities.mockResolvedValue([]);

    const result = await issueCertificate(ENROLLMENT_ID);

    assert(result.ok);
    expect(prismaMock.enrollment.findFirst).not.toHaveBeenCalled();
  });
});

describe('issueCertificate — preconditions unchanged for an administrative issuer', () => {
  it('still refuses an incomplete course, fail-closed', async () => {
    setAdminSession('hr');
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment({ status: 'in_progress' }));

    const result = await issueCertificate(ENROLLMENT_ID);

    expect(result).toEqual({
      ok: false,
      reason: 'Course must be completed to issue a certificate',
    });
    expectNothingIssued();
  });

  it('is still idempotent — returns the existing certificate without re-generating', async () => {
    setAdminSession('hr');
    const existingCertificate = { id: 'cert-existing', score: 75 };
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeEnrollment({ certificate: existingCertificate }),
    );

    const result = await issueCertificate(ENROLLMENT_ID);

    expect(result).toEqual({ ok: true, certificate: existingCertificate });
    expectNothingIssued();
  });
});
