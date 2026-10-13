import { deleteFile, getSignedUrl, listFilesForActiveBackend } from '@/lib/storage';
import { parseStorageUri } from '@/lib/storage/types';
import { logger } from '@/lib/logger';

/**
 * True only for an object `uploadAvatar` could have produced for this user.
 * `getSignedUrl` and `deleteFile` act on the key alone, so accepting any URI
 * would let a caller point their avatar at another tenant's document — and
 * read it back through a signed URL, or have it deleted on the next replace.
 */
export function isOwnAvatarUri(uri: string, userId: string): boolean {
  try {
    const { key } = parseStorageUri(uri);
    return key.startsWith(`avatars/${userId}/`) && !key.split('/').includes('..');
  } catch {
    return false;
  }
}

/**
 * Resolve a stored avatar (`User.avatarUrl`, a `gcs://`/`minio://` storage URI)
 * to a short-lived URL an `<img>` can load. The storage URI itself must never
 * reach the browser: it names the bucket and object key and cannot be fetched.
 *
 * A signing failure degrades to `null` (the caller renders initials) rather
 * than failing the whole roster or profile read.
 */
export async function signAvatarUrl(
  storageUri: string | null | undefined,
  userId: string,
): Promise<string | null> {
  if (!storageUri) return null;
  try {
    return await getSignedUrl(storageUri);
  } catch (err) {
    logger.error({ msg: '[user] Failed to sign avatar URL', userId, err });
    return null;
  }
}

/**
 * Best-effort removal of the avatar object a profile save just stopped
 * referencing. Call it only after that write has committed: a storage failure
 * then costs at most an orphaned object, so it is logged and never surfaced to
 * the user's save. Only the caller's own `avatars/<userId>/` objects are ever
 * deleted — a stored value from before that prefix check existed is left alone.
 */
export async function deleteReplacedAvatar(
  previousUri: string | null | undefined,
  nextUri: string | null | undefined,
  userId: string,
): Promise<void> {
  if (!previousUri || previousUri === nextUri) return;
  if (!isOwnAvatarUri(previousUri, userId)) {
    logger.warn({
      msg: '[user] Kept a replaced avatar that is outside the user’s own uploads',
      userId,
    });
    return;
  }
  try {
    await deleteFile(previousUri);
    logger.info({ msg: '[user] Deleted replaced avatar', userId });
  } catch (err) {
    logger.warn({ msg: '[user] Failed to delete replaced avatar', userId, err });
  }
}

/** The id shapes `User.id` takes: a uuid (the schema default) or a cuid. */
const USER_ID_PATTERN =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|c[a-z0-9]{20,31})$/i;

/** Matches the key `uploadAvatar` writes: `avatars/<userId>/<timestamp>-<name>`. */
const AVATAR_KEY_PATTERN = /^avatars\/([^/]+)\/[^/]+$/;

/** More objects than one person's replaced avatars could plausibly leave behind. */
export const AVATAR_FOLDER_DELETE_CAP = 500;

export type AvatarFolderDeleteResult =
  | { status: 'deleted'; listed: number; deleted: number; failed: string[] }
  | { status: 'refused'; reason: 'invalid_user_id' | 'list_failed' | 'over_cap'; listed: number };

/**
 * Deletes every object under ONE user's own avatar folder, `avatars/<userId>/`.
 *
 * ⛔ The only folder-scoped delete in the codebase, and only for a user being
 * permanently deleted. This repo has twice lost production videos to prefix
 * sweeps, so every guard below is load-bearing:
 *  - the id must be uuid- or cuid-shaped, so it can contain no `/` or `..`;
 *  - the prefix keeps its trailing slash, so `abc` never matches `abcd`;
 *  - listing comes from ONLY the backend this environment writes to, exactly as
 *    the avatar sweeper selects it — never a merged or another environment's view;
 *  - every listed key is re-checked against the exact `avatars/<userId>/<file>`
 *    shape before it is deleted, so a provider that reads the prefix loosely
 *    cannot widen it;
 *  - more than {@link AVATAR_FOLDER_DELETE_CAP} objects deletes nothing.
 *
 * Never throws. Call it only after the user's row has been deleted.
 */
export async function deleteUserAvatarFolder(userId: string): Promise<AvatarFolderDeleteResult> {
  if (!USER_ID_PATTERN.test(userId)) {
    logger.warn({ msg: '[user] Refused an avatar folder delete for a malformed user id' });
    return { status: 'refused', reason: 'invalid_user_id', listed: 0 };
  }

  let listed: { storageUri: string }[];
  try {
    listed = await listFilesForActiveBackend(`avatars/${userId}/`);
  } catch (err) {
    logger.error({ msg: '[user] Failed to list the avatar folder', userId, err });
    return { status: 'refused', reason: 'list_failed', listed: 0 };
  }

  const owned = listed.filter(
    ({ storageUri }) =>
      isOwnAvatarUri(storageUri, userId) &&
      AVATAR_KEY_PATTERN.exec(parseStorageUri(storageUri).key)?.[1] === userId,
  );

  if (owned.length !== listed.length) {
    logger.warn({
      msg: '[user] Kept listed objects outside the user’s own avatar folder',
      userId,
      kept: listed.length - owned.length,
    });
  }

  if (owned.length > AVATAR_FOLDER_DELETE_CAP) {
    logger.error({
      msg: '[user] Refused an avatar folder delete over the cap (deleting nothing)',
      userId,
      listed: owned.length,
      cap: AVATAR_FOLDER_DELETE_CAP,
    });
    return { status: 'refused', reason: 'over_cap', listed: owned.length };
  }

  const failed: string[] = [];
  for (const { storageUri } of owned) {
    try {
      await deleteFile(storageUri);
    } catch (err) {
      failed.push(storageUri);
      logger.warn({ msg: '[user] Failed to delete an avatar object', userId, err });
    }
  }

  logger.info({
    msg: '[user] Deleted the avatar folder',
    userId,
    listed: owned.length,
    deleted: owned.length - failed.length,
    failed: failed.length,
  });
  return { status: 'deleted', listed: owned.length, deleted: owned.length - failed.length, failed };
}
