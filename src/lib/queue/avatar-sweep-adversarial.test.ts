/**
 * RISK-17 adversarial pass: hostile or odd object keys and reference shapes that
 * must never make the avatar sweep delete a referenced object, or anything that
 * is not a direct `avatars/<existing user>/<file>` upload.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  MockWorker,
  mockListFilesForActiveBackend,
  mockDeleteFile,
  mockUserFindMany,
  mockLoggerInfo,
  mockLoggerWarn,
  mockLoggerError,
  mockAvatarSweepQueue,
} = vi.hoisted(() => ({
  MockWorker: vi.fn(function (this: Record<string, unknown>) {
    this.on = vi.fn();
  }),
  mockListFilesForActiveBackend: vi.fn(),
  mockDeleteFile: vi.fn(),
  mockUserFindMany: vi.fn(),
  mockLoggerInfo: vi.fn(),
  mockLoggerWarn: vi.fn(),
  mockLoggerError: vi.fn(),
  mockAvatarSweepQueue: {
    getJobSchedulers: vi.fn().mockResolvedValue([]),
    removeJobScheduler: vi.fn().mockResolvedValue(undefined),
    upsertJobScheduler: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('bullmq', () => ({ Worker: MockWorker }));
vi.mock('@/lib/queue/redis', () => ({ redis: {} }));
vi.mock('@/lib/queue/avatar-sweep-queue', () => ({
  AVATAR_SWEEP_QUEUE_NAME: 'avatar-sweep-queue',
  avatarSweepQueue: mockAvatarSweepQueue,
}));
vi.mock('@/lib/storage', async () => ({
  listFilesForActiveBackend: mockListFilesForActiveBackend,
  deleteFile: mockDeleteFile,
  parseStorageUri: (
    await vi.importActual<typeof import('@/lib/storage/types')>('@/lib/storage/types')
  ).parseStorageUri,
}));
vi.mock('@/lib/prisma', () => {
  const prisma = { user: { findMany: mockUserFindMany } };
  return { default: prisma, prisma };
});
vi.mock('@/lib/logger', () => ({
  logger: { info: mockLoggerInfo, warn: mockLoggerWarn, error: mockLoggerError, debug: vi.fn() },
}));

import { runAvatarSweep } from './avatar-sweep-worker';
import type { Worker } from 'bullmq';

const NOW_MS = 1_720_000_000_000;
const GRACE_MS = 24 * 60 * 60 * 1000;
const OLD = new Date(NOW_MS - GRACE_MS - 60_000);

const SAVED = 'gcs://bucket/avatars/u1/100-saved.png';
const UNSAVED = 'gcs://bucket/avatars/u1/200-unsaved.png';

/**
 * `avatarUrl` rows answer the reference query; `{ id }` rows answer the
 * owner-existence query. The two calls are told apart by their `select`.
 */
function setupDb(avatarUrls: (string | null)[], existingUserIds: string[]) {
  mockUserFindMany.mockImplementation(async (args: { select: Record<string, boolean> }) =>
    args.select.avatarUrl
      ? avatarUrls.map((avatarUrl) => ({ avatarUrl }))
      : existingUserIds.map((id) => ({ id })),
  );
}

function listing(...items: [string, Date][]) {
  mockListFilesForActiveBackend.mockResolvedValue(
    items.map(([storageUri, createdAt]) => ({ storageUri, createdAt })),
  );
}

const live = { gracePeriodMs: GRACE_MS, dryRun: false };

const originalAppUrl = process.env.APP_URL;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
  mockDeleteFile.mockResolvedValue(undefined);
  delete (globalThis as unknown as { __avatarSweepWorker?: Worker }).__avatarSweepWorker;
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as unknown as { __avatarSweepWorker?: Worker }).__avatarSweepWorker;
  delete process.env.AVATAR_SWEEP_ENABLED;
  delete process.env.AVATAR_SWEEP_OWNER_APP_URL;
  delete process.env.AVATAR_SWEEP_DRY_RUN;
  delete process.env.AVATAR_SWEEP_MAX_DELETES;
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
});

describe('runAvatarSweep — adversarial keys and references', () => {
  const kept = [
    'gcs://bucket/avatars/u1/',
    'gcs://bucket/avatars/u1//x.png',
    'gcs://bucket/avatars//x.png',
    'gcs://bucket/Avatars/u1/x.png',
    'gcs://bucket/avatars/U1/x.png',
    'gcs://bucket/avatars/%2e%2e/system/x.mp4',
    'gcs://bucket/avatars/u1/%2e%2e/x.png',
    'gcs://bucket/avatars/u1/..',
    'gcs://bucket/avatars/..',
    'gcs://bucket/avatarsx/u1/x.png',
    'gcs://bucket/documents/avatars/u1/x.png',
    'gcs://bucket/avatars/u1/a/b.png',
  ];

  it.each(kept)('never deletes %s', async (uri) => {
    listing([uri, OLD], [SAVED, OLD]);
    setupDb([SAVED], ['u1']);

    await runAvatarSweep(live);

    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('deletes only the exact listed URI of an encoded-looking single-segment orphan', async () => {
    const odd = 'gcs://bucket/avatars/u1/100-a%2Fb%20c.png';
    listing([odd, OLD], [SAVED, OLD]);
    setupDb([SAVED], ['u1']);

    await runAvatarSweep(live);

    expect(mockDeleteFile).toHaveBeenCalledExactlyOnceWith(odd);
  });

  it('treats user ids as exact strings, not patterns or case-folded values', async () => {
    listing(
      ['gcs://bucket/avatars/a.b/1-x.png', OLD],
      ['gcs://bucket/avatars/aXb/1-x.png', OLD],
      ['gcs://bucket/avatars/A.B/1-x.png', OLD],
      [SAVED, OLD],
    );
    setupDb([SAVED], ['u1', 'a.b']);

    await runAvatarSweep(live);

    expect(mockDeleteFile).toHaveBeenCalledExactlyOnceWith('gcs://bucket/avatars/a.b/1-x.png');
  });

  it('a reference under the other backend scheme still protects the object', async () => {
    listing([UNSAVED, OLD], [SAVED, OLD]);
    setupDb([SAVED, 'minio://lms-documents/avatars/u1/200-unsaved.png'], ['u1']);

    await runAvatarSweep(live);

    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('soft-deleted or any user row still protects its referenced avatar (reference query has no deletedAt filter)', async () => {
    listing([UNSAVED, OLD], [SAVED, OLD]);
    setupDb([SAVED, UNSAVED], ['u1']);

    await runAvatarSweep(live);

    expect(mockDeleteFile).not.toHaveBeenCalled();
    const referenceQuery = mockUserFindMany.mock.calls
      .map(([args]) => args)
      .find((args: { select: Record<string, boolean> }) => args.select.avatarUrl);
    expect(referenceQuery.where).toEqual({ avatarUrl: { not: null } });
  });

  // KNOWN GAP (reported, product code untouched): a stored avatarUrl that is not a
  // gcs:// / minio:// URI (a legacy signed https URL, an s3:// URI) cannot be parsed
  // to a key, so it protects nothing and its object looks orphaned.
  it.fails(
    'a non-storage-URI avatarUrl that names an object (signed https URL) should still protect it',
    async () => {
      listing([UNSAVED, OLD], [SAVED, OLD]);
      setupDb(
        [
          SAVED,
          'https://storage.googleapis.com/bucket/avatars/u1/200-unsaved.png?X-Goog-Signature=abc',
        ],
        ['u1'],
      );

      await runAvatarSweep(live);

      expect(mockDeleteFile).not.toHaveBeenCalled();
    },
  );
});
