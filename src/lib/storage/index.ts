/**
 * Unified storage API — GCS primary, MinIO fallback.
 *
 * This is the ONLY module the rest of the application should import.
 * It never exposes which backend was used — callers just get opaque storageUris.
 *
 * Selection logic:
 *   1. Try GCS   — if GCP_BUCKET_NAME is set and ADC resolves.
 *   2. On failure  → log a warning → try MinIO.
 *   3. If both fail → throw a structured error (upload rejected).
 *
 * The chosen backend is encoded in the returned storageUri prefix:
 *   "gcs://bucket/key"   or   "minio://bucket/key"
 */

import { GCSProvider } from './gcs-provider';
import { MinIOProvider } from './minio-provider';
import type {
  StorageListItem,
  StorageProvider,
  StorageUploadResult,
  UploadUrlResult,
} from './types';
import { isLegacyPath } from './types';
import { logger } from '@/lib/logger';

export { parseStorageUri, isLegacyPath } from './types';
export type {
  StorageListItem,
  StorageUploadResult,
  StorageBackend,
  UploadUrlResult,
} from './types';

// MinIO is always available (it's in Docker) — lazily instantiated once.
let _minio: MinIOProvider | null = null;
function getMinio(): MinIOProvider {
  if (!_minio) _minio = new MinIOProvider();
  return _minio;
}

// GCS is optional — instantiation throws if GCP_BUCKET_NAME is unset.
let _gcs: GCSProvider | null = null;
let _gcsInitialised = false;
function tryGetGCS(): GCSProvider | null {
  if (_gcsInitialised) return _gcs;
  _gcsInitialised = true;
  try {
    _gcs = new GCSProvider();
    return _gcs;
  } catch (err: unknown) {
    const e = err as Error;
    logger.warn({ msg: 'GCS provider unavailable — will use MinIO', reason: e.message });
    return null;
  }
}

/**
 * Upload a file buffer using GCS if available, otherwise MinIO.
 *
 * @param key       Object key inside the bucket (e.g. "documents/userId/ts-name.pdf")
 * @param buffer    Raw file bytes
 * @param mimeType  MIME type string
 */
export async function uploadFile(
  key: string,
  buffer: Buffer,
  mimeType: string,
): Promise<StorageUploadResult> {
  const gcs = tryGetGCS();

  if (gcs) {
    try {
      return await gcs.upload(key, buffer, mimeType);
    } catch (err: unknown) {
      const e = err as Error;
      logger.warn({ msg: 'GCS upload failed — falling back to MinIO', reason: e.message, key });
    }
  }

  return getMinio().upload(key, buffer, mimeType);
}

/**
 * Mint a short-lived URL the browser can upload a file directly to, bypassing
 * the app server. Uses GCS if available, otherwise MinIO.
 *
 * The caller inspects `kind` to decide what to do: a `gcs-resumable` URL is
 * safe to hand to a production browser, whereas a `minio-put` URL points at an
 * internal host and must not be exposed beyond local dev.
 *
 * @param key            Object key inside the bucket (e.g. "system/videos/ts-name.mp4")
 * @param contentType    MIME type the upload will declare
 * @param expirySeconds  URL validity window (default 900 s = 15 min)
 */
export async function createUploadUrl(
  key: string,
  contentType: string,
  expirySeconds = 900,
): Promise<UploadUrlResult> {
  const gcs = tryGetGCS();

  if (gcs) {
    try {
      return await gcs.createUploadUrl(key, contentType, expirySeconds);
    } catch (err: unknown) {
      const e = err as Error;
      logger.warn({
        msg: '[storage] GCS createUploadUrl failed — falling back to MinIO',
        reason: e.message,
        key,
      });
    }
  }

  return getMinio().createUploadUrl(key, contentType, expirySeconds);
}

/**
 * Download a stored file as a Buffer.
 * Works for both gcs:// and minio:// URIs.
 *
 * @param storageUri  The value from StandardManual.storagePath
 */
export async function downloadFile(storageUri: string): Promise<Buffer> {
  const provider = resolveProvider(storageUri);
  return provider.download(storageUri);
}

/**
 * Get a short-lived URL (default 15 min) for a stored file.
 * Works for both gcs:// and minio:// URIs.
 *
 * For legacy local paths (starting with /uploads/), returns the path as-is
 * so existing documents don't break.
 *
 * @param storageUri   The value from DocumentVersion.storagePath
 * @param expirySeconds  URL validity window (default 900 s = 15 min)
 */
export async function getSignedUrl(storageUri: string, expirySeconds = 900): Promise<string> {
  // Backward-compat: legacy documents stored before this migration
  if (isLegacyPath(storageUri)) {
    logger.warn({
      msg: 'getSignedUrl called with a legacy local path — returning as-is',
      storageUri,
    });
    return storageUri;
  }

  const provider = resolveProvider(storageUri);
  return provider.getSignedUrl(storageUri, expirySeconds);
}

/**
 * Report whether a stored object still exists in its backend.
 *
 * Resolves `false` only for a definitively-missing object (404 / NoSuchKey);
 * transient failures (network, auth, 5xx) reject so callers can avoid recording
 * a false "missing". Legacy local paths are treated as absent from cloud storage.
 *
 * @param storageUri  The opaque URI persisted for the object.
 */
export async function objectExists(storageUri: string): Promise<boolean> {
  if (isLegacyPath(storageUri)) {
    logger.warn({
      msg: '[storage] objectExists called with a legacy local path — treating as missing',
      storageUri,
    });
    return false;
  }

  const provider = resolveProvider(storageUri);
  return provider.objectExists(storageUri);
}

/**
 * Permanently delete a stored file.
 * Idempotent — safe to call if the object is already gone.
 *
 * Skips legacy local paths (they won't be in cloud storage).
 */
export async function deleteFile(storageUri: string): Promise<void> {
  if (isLegacyPath(storageUri)) {
    logger.warn({ msg: 'deleteFile skipping legacy local path', storageUri });
    return;
  }

  const provider = resolveProvider(storageUri);
  return provider.delete(storageUri);
}

/**
 * List every stored object under a key prefix across BOTH backends.
 *
 * Used by the orphaned-object reconciliation sweeper. Each backend is queried
 * independently and wrapped so that one backend being unavailable (e.g. GCS not
 * configured in local dev) logs a warning and contributes [] rather than
 * aborting the whole sweep.
 *
 * @param prefix  Object key prefix (e.g. "system/videos/").
 */
export async function listFiles(prefix: string): Promise<StorageListItem[]> {
  const gcs = tryGetGCS();

  const [gcsItems, minioItems] = await Promise.all([
    gcs
      ? gcs.list(prefix).catch((err: unknown) => {
          logger.warn({
            msg: '[storage] GCS list failed — continuing without GCS results',
            prefix,
            reason: (err as Error).message,
          });
          return [] as StorageListItem[];
        })
      : Promise.resolve([] as StorageListItem[]),
    getMinio()
      .list(prefix)
      .catch((err: unknown) => {
        logger.warn({
          msg: '[storage] MinIO list failed — continuing without MinIO results',
          prefix,
          reason: (err as Error).message,
        });
        return [] as StorageListItem[];
      }),
  ]);

  return [...gcsItems, ...minioItems];
}

/**
 * Route a storageUri to the correct provider based on its prefix.
 * Throws a clear error if the prefix is unrecognised.
 */
function resolveProvider(storageUri: string): StorageProvider {
  if (storageUri.startsWith('gcs://')) {
    const gcs = tryGetGCS();
    if (!gcs) {
      throw new Error(
        `storageUri uses GCS backend (${storageUri}) but GCS is not configured. ` +
          'Set GCP_BUCKET_NAME and ensure ADC is available.',
      );
    }
    return gcs;
  }

  if (storageUri.startsWith('minio://')) {
    return getMinio();
  }

  throw new Error(`Unrecognised storage URI scheme: ${storageUri}`);
}
