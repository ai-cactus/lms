// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDeleteFile, mockListFiles, mockListActive, mockLogger } = vi.hoisted(() => ({
  mockDeleteFile: vi.fn(),
  mockListFiles: vi.fn(),
  mockListActive: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/storage', () => ({
  deleteFile: mockDeleteFile,
  listFiles: mockListFiles,
  listFilesForActiveBackend: mockListActive,
}));
vi.mock('@/lib/logger', () => ({ logger: mockLogger, maskEmail: (e: string) => e }));

import { deleteStorageObjects } from './cleanup';

const CONTEXT = { module: '[system]', ids: { userId: 'u1' } };

beforeEach(() => {
  vi.clearAllMocks();
  mockDeleteFile.mockResolvedValue(undefined);
});

describe('deleteStorageObjects', () => {
  it('deletes each exact URI once, collapsing duplicates and dropping empty strings', async () => {
    const result = await deleteStorageObjects(
      ['gcs://b/certs/a.pdf', 'gcs://b/certs/a.pdf', '', 'minio://b/certs/b.pdf'],
      CONTEXT,
    );

    expect(mockDeleteFile.mock.calls).toEqual([['gcs://b/certs/a.pdf'], ['minio://b/certs/b.pdf']]);
    expect(result).toEqual({ attempted: 2, failed: [] });
  });

  it('isolates a failing delete: the rest still run and the failed URI is reported', async () => {
    mockDeleteFile.mockImplementation(async (uri: string) => {
      if (uri === 'gcs://b/two.pdf') throw new Error('storage down');
    });

    const result = await deleteStorageObjects(
      ['gcs://b/one.pdf', 'gcs://b/two.pdf', 'gcs://b/three.pdf'],
      CONTEXT,
    );

    expect(mockDeleteFile).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ attempted: 3, failed: ['gcs://b/two.pdf'] });
  });

  it('never throws, even when every delete fails', async () => {
    mockDeleteFile.mockRejectedValue(new Error('boom'));

    await expect(deleteStorageObjects(['gcs://b/a', 'gcs://b/b'], CONTEXT)).resolves.toEqual({
      attempted: 2,
      failed: ['gcs://b/a', 'gcs://b/b'],
    });
  });

  it('never lists: it has no prefix form', async () => {
    await deleteStorageObjects(['gcs://b/certs/a.pdf'], CONTEXT);

    expect(mockListFiles).not.toHaveBeenCalled();
    expect(mockListActive).not.toHaveBeenCalled();
  });

  it('does nothing for an empty list', async () => {
    await expect(deleteStorageObjects([], CONTEXT)).resolves.toEqual({ attempted: 0, failed: [] });
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('logs counts and the caller ids but never the object keys', async () => {
    mockDeleteFile.mockRejectedValueOnce(new Error('boom'));
    await deleteStorageObjects(['gcs://b/secret-key.pdf'], CONTEXT);

    const summary = mockLogger.info.mock.calls[0][0];
    expect(summary).toMatchObject({ userId: 'u1', attempted: 1, failed: 1 });
    expect(JSON.stringify(summary)).not.toContain('secret-key');
  });
});
