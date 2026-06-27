/**
 * Unit tests for POST /api/system/video-courses/upload-url
 *
 * Covered:
 *   Auth
 *     - 401 when cookie verification fails
 *   Validation
 *     - 400 when request body is not valid JSON
 *     - 400 when filename is missing or blank
 *     - 400 when contentType is missing
 *     - 400 when size is not a positive number (zero, negative, string)
 *     - 400 "Video must be MP4 or WebM" for disallowed contentType
 *     - 413 when size exceeds MAX_VIDEO_BYTES
 *   Filename sanitisation
 *     - Path-traversal characters in filename do not produce slashes in the key
 *   Happy path
 *     - 200 with uploadUrl, storageUri, kind when storage facade returns gcs-resumable
 *   GCS unavailable
 *     - 503 GCS_UNAVAILABLE when storage facade returns minio-put
 *   Unexpected error
 *     - 500 when createUploadUrl throws
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ─── Hoisted mock references ──────────────────────────────────────────────────

const {
  mockVerifySystemAdminCookie,
  mockCreateUploadUrl,
  mockLoggerInfo,
  mockLoggerWarn,
  mockLoggerError,
} = vi.hoisted(() => ({
  mockVerifySystemAdminCookie: vi.fn<() => Promise<boolean>>(),
  mockCreateUploadUrl: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/system-auth', () => ({
  verifySystemAdminCookie: mockVerifySystemAdminCookie,
}));

vi.mock('@/lib/storage', () => ({
  createUploadUrl: mockCreateUploadUrl,
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_UPLOAD_URL = 'https://storage.googleapis.com/signed/upload?X-Goog-Signature=abc';
const DEFAULT_STORAGE_URI = 'gcs://my-bucket/system/videos/1234567890-test.mp4';

function gcsResult() {
  return {
    uploadUrl: DEFAULT_UPLOAD_URL,
    storageUri: DEFAULT_STORAGE_URI,
    kind: 'gcs-resumable' as const,
  };
}

function minioResult() {
  return {
    uploadUrl: 'http://minio:9000/bucket/key?X-Amz-Signature=xyz',
    storageUri: 'minio://lms-documents/system/videos/1234-test.mp4',
    kind: 'minio-put' as const,
  };
}

/**
 * Build a minimal NextRequest that satisfies the route's duck-typing.
 * The route only calls req.json() (wrapped in .catch(() => null)).
 */
function makeReq(body: unknown, opts: { throwJson?: boolean } = {}): NextRequest {
  return {
    json: opts.throwJson
      ? vi.fn().mockRejectedValue(new SyntaxError('Unexpected token'))
      : vi.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockVerifySystemAdminCookie.mockResolvedValue(true);
  mockCreateUploadUrl.mockResolvedValue(gcsResult());
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

describe('POST /api/system/video-courses/upload-url — auth', () => {
  it('returns 401 and does not call createUploadUrl when the cookie check fails', async () => {
    mockVerifySystemAdminCookie.mockResolvedValue(false);

    const res = await POST(
      makeReq({ filename: 'video.mp4', contentType: 'video/mp4', size: 1024 }),
    );

    expect(res.status).toBe(401);
    expect(mockCreateUploadUrl).not.toHaveBeenCalled();
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe('POST /api/system/video-courses/upload-url — validation', () => {
  it('returns 400 when the request body is not parseable JSON', async () => {
    const res = await POST(makeReq(undefined, { throwJson: true }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/json object/i);
  });

  it('returns 400 when the request body is null', async () => {
    const res = await POST(makeReq(null));
    expect(res.status).toBe(400);
  });

  it('returns 400 when filename is absent', async () => {
    const res = await POST(makeReq({ contentType: 'video/mp4', size: 1024 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/filename/i);
  });

  it('returns 400 when filename is a blank string', async () => {
    const res = await POST(makeReq({ filename: '   ', contentType: 'video/mp4', size: 1024 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/filename/i);
  });

  it('returns 400 when contentType is absent', async () => {
    const res = await POST(makeReq({ filename: 'video.mp4', size: 1024 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/contentType/i);
  });

  it('returns 400 when size is zero', async () => {
    const res = await POST(makeReq({ filename: 'video.mp4', contentType: 'video/mp4', size: 0 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/size/i);
  });

  it('returns 400 when size is a negative number', async () => {
    const res = await POST(makeReq({ filename: 'video.mp4', contentType: 'video/mp4', size: -1 }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when size is a non-numeric string', async () => {
    const res = await POST(
      makeReq({ filename: 'video.mp4', contentType: 'video/mp4', size: 'big' }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 with "Video must be MP4 or WebM" for an unsupported contentType', async () => {
    const res = await POST(
      makeReq({ filename: 'doc.pdf', contentType: 'application/pdf', size: 1024 }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Video must be MP4 or WebM');
    expect(mockCreateUploadUrl).not.toHaveBeenCalled();
  });

  it('returns 400 for video/avi (not in the allowed set)', async () => {
    const res = await POST(makeReq({ filename: 'clip.avi', contentType: 'video/avi', size: 1024 }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Video must be MP4 or WebM');
  });

  it('returns 413 when size exceeds the MAX_VIDEO_BYTES limit (default 500 MiB)', async () => {
    const oversizeBytes = 500 * 1024 * 1024 + 1;
    const res = await POST(
      makeReq({ filename: 'huge.mp4', contentType: 'video/mp4', size: oversizeBytes }),
    );
    expect(res.status).toBe(413);
    expect(mockCreateUploadUrl).not.toHaveBeenCalled();
  });
});

// ─── Filename sanitisation ────────────────────────────────────────────────────

describe('POST /api/system/video-courses/upload-url — filename sanitisation', () => {
  it('strips path-traversal slashes from the filename so the storage key cannot escape system/videos/', async () => {
    const res = await POST(
      makeReq({ filename: '../../etc/passwd', contentType: 'video/mp4', size: 1024 }),
    );
    expect(res.status).toBe(200);

    const [key] = mockCreateUploadUrl.mock.calls[0] as [string, string];

    // Key must start with the expected prefix.
    expect(key).toMatch(/^system\/videos\//);

    // The filename portion (after timestamp) must contain no raw slashes.
    const filenamePart = key.replace(/^system\/videos\/\d+-/, '');
    expect(filenamePart).not.toContain('/');
  });

  it('replaces spaces and special chars with underscores', async () => {
    const res = await POST(
      makeReq({ filename: 'my file!@#.mp4', contentType: 'video/mp4', size: 1024 }),
    );
    expect(res.status).toBe(200);

    const [key] = mockCreateUploadUrl.mock.calls[0] as [string, string];
    const filenamePart = key.replace(/^system\/videos\/\d+-/, '');
    // Only alphanumerics, dots, hyphens, underscores should remain.
    expect(filenamePart).toMatch(/^[a-zA-Z0-9._-]+$/);
  });

  it('places the sanitised filename under system/videos/ with a timestamp prefix', async () => {
    await POST(makeReq({ filename: 'lecture.webm', contentType: 'video/webm', size: 1024 }));

    const [key] = mockCreateUploadUrl.mock.calls[0] as [string, string];
    expect(key).toMatch(/^system\/videos\/\d+-lecture\.webm$/);
  });
});

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('POST /api/system/video-courses/upload-url — happy path', () => {
  it('returns 200 with uploadUrl, storageUri, and kind when facade returns gcs-resumable', async () => {
    const res = await POST(
      makeReq({ filename: 'video.mp4', contentType: 'video/mp4', size: 1024 }),
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.uploadUrl).toBe(DEFAULT_UPLOAD_URL);
    expect(body.storageUri).toBe(DEFAULT_STORAGE_URI);
    expect(body.kind).toBe('gcs-resumable');
  });

  it('forwards the correct contentType to createUploadUrl', async () => {
    await POST(makeReq({ filename: 'clip.webm', contentType: 'video/webm', size: 2048 }));

    expect(mockCreateUploadUrl).toHaveBeenCalledWith(
      expect.stringContaining('system/videos/'),
      'video/webm',
    );
  });

  it('accepts video/webm as a valid contentType', async () => {
    const res = await POST(
      makeReq({ filename: 'clip.webm', contentType: 'video/webm', size: 1024 }),
    );
    expect(res.status).toBe(200);
  });
});

// ─── GCS unavailable ─────────────────────────────────────────────────────────

describe('POST /api/system/video-courses/upload-url — GCS unavailable', () => {
  it('returns 503 with error GCS_UNAVAILABLE when the facade yields minio-put', async () => {
    mockCreateUploadUrl.mockResolvedValue(minioResult());

    const res = await POST(
      makeReq({ filename: 'video.mp4', contentType: 'video/mp4', size: 1024 }),
    );
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.error).toBe('GCS_UNAVAILABLE');
  });

  it('logs a warning when falling back to minio-put', async () => {
    mockCreateUploadUrl.mockResolvedValue(minioResult());
    await POST(makeReq({ filename: 'video.mp4', contentType: 'video/mp4', size: 1024 }));

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringContaining('proxy fallback') }),
    );
  });

  it('does not expose the internal minio uploadUrl in the 503 response', async () => {
    mockCreateUploadUrl.mockResolvedValue(minioResult());

    const res = await POST(
      makeReq({ filename: 'video.mp4', contentType: 'video/mp4', size: 1024 }),
    );
    const body = await res.json();

    // The minio URL must never reach the browser.
    expect(body.uploadUrl).toBeUndefined();
    expect(body.storageUri).toBeUndefined();
  });
});

// ─── Unexpected error ─────────────────────────────────────────────────────────

describe('POST /api/system/video-courses/upload-url — createUploadUrl throws', () => {
  it('returns 500 when createUploadUrl rejects', async () => {
    mockCreateUploadUrl.mockRejectedValue(new Error('storage backend unreachable'));

    const res = await POST(
      makeReq({ filename: 'video.mp4', contentType: 'video/mp4', size: 1024 }),
    );
    expect(res.status).toBe(500);
  });

  it('logs the error when createUploadUrl rejects', async () => {
    mockCreateUploadUrl.mockRejectedValue(new Error('storage backend unreachable'));
    await POST(makeReq({ filename: 'video.mp4', contentType: 'video/mp4', size: 1024 }));

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringContaining('upload-url error') }),
    );
  });
});
