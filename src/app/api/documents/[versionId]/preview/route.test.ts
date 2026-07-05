/**
 * F-048 regression test for GET /api/documents/[versionId]/preview.
 *
 * Bug: on any exception while proxying the document (e.g. a storage-layer
 * network error), the route responded with `Error proxying document:
 * ${err.message}` — leaking raw internal error text (potentially storage
 * paths, provider errors, etc.) directly to the client. Fixed to log the
 * real error server-side via the structured logger and return a generic,
 * non-sensitive message to the caller.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, prismaMock, mockGetDocumentSignedUrl, mockLoggerError } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  prismaMock: { documentVersion: { findUnique: vi.fn() } },
  mockGetDocumentSignedUrl: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock('@/app/actions/storage', () => ({ getDocumentSignedUrl: mockGetDocumentSignedUrl }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: mockLoggerError, debug: vi.fn() },
}));

import { GET } from './route';

const USER_ID = 'user-1';
const VERSION_ID = 'version-1';
const params = Promise.resolve({ versionId: VERSION_ID });
const makeReq = () => new Request(`http://localhost/api/documents/${VERSION_ID}/preview`);

const SENSITIVE_ERROR_MESSAGE =
  'ECONNREFUSED connecting to internal-storage-host:9000 bucket=lms-documents-prod';

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: USER_ID } });
  prismaMock.documentVersion.findUnique.mockResolvedValue({
    document: { userId: USER_ID, filename: 'report.pdf', mimeType: 'application/pdf' },
  });
  mockGetDocumentSignedUrl.mockResolvedValue({ url: 'https://storage.example.com/signed' });
});

describe('GET /api/documents/[versionId]/preview — sanitized failure response (F-048)', () => {
  it('returns a generic message and never leaks the raw error text when the proxy fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error(SENSITIVE_ERROR_MESSAGE)));

    const res = await GET(makeReq(), { params });
    const body = await res.text();

    expect(res.status).toBe(500);
    expect(body).toBe('Error retrieving document');
    expect(body).not.toContain(SENSITIVE_ERROR_MESSAGE);
    expect(body).not.toContain('ECONNREFUSED');

    vi.unstubAllGlobals();
  });

  it('still logs the real error server-side via the structured logger', async () => {
    const realError = new Error(SENSITIVE_ERROR_MESSAGE);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(realError));

    await GET(makeReq(), { params });

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: '[doc] preview proxy failed',
        err: realError,
        versionId: VERSION_ID,
      }),
    );

    vi.unstubAllGlobals();
  });

  it('401s when there is no session (unrelated to the fix, kept as a guard)', async () => {
    mockAuth.mockResolvedValue(null);

    const res = await GET(makeReq(), { params });

    expect(res.status).toBe(401);
  });
});
