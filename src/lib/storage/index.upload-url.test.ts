/**
 * Unit tests for createUploadUrl() in src/lib/storage/index.ts
 *
 * index.ts memoises GCS init behind module-level singletons (_gcs, _gcsInitialised).
 * vi.resetModules() is used before each test to flush those singletons so every
 * test starts from a clean state. All imports of the module under test are
 * therefore dynamic (inside each test body) — same pattern as index.test.ts.
 *
 * Covered:
 *   - GCS configured and createUploadUrl() succeeds → returns gcs-resumable result
 *   - GCS configured but createUploadUrl() throws → warn logged, MinIO fallback returns minio-put
 *   - GCS not configured (constructor throws) → MinIO fallback returns minio-put (no extra warn)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UploadUrlResult } from './types';

const {
  MockGCSProvider,
  mockGCSCreateUploadUrl,
  MockMinIOProvider,
  mockMinioCreateUploadUrl,
  mockLoggerWarn,
  mockLoggerInfo,
} = vi.hoisted(() => {
  const mockGCSCreateUploadUrl =
    vi.fn<(key: string, contentType: string, expirySeconds?: number) => Promise<UploadUrlResult>>();
  const mockMinioCreateUploadUrl =
    vi.fn<(key: string, contentType: string, expirySeconds?: number) => Promise<UploadUrlResult>>();
  const mockLoggerWarn = vi.fn();
  const mockLoggerInfo = vi.fn();

  // Constructors must be regular functions (not arrow) to support `new`.
  const MockGCSProvider = vi.fn(function (this: Record<string, unknown>) {
    this.createUploadUrl = mockGCSCreateUploadUrl;
    this.upload = vi.fn();
    this.getSignedUrl = vi.fn();
    this.delete = vi.fn();
    this.download = vi.fn();
    this.list = vi.fn();
  });

  const MockMinIOProvider = vi.fn(function (this: Record<string, unknown>) {
    this.createUploadUrl = mockMinioCreateUploadUrl;
    this.upload = vi.fn();
    this.getSignedUrl = vi.fn();
    this.delete = vi.fn();
    this.download = vi.fn();
    this.list = vi.fn();
  });

  return {
    MockGCSProvider,
    mockGCSCreateUploadUrl,
    MockMinIOProvider,
    mockMinioCreateUploadUrl,
    mockLoggerWarn,
    mockLoggerInfo,
  };
});

vi.mock('@/lib/storage/gcs-provider', () => ({
  GCSProvider: MockGCSProvider,
}));

vi.mock('@/lib/storage/minio-provider', () => ({
  MinIOProvider: MockMinIOProvider,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: mockLoggerWarn,
    info: mockLoggerInfo,
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Flush the module registry so index.ts's _gcs / _gcsInitialised singletons reset.
  vi.resetModules();
});

describe('createUploadUrl — GCS configured and succeeds', () => {
  it('returns the gcs-resumable result when GCS createUploadUrl resolves', async () => {
    const gcsResult: UploadUrlResult = {
      uploadUrl: 'https://storage.googleapis.com/signed?X-Goog-Signature=abc',
      storageUri: 'gcs://my-bucket/system/videos/ts-test.mp4',
      kind: 'gcs-resumable',
    };
    mockGCSCreateUploadUrl.mockResolvedValue(gcsResult);

    // Dynamic import after resetModules() → fresh module with clean singletons.
    const { createUploadUrl } = await import('@/lib/storage/index');
    const result = await createUploadUrl('system/videos/ts-test.mp4', 'video/mp4');

    expect(result.kind).toBe('gcs-resumable');
    expect(result.uploadUrl).toBe(gcsResult.uploadUrl);
    expect(result.storageUri).toBe(gcsResult.storageUri);

    // GCS provider was called; MinIO was not.
    expect(mockGCSCreateUploadUrl).toHaveBeenCalledOnce();
    expect(mockGCSCreateUploadUrl).toHaveBeenCalledWith(
      'system/videos/ts-test.mp4',
      'video/mp4',
      900, // default expirySeconds
    );
    expect(mockMinioCreateUploadUrl).not.toHaveBeenCalled();
  });

  it('passes a custom expirySeconds through to the GCS provider', async () => {
    const gcsResult: UploadUrlResult = {
      uploadUrl: 'https://storage.googleapis.com/signed',
      storageUri: 'gcs://bucket/key',
      kind: 'gcs-resumable',
    };
    mockGCSCreateUploadUrl.mockResolvedValue(gcsResult);

    const { createUploadUrl } = await import('@/lib/storage/index');
    await createUploadUrl('key', 'video/webm', 1800);

    expect(mockGCSCreateUploadUrl).toHaveBeenCalledWith('key', 'video/webm', 1800);
  });
});

describe('createUploadUrl — GCS configured but createUploadUrl throws', () => {
  it('logs a warning and falls back to MinIO when GCS createUploadUrl throws', async () => {
    mockGCSCreateUploadUrl.mockRejectedValue(new Error('GCS signing key expired'));

    const minioResult: UploadUrlResult = {
      uploadUrl: 'http://minio:9000/bucket/key?X-Amz-Signature=xyz',
      storageUri: 'minio://lms-documents/system/videos/ts-test.mp4',
      kind: 'minio-put',
    };
    mockMinioCreateUploadUrl.mockResolvedValue(minioResult);

    const { createUploadUrl } = await import('@/lib/storage/index');
    const result = await createUploadUrl('system/videos/ts-test.mp4', 'video/mp4');

    // Returned result must be the MinIO one.
    expect(result.kind).toBe('minio-put');
    expect(result.storageUri).toMatch(/^minio:\/\//);

    // A warn must be logged for the GCS failure.
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining('GCS createUploadUrl failed'),
      }),
    );

    // MinIO was used as the fallback.
    expect(mockMinioCreateUploadUrl).toHaveBeenCalledOnce();
  });
});

describe('createUploadUrl — GCS not configured (constructor throws)', () => {
  it('returns minio-put result when GCS constructor throws (GCP_BUCKET_NAME unset)', async () => {
    // Simulate GCSProvider constructor throwing — the same as GCP_BUCKET_NAME not set.
    MockGCSProvider.mockImplementation(function () {
      throw new Error('GCP_BUCKET_NAME is not configured — GCS provider unavailable');
    });

    const minioResult: UploadUrlResult = {
      uploadUrl: 'http://minio:9000/bucket/key',
      storageUri: 'minio://lms-documents/system/videos/key',
      kind: 'minio-put',
    };
    mockMinioCreateUploadUrl.mockResolvedValue(minioResult);

    const { createUploadUrl } = await import('@/lib/storage/index');
    const result = await createUploadUrl('system/videos/key', 'video/mp4');

    expect(result.kind).toBe('minio-put');
    expect(mockMinioCreateUploadUrl).toHaveBeenCalledOnce();
    expect(mockGCSCreateUploadUrl).not.toHaveBeenCalled();
  });

  it('does not log a "GCS createUploadUrl failed" warning when GCS was never configured', async () => {
    MockGCSProvider.mockImplementation(function () {
      throw new Error('GCP_BUCKET_NAME is not configured — GCS provider unavailable');
    });

    const minioResult: UploadUrlResult = {
      uploadUrl: 'http://minio:9000/bucket/key',
      storageUri: 'minio://lms-documents/system/videos/key',
      kind: 'minio-put',
    };
    mockMinioCreateUploadUrl.mockResolvedValue(minioResult);

    const { createUploadUrl } = await import('@/lib/storage/index');
    await createUploadUrl('system/videos/key', 'video/mp4');

    // "GCS createUploadUrl failed" warn belongs to runtime createUploadUrl errors,
    // not to GCS being unconfigured at startup.
    const warnMessages = mockLoggerWarn.mock.calls.map((call) => (call[0] as { msg: string }).msg);
    expect(warnMessages.every((m) => !m.includes('GCS createUploadUrl failed'))).toBe(true);
  });
});
