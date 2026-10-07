/**
 * RISK-17: an avatar uploaded but never saved stayed under `avatars/<userId>/`
 * forever. These pin the sweep that reclaims it — and, because a sibling
 * sweeper once deleted production videos, every guardrail that keeps it from
 * deleting anything it should not.
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

import { runAvatarSweep, getAvatarSweepWorker } from './avatar-sweep-worker';
import type { Worker } from 'bullmq';

const NOW_MS = 1_720_000_000_000;
const GRACE_MS = 24 * 60 * 60 * 1000;
const OLD = new Date(NOW_MS - GRACE_MS - 60_000);
const YOUNG = new Date(NOW_MS - GRACE_MS + 60_000);

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

describe('runAvatarSweep', () => {
  it('lists only the avatars/ prefix', async () => {
    listing();
    setupDb([SAVED], ['u1']);

    await runAvatarSweep(live);

    expect(mockListFilesForActiveBackend).toHaveBeenCalledWith('avatars/');
  });

  it('deletes an aged upload no user references, and keeps the saved one', async () => {
    listing([SAVED, OLD], [UNSAVED, OLD]);
    setupDb([SAVED], ['u1']);

    const summary = await runAvatarSweep(live);

    expect(mockDeleteFile).toHaveBeenCalledOnce();
    expect(mockDeleteFile).toHaveBeenCalledWith(UNSAVED);
    expect(summary).toMatchObject({ referenced: 1, orphaned: 1, deleted: 1, aborted: null });
  });

  it('keeps an upload still inside the grace window — the save may be moments away', async () => {
    listing([SAVED, OLD], [UNSAVED, YOUNG]);
    setupDb([SAVED], ['u1']);

    const summary = await runAvatarSweep(live);

    expect(mockDeleteFile).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ total: 2, graceFiltered: 1, orphaned: 0 });
  });

  it('matches references by object key, so a reference under another bucket name still protects the object', async () => {
    listing([SAVED, OLD]);
    setupDb(['minio://other-bucket/avatars/u1/100-saved.png'], ['u1']);

    const summary = await runAvatarSweep(live);

    expect(mockDeleteFile).not.toHaveBeenCalled();
    expect(summary.referenced).toBe(1);
  });

  it('keeps every object whose owner is not a user in this database (a wrong-DB run deletes nothing)', async () => {
    listing([SAVED, OLD], ['gcs://bucket/avatars/stranger/1-a.png', OLD]);
    setupDb([SAVED], ['u1']);

    const summary = await runAvatarSweep(live);

    expect(mockDeleteFile).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ unknownOwner: 1, orphaned: 0 });
  });

  it('keeps any key that is not a direct avatars/<userId>/<file> upload', async () => {
    listing(
      [SAVED, OLD],
      ['gcs://bucket/avatars/loose-file.png', OLD],
      ['gcs://bucket/avatars/u1/nested/x.png', OLD],
      ['gcs://bucket/avatars/u1/../system/videos/x.mp4', OLD],
      ['gcs://bucket/system/videos/clip.mp4', OLD],
    );
    setupDb([SAVED], ['u1']);

    const summary = await runAvatarSweep(live);

    expect(mockDeleteFile).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ unrecognized: 4, orphaned: 0 });
  });

  it('deletes nothing in dry-run and logs what it would delete', async () => {
    listing([SAVED, OLD], [UNSAVED, OLD]);
    setupDb([SAVED], ['u1']);

    const summary = await runAvatarSweep({ gracePeriodMs: GRACE_MS, dryRun: true });

    expect(mockDeleteFile).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ orphaned: 1, deleted: 0 });
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringContaining('DRY RUN'), storageUri: UNSAVED }),
    );
  });

  it('aborts when no user references any avatar while aged objects exist', async () => {
    listing([UNSAVED, OLD]);
    setupDb([], ['u1']);

    const summary = await runAvatarSweep(live);

    expect(mockDeleteFile).not.toHaveBeenCalled();
    expect(summary.aborted).toBe('empty-reference-set');
    expect(mockLoggerError).toHaveBeenCalled();
  });

  it('aborts a real run whose orphans exceed AVATAR_SWEEP_MAX_DELETES, deleting nothing', async () => {
    process.env.AVATAR_SWEEP_MAX_DELETES = '1';
    listing([SAVED, OLD], [UNSAVED, OLD], ['gcs://bucket/avatars/u1/300-also.png', OLD]);
    setupDb([SAVED], ['u1']);

    const summary = await runAvatarSweep(live);

    expect(mockDeleteFile).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ orphaned: 2, deleted: 0, aborted: 'delete-cap-exceeded' });
  });

  it('counts a failed delete and still deletes the other orphans', async () => {
    const other = 'gcs://bucket/avatars/u1/300-also.png';
    listing([SAVED, OLD], [UNSAVED, OLD], [other, OLD]);
    setupDb([SAVED], ['u1']);
    mockDeleteFile.mockImplementation(async (uri: string) => {
      if (uri === UNSAVED) throw new Error('storage down');
    });

    const summary = await runAvatarSweep(live);

    expect(summary).toMatchObject({ deleted: 1, errors: 1 });
  });
});

describe('getAvatarSweepWorker', () => {
  const OWNER_URL = 'https://training.example.com';

  function arm() {
    process.env.AVATAR_SWEEP_ENABLED = 'true';
    process.env.AVATAR_SWEEP_OWNER_APP_URL = OWNER_URL;
    process.env.APP_URL = OWNER_URL;
  }

  it.each([undefined, 'false', 'TRUE'])(
    'starts nothing unless AVATAR_SWEEP_ENABLED is exactly "true" (%s)',
    (value) => {
      if (value !== undefined) process.env.AVATAR_SWEEP_ENABLED = value;

      expect(getAvatarSweepWorker()).toBeNull();
      expect(MockWorker).not.toHaveBeenCalled();
      expect(mockAvatarSweepQueue.removeJobScheduler).toHaveBeenCalledWith('avatar-sweep');
    },
  );

  it('refuses when the owner URL does not match APP_URL (a copied env file)', () => {
    arm();
    process.env.APP_URL = 'https://staging.example.com';

    expect(getAvatarSweepWorker()).toBeNull();
    expect(MockWorker).not.toHaveBeenCalled();
    expect(mockAvatarSweepQueue.upsertJobScheduler).not.toHaveBeenCalled();
  });

  it('refuses when AVATAR_SWEEP_OWNER_APP_URL is unset', () => {
    arm();
    delete process.env.AVATAR_SWEEP_OWNER_APP_URL;

    expect(getAvatarSweepWorker()).toBeNull();
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringContaining('is not set') }),
    );
  });

  it('starts once, in dry-run by default, and installs its schedule', async () => {
    arm();

    const first = getAvatarSweepWorker();
    const second = getAvatarSweepWorker();

    expect(first).not.toBeNull();
    expect(first).toBe(second);
    expect(MockWorker).toHaveBeenCalledOnce();
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ msg: '[AvatarSweep] Starting worker', dryRun: true }),
    );
    await vi.waitFor(() =>
      expect(mockAvatarSweepQueue.upsertJobScheduler).toHaveBeenCalledWith(
        'avatar-sweep',
        { pattern: '30 3 * * *' },
        { name: 'sweep' },
      ),
    );
  });

  it('arms live deletes only for AVATAR_SWEEP_DRY_RUN="false", and warns', () => {
    arm();
    process.env.AVATAR_SWEEP_DRY_RUN = 'false';

    getAvatarSweepWorker();

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringContaining('LIVE DELETES ARMED') }),
    );
  });
});
