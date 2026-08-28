/**
 * F-039 regression test for issueCertificate's score fallback.
 *
 * Bug: `score: enrollment.score || 100` silently promoted a genuine 0% score
 * (a falsy number) to 100 on the issued certificate — a truthful 0 is a real,
 * important outcome (e.g. an auto-failed/zeroed attempt) and must never be
 * displayed as a perfect score. Fixed to `score: enrollment.score ?? 100`,
 * which only falls back on null/undefined (no score recorded at all).
 */

import { describe, it, expect, vi, beforeEach, assert } from 'vitest';

const { mockAdminAuth, mockWorkerAuth, prismaMock, mockUploadFile, mockGeneratePdf } = vi.hoisted(
  () => ({
    mockAdminAuth: vi.fn(),
    mockWorkerAuth: vi.fn(),
    prismaMock: {
      enrollment: { findUnique: vi.fn() },
      certificate: { create: vi.fn() },
    },
    mockUploadFile: vi.fn(),
    mockGeneratePdf: vi.fn(),
  }),
);

vi.mock('@/auth', () => ({ auth: mockAdminAuth }));
vi.mock('@/auth.worker', () => ({ auth: mockWorkerAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
// F-001 audit is a best-effort side-channel — stub it so business-logic tests
// don't depend on the audit sink or the request-scoped headers() it reads.
vi.mock('@/lib/audit', () => ({ audit: vi.fn(), getClientContext: () => ({}) }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/storage', () => ({ uploadFile: mockUploadFile }));
vi.mock('@/lib/certificate-generator', () => ({ generateCertificatePDF: mockGeneratePdf }));
// formatCertificateId is pure/cheap — use the real implementation.

import { issueCertificate } from './certificate';

const WORKER_ID = 'worker-1';
const ENROLLMENT_ID = 'enrollment-abc-123';

const ORG_USER_ID = 'ou-1';

function makeEnrollment(score: number | null | undefined, overrides: Record<string, unknown> = {}) {
  return {
    id: ENROLLMENT_ID,
    organizationUserId: ORG_USER_ID,
    courseId: 'course-1',
    status: 'completed',
    score,
    certificate: null,
    organizationUser: {
      organizationId: 'org-1',
      user: { fullName: 'Jane Worker' },
      organization: { name: 'Acme Co' },
    },
    course: { title: 'Safety 101' },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Worker issuing their own certificate — resolveSession() checks admin first,
  // then worker; admin auth resolves null so the worker session is used.
  mockAdminAuth.mockResolvedValue(null);
  mockWorkerAuth.mockResolvedValue({
    user: {
      id: WORKER_ID,
      role: 'worker',
      organizationUserId: ORG_USER_ID,
      organizationId: 'org-1',
    },
  });
  mockUploadFile.mockResolvedValue({ storageUri: 'minio://certs/cert.pdf' });
  mockGeneratePdf.mockResolvedValue(Buffer.from('pdf-bytes'));
  prismaMock.certificate.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'cert-1', ...data }),
  );
});

describe('issueCertificate — score fallback (F-039)', () => {
  it('preserves a genuine 0% score instead of defaulting it to 100', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment(0));

    const result = await issueCertificate(ENROLLMENT_ID);
    assert(result.ok);
    const certificate = result.certificate;

    expect(certificate.score).toBe(0);
    const createCall = prismaMock.certificate.create.mock.calls[0][0];
    expect(createCall.data.score).toBe(0);
  });

  it('defaults to 100 when no score was ever recorded (null)', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment(null));

    const result = await issueCertificate(ENROLLMENT_ID);
    assert(result.ok);
    const certificate = result.certificate;

    expect(certificate.score).toBe(100);
  });

  it('defaults to 100 when no score was ever recorded (undefined)', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment(undefined));

    const result = await issueCertificate(ENROLLMENT_ID);
    assert(result.ok);
    const certificate = result.certificate;

    expect(certificate.score).toBe(100);
  });

  it('preserves a genuine, non-zero score unchanged', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment(87));

    const result = await issueCertificate(ENROLLMENT_ID);
    assert(result.ok);
    const certificate = result.certificate;

    expect(certificate.score).toBe(87);
  });
});

/**
 * fix/server-action-error-messages: issueCertificate's refusals are returned
 * as `{ ok: false, reason }` instead of thrown, so the reason survives
 * Next.js's production redaction of Server Action errors. Both refusal paths
 * must be fail-closed — no certificate row, no PDF generation, no upload.
 */
describe('issueCertificate — refusals are returned, not thrown, and fail-closed', () => {
  it('refuses when the course is not completed or attested', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeEnrollment(50, { status: 'in_progress' }),
    );

    const result = await issueCertificate(ENROLLMENT_ID);

    expect(result).toEqual({
      ok: false,
      reason: 'Course must be completed to issue a certificate',
    });
    expect(prismaMock.certificate.create).not.toHaveBeenCalled();
    expect(mockGeneratePdf).not.toHaveBeenCalled();
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it('refuses when the recipient has no full name on their profile', async () => {
    const enrollment = makeEnrollment(90);
    enrollment.organizationUser.user.fullName = '   ';
    prismaMock.enrollment.findUnique.mockResolvedValue(enrollment);

    const result = await issueCertificate(ENROLLMENT_ID);

    expect(result).toEqual({
      ok: false,
      reason: 'Set your full name in your profile before earning a certificate.',
    });
    expect(prismaMock.certificate.create).not.toHaveBeenCalled();
    expect(mockGeneratePdf).not.toHaveBeenCalled();
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it('refuses when fullName is null on the profile', async () => {
    const enrollment = makeEnrollment(90);
    enrollment.organizationUser.user.fullName = null as unknown as string;
    prismaMock.enrollment.findUnique.mockResolvedValue(enrollment);

    const result = await issueCertificate(ENROLLMENT_ID);

    expect(result).toEqual({
      ok: false,
      reason: 'Set your full name in your profile before earning a certificate.',
    });
    expect(prismaMock.certificate.create).not.toHaveBeenCalled();
  });

  it('returns the existing certificate as ok:true without re-generating a PDF (idempotent)', async () => {
    const existingCertificate = { id: 'cert-existing', score: 75 };
    prismaMock.enrollment.findUnique.mockResolvedValue({
      ...makeEnrollment(75),
      certificate: existingCertificate,
    });

    const result = await issueCertificate(ENROLLMENT_ID);

    expect(result).toEqual({ ok: true, certificate: existingCertificate });
    expect(prismaMock.certificate.create).not.toHaveBeenCalled();
    expect(mockGeneratePdf).not.toHaveBeenCalled();
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it('generic guards still throw — Unauthorized when neither session resolves', async () => {
    mockAdminAuth.mockResolvedValue(null);
    mockWorkerAuth.mockResolvedValue(null);

    await expect(issueCertificate(ENROLLMENT_ID)).rejects.toThrow('Unauthorized');
    expect(prismaMock.enrollment.findUnique).not.toHaveBeenCalled();
  });

  it('generic guards still throw — Unauthorized for a caller who is neither the learner nor an admin in the org', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(makeEnrollment(90));
    mockWorkerAuth.mockResolvedValue({
      user: {
        id: 'other-worker',
        role: 'worker',
        organizationUserId: 'ou-someone-else',
        organizationId: 'org-1',
      },
    });

    await expect(issueCertificate(ENROLLMENT_ID)).rejects.toThrow('Unauthorized');
    expect(prismaMock.certificate.create).not.toHaveBeenCalled();
  });
});
