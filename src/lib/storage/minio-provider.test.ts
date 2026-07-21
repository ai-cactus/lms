/**
 * Unit tests for MinIOProvider.list().
 *
 * Covered:
 *   - Stream emits data+end → two items with correct minio:// URIs and createdAt from lastModified
 *   - Nameless prefix entries (no `name` field) are skipped
 *   - Stream emits error → returned Promise rejects
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

const { MockMinioClient, mockBucketExists, mockListObjectsV2, mockLoggerInfo } = vi.hoisted(() => {
  const mockBucketExists = vi.fn<() => Promise<boolean>>();
  const mockListObjectsV2 = vi.fn<() => EventEmitter>();
  const mockLoggerInfo = vi.fn();

  // Must use a regular function (not arrow) so it can be called with `new`.
  const MockMinioClient = vi.fn(function (this: Record<string, unknown>) {
    this.bucketExists = mockBucketExists;
    this.listObjectsV2 = mockListObjectsV2;
  });

  return { MockMinioClient, mockBucketExists, mockListObjectsV2, mockLoggerInfo };
});

vi.mock('minio', () => ({
  Client: MockMinioClient,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { MinIOProvider } from '@/lib/storage/minio-provider';

/** Flush all pending microtasks so async operations inside the module complete. */
const flushMicrotasks = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  // Bucket always exists → ensureBucket completes in one microtask.
  mockBucketExists.mockResolvedValue(true);
});

describe('MinIOProvider.list', () => {
  it('emits two data events then end → returns two items with correct URIs and createdAt', async () => {
    const stream = new EventEmitter();
    mockListObjectsV2.mockReturnValue(stream);

    const provider = new MinIOProvider();
    const promise = provider.list('system/videos/');

    // ensureBucket does an async bucketExists call; wait for it to complete
    // before the stream event handlers are registered.
    await flushMicrotasks();

    const date1 = new Date('2024-01-15T10:00:00Z');
    const date2 = new Date('2024-03-20T08:30:00Z');
    stream.emit('data', { name: 'system/videos/a.mp4', lastModified: date1 });
    stream.emit('data', { name: 'system/videos/b.webm', lastModified: date2 });
    stream.emit('end');

    const result = await promise;

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      storageUri: 'minio://lms-documents/system/videos/a.mp4',
      createdAt: date1,
    });
    expect(result[1]).toEqual({
      storageUri: 'minio://lms-documents/system/videos/b.webm',
      createdAt: date2,
    });
  });

  it('skips nameless prefix entries (objects without a name field)', async () => {
    const stream = new EventEmitter();
    mockListObjectsV2.mockReturnValue(stream);

    const provider = new MinIOProvider();
    const promise = provider.list('system/videos/');

    await flushMicrotasks();

    // Prefix ("directory") entries have no name — should be skipped.
    stream.emit('data', { prefix: 'system/videos/', name: undefined });
    stream.emit('data', { name: 'system/videos/real.mp4', lastModified: new Date('2024-06-01') });
    stream.emit('end');

    const result = await promise;
    expect(result).toHaveLength(1);
    expect(result[0].storageUri).toBe('minio://lms-documents/system/videos/real.mp4');
  });

  it('falls back createdAt to a valid Date when lastModified is absent', async () => {
    const stream = new EventEmitter();
    mockListObjectsV2.mockReturnValue(stream);

    const provider = new MinIOProvider();
    const promise = provider.list('system/videos/');

    await flushMicrotasks();

    stream.emit('data', { name: 'system/videos/no-meta.mp4' }); // no lastModified
    stream.emit('end');

    const result = await promise;
    expect(result).toHaveLength(1);
    expect(result[0].createdAt).toBeInstanceOf(Date);
    expect(isNaN(result[0].createdAt.getTime())).toBe(false);
  });

  it('rejects the returned Promise when the stream emits an error', async () => {
    const stream = new EventEmitter();
    mockListObjectsV2.mockReturnValue(stream);

    const provider = new MinIOProvider();
    const promise = provider.list('system/videos/');

    await flushMicrotasks();

    const boom = new Error('network failure');
    stream.emit('error', boom);

    await expect(promise).rejects.toThrow('network failure');
  });

  it('passes the prefix and recursive=true to listObjectsV2', async () => {
    const stream = new EventEmitter();
    mockListObjectsV2.mockReturnValue(stream);

    const provider = new MinIOProvider();
    const promise = provider.list('system/videos/');

    await flushMicrotasks();
    stream.emit('end');
    await promise;

    // listObjectsV2(bucket, prefix, recursive)
    expect(mockListObjectsV2).toHaveBeenCalledWith('lms-documents', 'system/videos/', true);
  });
});
