import { getSignedUrl } from '@/lib/storage';
import { parseStorageUri } from '@/lib/storage/types';
import { logger } from '@/lib/logger';

/**
 * True only for an object `uploadAvatar` could have produced for this user.
 * `getSignedUrl` signs by key alone, so accepting any URI would let a caller
 * point their avatar at another tenant's document and read it back through a
 * signed URL.
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
