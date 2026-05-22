/**
 * Google Cloud Storage provider.
 *
 * Authentication uses Application Default Credentials (ADC) — no key file required.
 * On GCP VMs, this resolves automatically via the VM's service account.
 * Locally, run `gcloud auth application-default login` once.
 *
 * Required env var:
 *   GCP_BUCKET_NAME  — the GCS bucket to store files in.
 *
 * Throws on construction if GCP_BUCKET_NAME is not set, so the unified
 * storage layer can catch this and fall back to MinIO.
 */

import { Storage } from '@google-cloud/storage';
import type { StorageProvider, StorageUploadResult } from './types';
import { parseStorageUri } from './types';
import { logger } from '@/lib/logger';

const DEFAULT_SIGNED_URL_EXPIRY = 900; // 15 minutes

export class GCSProvider implements StorageProvider {
  private readonly storage: Storage;
  private readonly bucketName: string;

  constructor() {
    const bucketName = process.env.GCP_BUCKET_NAME;
    if (!bucketName) {
      throw new Error('GCP_BUCKET_NAME is not configured — GCS provider unavailable');
    }

    this.bucketName = bucketName;
    // ADC resolves automatically: GCP VM identity, GOOGLE_APPLICATION_CREDENTIALS, or gcloud login
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
}
