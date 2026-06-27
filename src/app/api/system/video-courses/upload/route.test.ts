/**
 * Unit tests for POST /api/system/video-courses/upload (Phase-1 abort-cleanup).
 *
 * Covered:
 *   - 401 when auth cookie fails
 *   - 400 missing video field / non-File value / invalid MIME type
 *   - 413 when file exceeds the size limit
 *   - 201 with storageUri when upload resolves and client did NOT abort
 *   - 499 with deleteFile called when client aborted after upload completed
 *   - 499 even when deleteFile rejects (cleanup failure must not bubble)
 *   - 500 when uploadFile itself throws (abort-cleanup never invoked)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ─── Hoisted mock references ──────────────────────────────────────────────────

const {
  mockVerifySystemAdminCookie,
  mockUploadFile,
  mockDeleteFile,
  mockLoggerWarn,
  mockLoggerError,
  mockLoggerInfo,
} = vi.hoisted(() => ({
  mockVerifySystemAdminCookie: vi.fn<() => Promise<boolean>>(),
  mockUploadFile: vi.fn(),
  mockDeleteFile: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
  mockLoggerInfo: vi.fn(),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/system-auth', () => ({
  verifySystemAdminCookie: mockVerifySystemAdminCookie,
}));

vi.mock('@/lib/storage', () => ({
  uploadFile: mockUploadFile,
  deleteFile: mockDeleteFile,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: mockLoggerError,
    debug: vi.fn(),
  },
}));

// ─── Module under test ────────────────────────────────────────────────────────

import { POST } from './route';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STORAGE_URI = 'minio://lms-documents/system/videos/1234-test.mp4';

function makeFile(name = 'test.mp4', type = 'video/mp4', sizeOverride?: number): File {
  const file = new File(['content'], name, { type });
  if (sizeOverride !== undefined) {
    // Shadow the Blob.prototype size getter with an own-property value so we can
    // trigger the size check without allocating hundreds of MB of memory.
    Object.defineProperty(file, 'size', {
      value: sizeOverride,
      configurable: true,
    });
  }
  return file;
}

/**
 * Build a minimal NextRequest stand-in that satisfies the route's duck-typing.
 *
 * The route only touches: req.formData(), req.signal?.aborted.
 * Passing a plain object lets us avoid Next.js request parsing complexity.
 */
function makeReq(opts: {
  formField?: File | null | 'absent' | string; // 'absent' → get() returns null
  aborted?: boolean;
}): NextRequest {
  const { formField, aborted = false } = opts;
  const videoValue =
    formField === 'absent' ? null : formField !== undefined ? formField : makeFile();

  return {
    formData: vi.fn().mockResolvedValue({
      get: (key: string) => (key === 'video' ? videoValue : null),
    }),
    signal: { aborted },
  } as unknown as NextRequest;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySystemAdminCookie.mockResolvedValue(true);
  mockUploadFile.mockResolvedValue({ storageUri: STORAGE_URI, backend: 'minio' });
  mockDeleteFile.mockResolvedValue(undefined);
});

// ─── Auth guard ───────────────────────────────────────────────────────────────

describe('POST /api/system/video-courses/upload — auth', () => {
  it('returns 401 and never calls uploadFile when cookie verification fails', async () => {
    mockVerifySystemAdminCookie.mockResolvedValue(false);
    const res = await POST(makeReq({}));
    expect(res.status).toBe(401);
    expect(mockUploadFile).not.toHaveBeenCalled();
  });
});

// ─── Validation guards ────────────────────────────────────────────────────────

describe('POST /api/system/video-courses/upload — validation', () => {
  it('returns 400 when the video field is absent from the form', async () => {
    const res = await POST(makeReq({ formField: 'absent' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/missing/i);
  });

  it('returns 400 when the video field is not a File instance (plain string)', async () => {
    // FormData.get() returning a string — not a File
    const res = await POST(makeReq({ formField: 'not-a-file-string' }));
    expect(res.status).toBe(400);
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it('returns 400 when the file MIME type is not video/mp4 or video/webm', async () => {
    const res = await POST(makeReq({ formField: makeFile('doc.pdf', 'application/pdf') }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/mp4|webm/i);
    expect(mockUploadFile).not.toHaveBeenCalled();
  });

  it('returns 413 when the file size exceeds MAX_VIDEO_UPLOAD_BYTES (default 500 MB)', async () => {
    const oversized = makeFile('huge.mp4', 'video/mp4', 501 * 1024 * 1024);
    const res = await POST(makeReq({ formField: oversized }));
    expect(res.status).toBe(413);
    expect(mockUploadFile).not.toHaveBeenCalled();
  });
});

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('POST /api/system/video-courses/upload — happy path (client did not abort)', () => {
  it('returns 201 with storageUri when upload resolves and signal is not aborted', async () => {
    const res = await POST(makeReq({ aborted: false }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.storageUri).toBe(STORAGE_URI);
  });

  it('does NOT call deleteFile after a successful non-aborted upload', async () => {
    await POST(makeReq({ aborted: false }));
    // Flush pending microtasks to confirm deleteFile was never scheduled
    await Promise.resolve();
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('forwards the file MIME type to uploadFile', async () => {
    await POST(makeReq({ formField: makeFile('clip.webm', 'video/webm'), aborted: false }));
    expect(mockUploadFile).toHaveBeenCalledWith(
      expect.stringContaining('system/videos/'),
      expect.any(Buffer),
      'video/webm',
    );
  });

  it('uses a key under system/videos/ with the sanitised filename', async () => {
    await POST(makeReq({ formField: makeFile('my file!.mp4', 'video/mp4') }));
    const [key] = mockUploadFile.mock.calls[0] as [string, Buffer, string];
    // 'my file!.mp4' → space→'_', '!'→'_', '.'→'.' → 'my_file_.mp4'
    expect(key).toMatch(/^system\/videos\/\d+-my_file_\.mp4$/);
  });
});

// ─── Abort-cleanup (Phase-1) ──────────────────────────────────────────────────

describe('POST /api/system/video-courses/upload — abort-cleanup', () => {
  it('returns 499 when upload resolves but client signal was aborted', async () => {
    const res = await POST(makeReq({ aborted: true }));
    expect(res.status).toBe(499);
  });

  it('calls deleteFile with the storageUri of the uploaded object when aborted', async () => {
    await POST(makeReq({ aborted: true }));
    // deleteFile is fire-and-forget; allow the microtask to settle
    await Promise.resolve();
    expect(mockDeleteFile).toHaveBeenCalledWith(STORAGE_URI);
  });

  it('still returns 499 when deleteFile rejects — cleanup failure must not bubble', async () => {
    mockDeleteFile.mockRejectedValue(new Error('storage unavailable'));
    const res = await POST(makeReq({ aborted: true }));
    // Allow the rejection handler (.catch) to run
    await Promise.resolve();
    await Promise.resolve();
    expect(res.status).toBe(499);
  });

  it('logs the cleanup failure as an error without rethrowing', async () => {
    mockDeleteFile.mockRejectedValue(new Error('network error'));
    await POST(makeReq({ aborted: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining('failed to delete orphaned upload'),
        storageUri: STORAGE_URI,
      }),
    );
  });
});

// ─── uploadFile throws ────────────────────────────────────────────────────────

describe('POST /api/system/video-courses/upload — uploadFile failure', () => {
  it('returns 500 when uploadFile throws', async () => {
    mockUploadFile.mockRejectedValue(new Error('GCS unreachable'));
    const res = await POST(makeReq({ aborted: false }));
    expect(res.status).toBe(500);
  });

  it('does NOT call deleteFile when uploadFile throws (signal check never reached)', async () => {
    mockUploadFile.mockRejectedValue(new Error('GCS unreachable'));
    // Even with an aborted signal, deleteFile should not be called because the
    // error is caught before reaching the signal check.
    await POST(makeReq({ aborted: true }));
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('returns the error message in the 500 body', async () => {
    mockUploadFile.mockRejectedValue(new Error('disk full'));
    const res = await POST(makeReq({ aborted: false }));
    const body = await res.json();
    expect(body.error).toBe('disk full');
  });
});
