// @vitest-environment node
/**
 * `deleteUserAvatarFolder` is the one prefix-scoped delete in the codebase (this
 * repo has twice lost production videos to prefix sweeps). Each guard gets its
 * own proof that nothing outside `avatars/<userId>/` can ever be deleted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDeleteFile, mockListActive, mockListFiles, mockLogger } = vi.hoisted(() => ({
  mockDeleteFile: vi.fn(),
  mockListActive: vi.fn(),
  mockListFiles: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/storage', () => ({
  deleteFile: mockDeleteFile,
  getSignedUrl: vi.fn(),
  listFilesForActiveBackend: mockListActive,
  listFiles: mockListFiles,
}));
vi.mock('@/lib/logger', () => ({ logger: mockLogger, maskEmail: (e: string) => e }));

import { AVATAR_FOLDER_DELETE_CAP, deleteUserAvatarFolder } from './avatar';

const USER_ID = '3f2b8c1e-5d4a-4e7b-9a10-0c2d3e4f5a6b';
const CUID = 'c' + 'a'.repeat(24);
const uri = (key: string) => `minio://lms-bucket/${key}`;
const listing = (...keys: string[]) => keys.map((key) => ({ storageUri: uri(key) }));

beforeEach(() => {
  vi.clearAllMocks();
  mockDeleteFile.mockResolvedValue(undefined);
  mockListActive.mockResolvedValue([]);
});

describe('deleteUserAvatarFolder — what it deletes', () => {
  it('lists only avatars/<id>/ with the trailing slash, through the active backend', async () => {
    mockListActive.mockResolvedValue(listing(`avatars/${USER_ID}/1-a.png`));

    await deleteUserAvatarFolder(USER_ID);

    expect(mockListActive).toHaveBeenCalledTimes(1);
    expect(mockListActive).toHaveBeenCalledWith(`avatars/${USER_ID}/`);
    expect(mockListFiles).not.toHaveBeenCalled();
  });

  it('deletes each listed own avatar by its exact URI and reports the counts', async () => {
    mockListActive.mockResolvedValue(
      listing(`avatars/${USER_ID}/1-a.png`, `avatars/${USER_ID}/2-b.png`),
    );

    const result = await deleteUserAvatarFolder(USER_ID);

    expect(mockDeleteFile.mock.calls).toEqual([
      [uri(`avatars/${USER_ID}/1-a.png`)],
      [uri(`avatars/${USER_ID}/2-b.png`)],
    ]);
    expect(result).toEqual({ status: 'deleted', listed: 2, deleted: 2, failed: [] });
  });

  it('accepts a cuid-shaped id', async () => {
    mockListActive.mockResolvedValue(listing(`avatars/${CUID}/1-a.png`));

    await expect(deleteUserAvatarFolder(CUID)).resolves.toMatchObject({ status: 'deleted' });
    expect(mockListActive).toHaveBeenCalledWith(`avatars/${CUID}/`);
  });

  it('an empty folder is a successful no-op', async () => {
    await expect(deleteUserAvatarFolder(USER_ID)).resolves.toEqual({
      status: 'deleted',
      listed: 0,
      deleted: 0,
      failed: [],
    });
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('keeps going after one delete fails and reports the failed URI', async () => {
    const bad = uri(`avatars/${USER_ID}/2-b.png`);
    mockListActive.mockResolvedValue(
      listing(
        `avatars/${USER_ID}/1-a.png`,
        `avatars/${USER_ID}/2-b.png`,
        `avatars/${USER_ID}/3-c.png`,
      ),
    );
    mockDeleteFile.mockImplementation(async (target: string) => {
      if (target === bad) throw new Error('boom');
    });

    const result = await deleteUserAvatarFolder(USER_ID);

    expect(mockDeleteFile).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ status: 'deleted', listed: 3, deleted: 2, failed: [bad] });
  });
});

describe('deleteUserAvatarFolder — what it must never delete', () => {
  it.each([
    ['another user (abc vs abcd boundary)', `avatars/${USER_ID}0/1-a.png`],
    ['a sibling prefix without the slash boundary', `avatars/${USER_ID.slice(0, -1)}/1-a.png`],
    ['a different user entirely', 'avatars/00000000-0000-4000-8000-000000000000/1-a.png'],
    ['a document outside avatars/', `documents/${USER_ID}/1-a.pdf`],
    ['a certificate', 'certificates/org/cert.pdf'],
    ['a `..` traversal back out of the folder', `avatars/${USER_ID}/../other/1-a.png`],
    ['a traversal to another avatar folder', `avatars/${USER_ID}/../${CUID}/1-a.png`],
    ['a nested key below the folder', `avatars/${USER_ID}/nested/1-a.png`],
    ['the bare folder marker', `avatars/${USER_ID}/`],
    ['a video', 'videos/course-1/lesson.mp4'],
  ])('never deletes %s even when the provider lists it', async (_label, key) => {
    mockListActive.mockResolvedValue(listing(key, `avatars/${USER_ID}/own.png`));

    const result = await deleteUserAvatarFolder(USER_ID);

    expect(mockDeleteFile).toHaveBeenCalledTimes(1);
    expect(mockDeleteFile).toHaveBeenCalledWith(uri(`avatars/${USER_ID}/own.png`));
    expect(result).toMatchObject({ status: 'deleted', listed: 1, deleted: 1 });
  });

  it('never deletes a legacy local path or an unparseable URI that is listed', async () => {
    mockListActive.mockResolvedValue([
      { storageUri: `/uploads/avatars/${USER_ID}/1-a.png` },
      { storageUri: 'not-a-uri' },
    ]);

    const result = await deleteUserAvatarFolder(USER_ID);

    expect(mockDeleteFile).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'deleted', listed: 0 });
  });
});

describe('deleteUserAvatarFolder — malformed ids are refused before any listing', () => {
  it.each([
    ['empty', ''],
    ['a traversal', '..'],
    ['a slash', 'abc/def'],
    ['a parent segment', `${USER_ID}/..`],
    ['a wildcard', '*'],
    ['too short for a cuid', 'abc'],
    ['whitespace padded', ` ${USER_ID} `],
    ['a uuid with a trailing slash', `${USER_ID}/`],
    ['a uuid-length non-hex', 'zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz'],
  ])('%s', async (_label, id) => {
    const result = await deleteUserAvatarFolder(id);

    expect(result).toEqual({ status: 'refused', reason: 'invalid_user_id', listed: 0 });
    expect(mockListActive).not.toHaveBeenCalled();
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });
});

describe('deleteUserAvatarFolder — the cap', () => {
  const many = (count: number) =>
    listing(...Array.from({ length: count }, (_, i) => `avatars/${USER_ID}/${i}-a.png`));

  it('deletes nothing when more than the cap is listed', async () => {
    mockListActive.mockResolvedValue(many(AVATAR_FOLDER_DELETE_CAP + 1));

    const result = await deleteUserAvatarFolder(USER_ID);

    expect(result).toEqual({
      status: 'refused',
      reason: 'over_cap',
      listed: AVATAR_FOLDER_DELETE_CAP + 1,
    });
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('deletes everything at exactly the cap', async () => {
    mockListActive.mockResolvedValue(many(AVATAR_FOLDER_DELETE_CAP));

    const result = await deleteUserAvatarFolder(USER_ID);

    expect(result).toMatchObject({ status: 'deleted', listed: AVATAR_FOLDER_DELETE_CAP });
    expect(mockDeleteFile).toHaveBeenCalledTimes(AVATAR_FOLDER_DELETE_CAP);
  });

  it('counts only the owned keys against the cap, not foreign keys the provider leaked', async () => {
    mockListActive.mockResolvedValue([
      ...many(AVATAR_FOLDER_DELETE_CAP),
      ...listing(...Array.from({ length: 50 }, (_, i) => `documents/x/${i}.pdf`)),
    ]);

    const result = await deleteUserAvatarFolder(USER_ID);

    expect(result).toMatchObject({ status: 'deleted', listed: AVATAR_FOLDER_DELETE_CAP });
    expect(mockDeleteFile).toHaveBeenCalledTimes(AVATAR_FOLDER_DELETE_CAP);
  });
});

describe('deleteUserAvatarFolder — failures never throw', () => {
  it('a list failure is returned as a refusal and nothing is deleted', async () => {
    mockListActive.mockRejectedValue(new Error('bucket unreachable'));

    await expect(deleteUserAvatarFolder(USER_ID)).resolves.toEqual({
      status: 'refused',
      reason: 'list_failed',
      listed: 0,
    });
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it('logs the user id and counts only, never an object key', async () => {
    mockListActive.mockResolvedValue(listing(`avatars/${USER_ID}/secret-name.png`));
    await deleteUserAvatarFolder(USER_ID);

    const logged = JSON.stringify([
      ...mockLogger.info.mock.calls,
      ...mockLogger.warn.mock.calls,
      ...mockLogger.error.mock.calls,
    ]);
    expect(logged).not.toContain('secret-name');
  });
});
