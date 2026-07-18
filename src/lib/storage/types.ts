/**
 * Storage provider abstraction.
 *
 * All files are identified by opaque storage URIs in the format:
 *   gcs://<bucket>/<key>
 *   minio://<bucket>/<key>
 *
 * This URI is what gets persisted in DocumentVersion.storagePath.
 * The provider prefix tells the serving layer which backend to query.
 */

export type StorageBackend = 'gcs' | 'minio';

export interface StorageUploadResult {
  /** Opaque URI stored in the database, e.g. "gcs://my-bucket/documents/userId/ts-file.pdf" */
  storageUri: string;
  backend: StorageBackend;
}

export interface StorageListItem {
  /** Opaque URI of the object, e.g. "gcs://my-bucket/system/videos/123-clip.mp4". */
  storageUri: string;
  /** When the object was created in the backend (used by the orphan sweeper grace filter). */
  createdAt: Date;
}

export interface UploadUrlResult {
  /**
   * URL the browser uploads directly to, bypassing the app server.
   * For GCS this is the resumable-session *initiation* endpoint (POST);
   * for MinIO it is a presigned PUT URL.
   */
  uploadUrl: string;
  /** Opaque URI to persist once the upload completes (same format as upload()). */
  storageUri: string;
  /** Which protocol the browser must speak against `uploadUrl`. */
  kind: 'gcs-resumable' | 'minio-put';
}

export interface StorageProvider {
  /**
   * Upload a file buffer to the backend.
   * @param key       The object key / path within the bucket.
   * @param buffer    Raw file bytes.
   * @param mimeType  Content-Type of the file.
   * @returns         Upload result including the opaque storageUri.
   */
  upload(key: string, buffer: Buffer, mimeType: string): Promise<StorageUploadResult>;

  /**
   * Mint a short-lived URL the browser can upload directly to, so large files
   * never transit the app server (which sits behind Cloudflare/Nginx body and
   * timeout limits).
   * @param key            Object key / path within the bucket.
   * @param contentType    Content-Type the upload must declare (bound into the signature for GCS).
   * @param expirySeconds  How long the URL is valid. Defaults to 900 (15 min).
   */
  createUploadUrl(
    key: string,
    contentType: string,
    expirySeconds?: number,
  ): Promise<UploadUrlResult>;

  /**
   * Generate a short-lived presigned GET URL for the given storageUri.
   * @param storageUri  The opaque URI returned from upload().
   * @param expirySeconds  How long the URL is valid. Defaults to 900 (15 min).
   * @returns           HTTPS URL the browser can use directly.
   */
  getSignedUrl(storageUri: string, expirySeconds?: number): Promise<string>;

  /**
   * Permanently delete the object identified by the storageUri.
   * Should not throw if the object is already gone (idempotent).
   */
  delete(storageUri: string): Promise<void>;

  /**
   * Report whether the object identified by the storageUri still exists.
   *
   * Resolves `false` ONLY when the object is definitively absent (a 404 /
   * NoSuchKey from the backend). Any other failure (network, auth, 5xx) must be
   * thrown so callers can distinguish a genuinely-missing object from a
   * transient error and avoid recording a false "missing".
   */
  objectExists(storageUri: string): Promise<boolean>;

  /**
   * Download the object identified by the storageUri as a Buffer.
   * Used by background workers that need the raw bytes for processing.
   */
  download(storageUri: string): Promise<Buffer>;

  /**
   * List every object under the given key prefix.
   * Used by the orphaned-object reconciliation sweeper.
   * @param prefix  Object key prefix (e.g. "system/videos/").
   * @returns       One StorageListItem per object, including its createdAt timestamp.
   */
  list(prefix: string): Promise<StorageListItem[]>;
}

/**
 * Parse an opaque storage URI back into its components.
 *
 * @example
 * parseStorageUri("gcs://my-bucket/documents/abc/123.pdf")
 * // → { backend: 'gcs', bucket: 'my-bucket', key: 'documents/abc/123.pdf' }
 */
export function parseStorageUri(uri: string): {
  backend: StorageBackend;
  bucket: string;
  key: string;
} {
  // Handle legacy local-filesystem paths (pre-migration)
  if (uri.startsWith('/') || uri.startsWith('./')) {
    throw new Error(`Legacy storage path — cannot parse as a cloud URI: ${uri}`);
  }

  const match = uri.match(/^(gcs|minio):\/\/([^/]+)\/(.+)$/);
  if (!match) {
    throw new Error(`Invalid storage URI format: ${uri}`);
  }

  return {
    backend: match[1] as StorageBackend,
    bucket: match[2],
    key: match[3],
  };
}

/** Returns true for pre-migration local paths that we can't serve from cloud storage. */
export function isLegacyPath(path: string): boolean {
  return path.startsWith('/uploads/') || path.startsWith('./');
}
