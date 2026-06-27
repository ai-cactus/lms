/**
 * Google Cloud Storage provider.
 *
 * Authentication strategy:
 *   - Production / staging (non-GCP host): set GCS_KEY_BASE64 to a base64-encoded
 *     service-account JSON key. The credentials are decoded and passed in-memory to
 *     the Storage client (no key file touches disk), since ADC cannot auto-resolve
 *     off a GCP host.
 *   - Local dev: leave GCS_KEY_BASE64 unset and rely on Application Default
 *     Credentials (ADC), which resolve via `gcloud auth application-default login`,
 *     GOOGLE_APPLICATION_CREDENTIALS, or a GCP VM's service account.
 *
 * Required env var:
 *   GCP_BUCKET_NAME  — the GCS bucket to store files in.
 *
 * Optional env vars:
 *   GCS_KEY_BASE64    — base64-encoded service-account JSON key (prod/staging auth).
 *   GOOGLE_PROJECT_ID — project id used when constructing with in-memory credentials.
 *
 * Throws on construction if GCP_BUCKET_NAME is not set, or if GCS_KEY_BASE64 is
 * set but malformed, so the unified storage layer can catch this and fall back to MinIO.
 */

import { Storage } from '@google-cloud/storage';
import type { StorageListItem, StorageProvider, StorageUploadResult } from './types';
import { parseStorageUri } from './types';
import { logger } from '@/lib/logger';

const DEFAULT_SIGNED_URL_EXPIRY = 900; // 15 minutes

/** Narrows unknown parsed JSON to a service-account key with the fields the Storage client needs. */
function isServiceAccountKey(
  value: unknown,
): value is { client_email: string; private_key: string } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { client_email, private_key } = value as Record<string, unknown>;
  return (
    typeof client_email === 'string' &&
    client_email.length > 0 &&
    typeof private_key === 'string' &&
    private_key.length > 0
  );
}

export class GCSProvider implements StorageProvider {
  private readonly storage: Storage;
  private readonly bucketName: string;

  constructor() {
    const bucketName = process.env.GCP_BUCKET_NAME;
    if (!bucketName) {
      throw new Error('GCP_BUCKET_NAME is not configured — GCS provider unavailable');
    }

    this.bucketName = bucketName;

    const rawKey = process.env.GCS_KEY_BASE64;
    if (rawKey) {
      // Production / staging: decode the service-account key and pass it in-memory.
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.from(rawKey, 'base64').toString('utf8'));
      } catch {
        // Never log or surface the raw/decoded key material.
        logger.warn({
          msg: '[storage] GCS_KEY_BASE64 is set but could not be decoded/parsed — GCS provider unavailable',
        });
        throw new Error('GCS_KEY_BASE64 is malformed — GCS provider unavailable');
      }

      if (!isServiceAccountKey(parsed)) {
        logger.warn({
          msg: '[storage] GCS_KEY_BASE64 is set but could not be decoded/parsed — GCS provider unavailable',
        });
        throw new Error('GCS_KEY_BASE64 is malformed — GCS provider unavailable');
      }

      this.storage = new Storage({
        projectId: process.env.GOOGLE_PROJECT_ID,
        credentials: {
          client_email: parsed.client_email,
          private_key: parsed.private_key,
        },
      });
      return;
    }

    // Local dev: ADC resolves automatically via gcloud login,
    // GOOGLE_APPLICATION_CREDENTIALS, or a GCP VM's service account.
    this.storage = new Storage();
  }

  async upload(key: string, buffer: Buffer, mimeType: string): Promise<StorageUploadResult> {
    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(key);

    await file.save(buffer, {
      contentType: mimeType,
      // Metadata useful for auditing
      metadata: {
        uploadedAt: new Date().toISOString(),
      },
    });

    const storageUri = `gcs://${this.bucketName}/${key}`;
    logger.info({ msg: 'GCS upload successful', storageUri });
    return { storageUri, backend: 'gcs' };
  }

  async getSignedUrl(
    storageUri: string,
    expirySeconds: number = DEFAULT_SIGNED_URL_EXPIRY,
  ): Promise<string> {
    const { key } = parseStorageUri(storageUri);
    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(key);

    const [url] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + expirySeconds * 1000,
    });

    return url;
  }

  async delete(storageUri: string): Promise<void> {
    const { key } = parseStorageUri(storageUri);
    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(key);

    try {
      await file.delete();
      logger.info({ msg: 'GCS object deleted', storageUri });
    } catch (err: unknown) {
      // 404 means object is already gone — treat as success (idempotent)
      const e = err as { code?: number };
      if (e?.code === 404) {
        logger.warn({ msg: 'GCS delete: object not found (already deleted)', storageUri });
        return;
      }
      throw err;
    }
  }

  async download(storageUri: string): Promise<Buffer> {
    const { key } = parseStorageUri(storageUri);
    const bucket = this.storage.bucket(this.bucketName);
    const file = bucket.file(key);

    // file.download() resolves to [Buffer]
    const [contents] = await file.download();
    return contents;
  }

  async list(prefix: string): Promise<StorageListItem[]> {
    const bucket = this.storage.bucket(this.bucketName);

    // getFiles auto-paginates internally and resolves to every matching File.
    const [files] = await bucket.getFiles({ prefix });

    return files.map((file) => {
      const timeCreated = file.metadata.timeCreated;
      return {
        storageUri: `gcs://${this.bucketName}/${file.name}`,
        createdAt: timeCreated ? new Date(timeCreated) : new Date(),
      };
    });
  }
}
