/**
 * MinIO storage provider (S3-compatible).
 *
 * Used as the fallback when GCS is unavailable or unconfigured.
 * In local dev and staging, MinIO runs as a Docker service.
 * In production, it runs alongside the app as an always-available local fallback.
 *
 * Required env vars (with defaults for local dev):
 *   MINIO_ENDPOINT    — hostname of the MinIO server    (default: localhost)
 *   MINIO_PORT        — port the MinIO API listens on   (default: 9000)
 *   MINIO_USE_SSL     — "true" to enable TLS            (default: false)
 *   MINIO_ACCESS_KEY  — root user / access key          (default: lms_minio_dev)
 *   MINIO_SECRET_KEY  — root password / secret key      (default: lms_minio_secret_dev)
 *   MINIO_BUCKET      — target bucket name              (default: lms-documents)
 */

import * as Minio from 'minio';
import type { StorageProvider, StorageUploadResult } from './types';
import { parseStorageUri } from './types';
import { logger } from '@/lib/logger';

const DEFAULT_SIGNED_URL_EXPIRY = 900; // 15 minutes

export class MinIOProvider implements StorageProvider {
  private readonly client: Minio.Client;
  private readonly bucketName: string;
  private bucketEnsured = false;

  constructor() {
    const endpoint = process.env.MINIO_ENDPOINT ?? 'localhost';
    const port = parseInt(process.env.MINIO_PORT ?? '9000', 10);
    const useSSL = process.env.MINIO_USE_SSL === 'true';
    const accessKey = process.env.MINIO_ACCESS_KEY ?? 'lms_minio_dev';
    const secretKey = process.env.MINIO_SECRET_KEY ?? 'lms_minio_secret_dev';
    this.bucketName = process.env.MINIO_BUCKET ?? 'lms-documents';

    this.client = new Minio.Client({
      endPoint: endpoint,
      port,
      useSSL,
      accessKey,
      secretKey,
    });
  }

  /** Lazily ensures the bucket exists — called before any operation. */
  private async ensureBucket(): Promise<void> {
    if (this.bucketEnsured) return;

    const exists = await this.client.bucketExists(this.bucketName);
    if (!exists) {
      await this.client.makeBucket(this.bucketName);
      logger.info({ msg: 'MinIO: created bucket', bucket: this.bucketName });
    }
    this.bucketEnsured = true;
  }

  async upload(key: string, buffer: Buffer, mimeType: string): Promise<StorageUploadResult> {
    await this.ensureBucket();

    await this.client.putObject(this.bucketName, key, buffer, buffer.length, {
      'Content-Type': mimeType,
      'X-Uploaded-At': new Date().toISOString(),
    });

    const storageUri = `minio://${this.bucketName}/${key}`;
    logger.info({ msg: 'MinIO upload successful', storageUri });
    return { storageUri, backend: 'minio' };
  }

  async getSignedUrl(
    storageUri: string,
    expirySeconds: number = DEFAULT_SIGNED_URL_EXPIRY,
  ): Promise<string> {
    await this.ensureBucket();
    const { key } = parseStorageUri(storageUri);

    // presignedGetObject returns a URL valid for expirySeconds
    const url = await this.client.presignedGetObject(this.bucketName, key, expirySeconds);
    return url;
  }

  async delete(storageUri: string): Promise<void> {
    await this.ensureBucket();
    const { key } = parseStorageUri(storageUri);

    try {
      await this.client.removeObject(this.bucketName, key);
      logger.info({ msg: 'MinIO object deleted', storageUri });
    } catch (err: unknown) {
      // NoSuchKey means already gone — treat as success (idempotent)
      const e = err as { code?: string };
      if (e?.code === 'NoSuchKey') {
        logger.warn({ msg: 'MinIO delete: object not found (already deleted)', storageUri });
        return;
      }
      throw err;
    }
  }

  async download(storageUri: string): Promise<Buffer> {
    await this.ensureBucket();
    const { key } = parseStorageUri(storageUri);

    const stream = await this.client.getObject(this.bucketName, key);
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }
}
