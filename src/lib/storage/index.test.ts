/**
 * Unit tests for listFiles() and listFilesForActiveBackend() in storage/index.ts.
 *
 * index.ts memoises GCS init behind module-level singletons (_gcs, _gcsInitialised).
 * vi.resetModules() is used before each test to flush those singletons so every
 * test starts from a clean state. All imports of the module under test are
 * therefore dynamic (inside each test body).
 *
 * Covered:
 *   - GCS configured and list() throws → MinIO results are still returned; warn logged
 *   - GCS not configured (constructor throws) → only MinIO results; no extra warn
 *   - listFilesForActiveBackend: GCS active → only GCS listed, MinIO not queried
 *   - listFilesForActiveBackend: GCS unavailable → MinIO listed
 *   - listFilesForActiveBackend: list failure → rethrows (never resolves [])
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StorageListItem } from './types';

const {
  MockGCSProvider,
  mockGCSList,
  MockMinIOProvider,
  mockMinioList,
  mockLoggerWarn,
  mockLoggerInfo,
} = vi.hoisted(() => {
  const mockGCSList = vi.fn<(prefix: string) => Promise<StorageListItem[]>>();
  const mockMinioList = vi.fn<(prefix: string) => Promise<StorageListItem[]>>();
  const mockLoggerWarn = vi.fn();
  const mockLoggerInfo = vi.fn();

  // Constructors must be regular functions (not arrow) to support `new`.
  const MockGCSProvider = vi.fn(function (this: Record<string, unknown>) {
    this.list = mockGCSList;
    this.upload = vi.fn();
    this.getSignedUrl = vi.fn();
    this.delete = vi.fn();
    this.download = vi.fn();
  });

  const MockMinIOProvider = vi.fn(function (this: Record<string, unknown>) {
    this.list = mockMinioList;
    this.upload = vi.fn();
    this.getSignedUrl = vi.fn();
    this.delete = vi.fn();
    this.download = vi.fn();
  });

  return {
    MockGCSProvider,
    mockGCSList,
    MockMinIOProvider,
    mockMinioList,
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

describe('listFiles — GCS configured but list() throws', () => {
  it('returns MinIO results and logs a warning when GCS list fails', async () => {
    // GCS constructor succeeds → _gcs is set.
    MockGCSProvider.mockImplementation(function (this: Record<string, unknown>) {
      this.list = mockGCSList;
    });
    // GCS list throws.
    mockGCSList.mockRejectedValue(new Error('GCS network error'));

    const minioItem: StorageListItem = {
      storageUri: 'minio://lms-documents/system/videos/video.mp4',
      createdAt: new Date('2024-06-01T00:00:00Z'),
    };
    mockMinioList.mockResolvedValue([minioItem]);

    // Dynamic import after resetModules() → fresh module with clean singletons.
    const { listFiles } = await import('@/lib/storage/index');
    const result = await listFiles('system/videos/');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(minioItem);

    // A warning must be logged for the GCS failure.
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining('GCS list failed'),
      }),
    );
  });

  it('combines GCS and MinIO results when both succeed', async () => {
    const gcsItem: StorageListItem = {
      storageUri: 'gcs://my-bucket/system/videos/gcs.mp4',
      createdAt: new Date('2024-01-01'),
    };
    const minioItem: StorageListItem = {
      storageUri: 'minio://lms-documents/system/videos/minio.mp4',
      createdAt: new Date('2024-02-01'),
    };

    MockGCSProvider.mockImplementation(function (this: Record<string, unknown>) {
      this.list = mockGCSList;
    });
    mockGCSList.mockResolvedValue([gcsItem]);
    mockMinioList.mockResolvedValue([minioItem]);

    const { listFiles } = await import('@/lib/storage/index');
    const result = await listFiles('system/videos/');

    expect(result).toHaveLength(2);
    expect(result).toContainEqual(gcsItem);
    expect(result).toContainEqual(minioItem);
  });
});

describe('listFiles — GCS not configured (constructor throws)', () => {
  it('returns only MinIO results when GCS constructor throws', async () => {
    // Simulate GCP_BUCKET_NAME not set: GCSProvider constructor throws.
    MockGCSProvider.mockImplementation(function () {
      throw new Error('GCP_BUCKET_NAME is not configured — GCS provider unavailable');
    });

    const minioItem: StorageListItem = {
      storageUri: 'minio://lms-documents/system/videos/fallback.mp4',
      createdAt: new Date('2024-06-01'),
    };
    mockMinioList.mockResolvedValue([minioItem]);

    const { listFiles } = await import('@/lib/storage/index');
    const result = await listFiles('system/videos/');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(minioItem);
  });

  it('does not log a GCS-list-failed warning when GCS was never configured', async () => {
    MockGCSProvider.mockImplementation(function () {
      throw new Error('GCP_BUCKET_NAME is not configured — GCS provider unavailable');
    });
    mockMinioList.mockResolvedValue([]);

    const { listFiles } = await import('@/lib/storage/index');
    await listFiles('system/videos/');

    // The "GCS list failed" warning belongs to runtime list errors, not to
    // GCS being unconfigured. Only the provider-unavailable warn should appear.
    const warnMessages = mockLoggerWarn.mock.calls.map((call) => (call[0] as { msg: string }).msg);
    expect(warnMessages.every((m) => !m.includes('GCS list failed'))).toBe(true);
  });
});

describe('listFilesForActiveBackend', () => {
  it('lists only GCS when GCS is the active backend — MinIO is never queried', async () => {
    const gcsItem: StorageListItem = {
      storageUri: 'gcs://my-bucket/system/videos/gcs.mp4',
      createdAt: new Date('2024-01-01'),
    };
    MockGCSProvider.mockImplementation(function (this: Record<string, unknown>) {
      this.list = mockGCSList;
    });
    mockGCSList.mockResolvedValue([gcsItem]);
    mockMinioList.mockResolvedValue([
      { storageUri: 'minio://lms-documents/system/videos/minio.mp4', createdAt: new Date() },
    ]);

    const { listFilesForActiveBackend } = await import('@/lib/storage/index');
    const result = await listFilesForActiveBackend('system/videos/');

    expect(result).toEqual([gcsItem]);
    expect(mockMinioList).not.toHaveBeenCalled();
  });

  it('falls back to MinIO when GCS is unavailable (constructor throws)', async () => {
    MockGCSProvider.mockImplementation(function () {
      throw new Error('GCP_BUCKET_NAME is not configured — GCS provider unavailable');
    });
    const minioItem: StorageListItem = {
      storageUri: 'minio://lms-documents/system/videos/fallback.mp4',
      createdAt: new Date('2024-06-01'),
    };
    mockMinioList.mockResolvedValue([minioItem]);

    const { listFilesForActiveBackend } = await import('@/lib/storage/index');
    const result = await listFilesForActiveBackend('system/videos/');

    expect(result).toEqual([minioItem]);
    expect(mockGCSList).not.toHaveBeenCalled();
  });

  it('rethrows when the active backend list() fails — never resolves []', async () => {
    MockGCSProvider.mockImplementation(function (this: Record<string, unknown>) {
      this.list = mockGCSList;
    });
    mockGCSList.mockRejectedValue(new Error('GCS list failed: permission denied'));

    const { listFilesForActiveBackend } = await import('@/lib/storage/index');

    await expect(listFilesForActiveBackend('system/videos/')).rejects.toThrow(
      'GCS list failed: permission denied',
    );
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: expect.stringContaining('Active-backend list failed'),
      }),
    );
  });

  it('rethrows when MinIO (the active backend) list() fails', async () => {
    MockGCSProvider.mockImplementation(function () {
      throw new Error('GCP_BUCKET_NAME is not configured — GCS provider unavailable');
    });
    mockMinioList.mockRejectedValue(new Error('MinIO connection refused'));

    const { listFilesForActiveBackend } = await import('@/lib/storage/index');

    await expect(listFilesForActiveBackend('system/videos/')).rejects.toThrow(
      'MinIO connection refused',
    );
  });
});
