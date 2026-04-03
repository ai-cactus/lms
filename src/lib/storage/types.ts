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
