/**
 * Unit tests for src/app/actions/onboarding-documents.ts —
 * uploadOnboardingDocument() / deleteOnboardingDocument()
 *
 * Step 2 of the onboarding wizard runs before the org/facility exists, so
 * uploads are parked under a per-user `onboarding/{userId}/` storage prefix.
 * The highest-risk behavior here is `deleteOnboardingDocument`'s tenancy
 * fence: it must reject any storageUri whose key does not sit under the
 * CALLER's own prefix, so one user can never delete another user's (or
 * another tenant's) parked upload by supplying an arbitrary storageUri.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, mockUploadFile, mockDeleteFile } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockUploadFile: vi.fn(),
  mockDeleteFile: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage')>();
  return {
    ...actual,
    uploadFile: mockUploadFile,
    deleteFile: mockDeleteFile,
  };
});
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { uploadOnboardingDocument, deleteOnboardingDocument } from './onboarding-documents';

function makeFormDataWithFile(
  name: string,
  content: string,
  mimeType = 'application/pdf',
): FormData {
  const formData = new FormData();
  const file = new File([content], name, { type: mimeType });
  formData.set('file', file);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
});

describe('uploadOnboardingDocument', () => {
  it('rejects when there is no authenticated session', async () => {
    mockAuth.mockResolvedValue(null);

    const result = await uploadOnboardingDocument(makeFormDataWithFile('cert.pdf', 'data'));

    expect(result.success).toBe(false);
    expect(result).toMatchObject({ error: 'Not authenticated' });
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it('rejects when no file is provided', async () => {
    const result = await uploadOnboardingDocument(new FormData());

    expect(result.success).toBe(false);
    expect(result).toMatchObject({ error: 'No file provided' });
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it('rejects a file over the 10MB cap without calling storage', async () => {
    const oversized = 'x'.repeat(10 * 1024 * 1024 + 1);
    const result = await uploadOnboardingDocument(makeFormDataWithFile('big.pdf', oversized));

    expect(result.success).toBe(false);
    expect(result).toMatchObject({ error: 'File size too large. Max 10MB.' });
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it('uploads under the caller-scoped onboarding/{userId}/ key prefix', async () => {
    mockUploadFile.mockResolvedValue({ storageUri: 'gcs://bucket/onboarding/user-1/123-cert.pdf' });

    const result = await uploadOnboardingDocument(makeFormDataWithFile('cert.pdf', 'contents'));

    expect(result.success).toBe(true);
    expect(mockUploadFile).toHaveBeenCalledTimes(1);
    const [key, , mimeType] = mockUploadFile.mock.calls[0];
    expect(key).toMatch(/^onboarding\/user-1\/\d+-cert\.pdf$/);
    expect(mimeType).toBe('application/pdf');
    if (result.success) {
      expect(result.document).toMatchObject({
        url: 'gcs://bucket/onboarding/user-1/123-cert.pdf',
        name: 'cert.pdf',
      });
    }
  });

  it('strips slashes from the file name so it cannot inject extra path segments into the storage key', async () => {
    mockUploadFile.mockResolvedValue({ storageUri: 'gcs://bucket/onboarding/user-1/x' });

    await uploadOnboardingDocument(makeFormDataWithFile('../../etc/passwd.pdf', 'contents'));

    const [key] = mockUploadFile.mock.calls[0];
    // '/' is not in the sanitizer's allow-list (`[^a-z0-9.]` -> '_'), so a
    // filename can never introduce a new path segment — the object always
    // lands as a single opaque key directly under the caller's own prefix.
    // (Literal '.' characters, including a stray "..", are preserved but are
    // inert here: cloud object-storage keys are flat strings with no
    // directory resolution, so they can't be used to escape the prefix.)
    expect(key.split('/')).toHaveLength(3); // onboarding / userId / sanitized-filename
    expect(key.startsWith('onboarding/user-1/')).toBe(true);
  });

  it('returns a generic error and does not throw when the storage upload fails', async () => {
    mockUploadFile.mockRejectedValue(new Error('GCS unavailable'));

    const result = await uploadOnboardingDocument(makeFormDataWithFile('cert.pdf', 'contents'));

    expect(result.success).toBe(false);
    expect(result).toMatchObject({ error: 'Failed to upload document' });
  });
});

describe('deleteOnboardingDocument — tenancy fence', () => {
  it('rejects when there is no authenticated session', async () => {
    mockAuth.mockResolvedValue(null);

    const result = await deleteOnboardingDocument('gcs://bucket/onboarding/user-1/cert.pdf');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Not authenticated');
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('deletes a document under the caller"s own onboarding prefix', async () => {
    mockDeleteFile.mockResolvedValue(undefined);

    const result = await deleteOnboardingDocument('gcs://bucket/onboarding/user-1/123-cert.pdf');

    expect(result.success).toBe(true);
    expect(mockDeleteFile).toHaveBeenCalledWith('gcs://bucket/onboarding/user-1/123-cert.pdf');
  });

  it("rejects deletion of a document under a DIFFERENT user's onboarding prefix (path-traversal / tenancy attempt)", async () => {
    const result = await deleteOnboardingDocument(
      'gcs://bucket/onboarding/some-other-user-id/secret.pdf',
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unauthorized');
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it("rejects a prefix-confusion attempt where another user id merely starts with the caller's id", async () => {
    // Caller is 'user-1'; a naive prefix check without a trailing separator
    // would wrongly accept 'user-10' as a match for 'user-1'.
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

    const result = await deleteOnboardingDocument('gcs://bucket/onboarding/user-10/secret.pdf');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unauthorized');
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('rejects a storage URI outside the onboarding/ prefix entirely (e.g. a facility document)', async () => {
    const result = await deleteOnboardingDocument('gcs://bucket/facilities/facility-1/license.pdf');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Unauthorized');
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('returns a generic error and does not throw when the storage delete fails', async () => {
    mockDeleteFile.mockRejectedValue(new Error('GCS unavailable'));

    const result = await deleteOnboardingDocument('gcs://bucket/onboarding/user-1/cert.pdf');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Failed to delete document');
  });
});
