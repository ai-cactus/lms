/**
 * The certificate DOWNLOAD path had the widest version of the hole closed in
 * `getCertificateDetails`: its administrative branch was
 *
 *     adminSession?.user?.id &&
 *     adminSession.user.organizationId === certificate.organizationUser.organizationId
 *
 * — org equality and nothing else. Not even `isAdminRole`, let alone a
 * permission or a facility predicate. Any admin-instance session in the
 * organisation could pull any holder's PDF by id, and the served PDF carries
 * more than the detail action does.
 *
 * It now runs the same pair as `getCertificateDetails`:
 * `can(roleKey, 'certificate.read')` plus
 * `staffFacilityWhere(resolveDataFacilityIds(session))`, with the holder's own
 * access resolved first.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAdminAuth,
  mockWorkerAuth,
  mockCertificateFindUnique,
  mockCertificateFindFirst,
  mockDownloadFile,
  mockAudit,
  mockListAccessibleFacilities,
} = vi.hoisted(() => ({
  mockAdminAuth: vi.fn(),
  mockWorkerAuth: vi.fn(),
  mockCertificateFindUnique: vi.fn(),
  mockCertificateFindFirst: vi.fn(),
  mockDownloadFile: vi.fn(),
  mockAudit: vi.fn(),
  mockListAccessibleFacilities: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('@/lib/prisma', () => {
  const prisma = {
    certificate: { findUnique: mockCertificateFindUnique, findFirst: mockCertificateFindFirst },
  };
  return { prisma, default: prisma };
});
vi.mock('@/lib/storage', () => ({ downloadFile: mockDownloadFile }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskEmail: (e: string) => e,
}));
vi.mock('@/lib/audit', () => ({ audit: mockAudit, getClientContext: () => ({}) }));
vi.mock('@/lib/analytics/server', () => ({ captureServer: vi.fn() }));
// isOrgWideFacilityRole stays real so the org-wide vs facility-bound split is genuine.
vi.mock('@/lib/facility/scope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/facility/scope')>()),
  listAccessibleFacilities: mockListAccessibleFacilities,
}));

import { GET } from './route';

const ORG_ID = 'org-1';
const HOLDER_OU = 'ou-holder';
const CERT_ID = 'cert-1';

const params = Promise.resolve({ id: CERT_ID });
const request = new Request('http://localhost/api/certificates/cert-1') as never;

function setAdminSession(role: string, organizationUserId = 'ou-viewer') {
  mockAdminAuth.mockResolvedValue({
    user: { id: 'viewer-1', role, organizationId: ORG_ID, organizationUserId },
  });
  mockWorkerAuth.mockResolvedValue(null);
}

function setWorkerSession(organizationUserId: string) {
  mockAdminAuth.mockResolvedValue(null);
  mockWorkerAuth.mockResolvedValue({
    user: { id: 'w-1', role: 'nurse', organizationId: ORG_ID, organizationUserId },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCertificateFindUnique.mockResolvedValue({
    id: CERT_ID,
    organizationUserId: HOLDER_OU,
    pdfStoragePath: 'certs/cert-1.pdf',
    organizationUser: { organizationId: ORG_ID },
    enrollment: { courseId: 'course-1' },
  });
  mockCertificateFindFirst.mockResolvedValue({ id: CERT_ID });
  mockDownloadFile.mockResolvedValue(Buffer.from('%PDF-1.4'));
  mockListAccessibleFacilities.mockResolvedValue([]);
});

describe('GET /api/certificates/[id] — the holder', () => {
  it('downloads their own certificate with no permission or facility resolution', async () => {
    setWorkerSession(HOLDER_OU);

    const response = await GET(request, { params });

    expect(response.status).toBe(200);
    expect(mockListAccessibleFacilities).not.toHaveBeenCalled();
    expect(mockCertificateFindFirst).not.toHaveBeenCalled();
  });

  it('keeps their own certificate when signed in on the ADMIN instance', async () => {
    // An admin-tier holder downloading their own: previously carried by the
    // blanket org check, so it needs its own branch now that the check is gone.
    setAdminSession('supervisor', HOLDER_OU);
    mockListAccessibleFacilities.mockResolvedValue([]);

    const response = await GET(request, { params });

    expect(response.status).toBe(200);
    expect(mockCertificateFindFirst).not.toHaveBeenCalled();
  });
});

describe('GET /api/certificates/[id] — administrative downloads', () => {
  it('THE FIX: a supervisor is refused a certificate outside their facilities', async () => {
    setAdminSession('supervisor');
    mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-1' }]);
    // What the scoped query genuinely yields for an out-of-facility holder.
    mockCertificateFindFirst.mockResolvedValue(null);

    const response = await GET(request, { params });

    expect(response.status).toBe(403);
    expect(mockDownloadFile).not.toHaveBeenCalled();
  });

  it('narrows the scoped lookup to the caller’s accessible facilities', async () => {
    setAdminSession('supervisor');
    mockListAccessibleFacilities.mockResolvedValue([{ id: 'fac-1' }]);

    await GET(request, { params });

    const where = mockCertificateFindFirst.mock.calls[0][0].where;
    expect(where.id).toBe(CERT_ID);
    expect(where.organizationUser.organizationId).toBe(ORG_ID);
    expect(where.organizationUser.facilities).toEqual({
      some: { facilityId: { in: ['fac-1'] }, active: true },
    });
  });

  it('FAIL-CLOSED: no accessible facilities narrows to `in: []`, never to the whole org', async () => {
    setAdminSession('supervisor');
    mockListAccessibleFacilities.mockResolvedValue([]);

    await GET(request, { params });

    const where = mockCertificateFindFirst.mock.calls[0][0].where;
    expect(where.organizationUser.facilities).toEqual({
      some: { facilityId: { in: [] }, active: true },
    });
  });

  it('an ORG-WIDE role (owner) applies no facility predicate and downloads', async () => {
    setAdminSession('owner');

    const response = await GET(request, { params });

    expect(response.status).toBe(200);
    const where = mockCertificateFindFirst.mock.calls[0][0].where;
    expect(where.organizationUser.facilities).toBeUndefined();
  });

  /**
   * DEFENCE IN DEPTH, and weaker than it looks — `roleKey` here comes from
   * `adminSession`, and the admin instance invalidates any session whose
   * freshly-read role is not an admin role (`auth.ts:6` +
   * `create-auth-instance.ts:736`). The session staged below cannot exist, so
   * this does not prove a reachable attack is refused; what closes the real
   * hole on this route is `certificate.read` plus the facility narrowing,
   * covered above.
   *
   * Kept because every worker role holds `certificate.read` (so a learner can
   * read their own), so the pairing is what would save this route if it ever
   * accepted the worker session too — which its sibling `getCertificateDetails`
   * does, where the same check IS load-bearing.
   */
  it.each(['nurse', 'therapist_clinician', 'front_desk_admin'])(
    '%s would be refused even if the admin instance ever stopped fencing it out',
    async (role) => {
      setAdminSession(role);

      const response = await GET(request, { params });

      expect(response.status).toBe(403);
      expect(mockCertificateFindFirst).not.toHaveBeenCalled();
      expect(mockDownloadFile).not.toHaveBeenCalled();
    },
  );

  it.each(['owner', 'admin', 'supervisor', 'hr', 'clinical_director'])(
    '%s is admitted — founder Q7',
    async (role) => {
      setAdminSession(role);

      expect((await GET(request, { params })).status).toBe(200);
    },
  );

  it('an unknown/stale role key is refused without a scope query', async () => {
    setAdminSession('not_a_real_role');

    const response = await GET(request, { params });

    expect(response.status).toBe(403);
    expect(mockCertificateFindFirst).not.toHaveBeenCalled();
    expect(mockDownloadFile).not.toHaveBeenCalled();
  });

  it('a cross-tenant certificate is refused — the tenant predicate is in the query', async () => {
    setAdminSession('owner');
    mockCertificateFindUnique.mockResolvedValue({
      id: CERT_ID,
      organizationUserId: HOLDER_OU,
      pdfStoragePath: 'certs/cert-1.pdf',
      organizationUser: { organizationId: 'org-2' },
      enrollment: { courseId: 'course-1' },
    });
    mockCertificateFindFirst.mockResolvedValue(null);

    const response = await GET(request, { params });

    expect(response.status).toBe(403);
    expect(mockDownloadFile).not.toHaveBeenCalled();
  });
});

describe('GET /api/certificates/[id] — unchanged behaviour', () => {
  it('401s with no session at all', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(null);

    expect((await GET(request, { params })).status).toBe(401);
  });

  it('404s for a certificate that does not exist', async () => {
    setAdminSession('owner');
    mockCertificateFindUnique.mockResolvedValue(null);

    expect((await GET(request, { params })).status).toBe(404);
  });

  it('404s when the PDF was never generated, after authorization passes', async () => {
    setAdminSession('owner');
    mockCertificateFindUnique.mockResolvedValue({
      id: CERT_ID,
      organizationUserId: HOLDER_OU,
      pdfStoragePath: null,
      organizationUser: { organizationId: ORG_ID },
      enrollment: { courseId: 'course-1' },
    });

    expect((await GET(request, { params })).status).toBe(404);
  });
});

describe('GET /api/certificates/[id] — audit attribution', () => {
  it('records the DB role, not the auth instance it arrived on', async () => {
    setAdminSession('clinical_director');

    await GET(request, { params });

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'certificate.download',
        actorId: 'viewer-1',
        actorRole: 'clinical_director',
      }),
    );
  });

  it('attributes a holder’s own download to the holder', async () => {
    setWorkerSession(HOLDER_OU);

    await GET(request, { params });

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'w-1', actorRole: 'nurse' }),
    );
  });
});
