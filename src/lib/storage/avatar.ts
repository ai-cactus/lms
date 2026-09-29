import { deleteFile, getSignedUrl } from '@/lib/storage';
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
