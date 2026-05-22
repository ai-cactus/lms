/**
 * Document upload handler.
 *
 * Saves a file to cloud storage (GCS → MinIO fallback) and returns the
 * opaque storageUri to be persisted in DocumentVersion.storagePath.
 *
 * Key format: documents/<userId>/<timestamp>-<sanitizedFilename>
 * This ensures:
 *   - No collisions across users or time
 *   - No dangerous characters reaching the storage bucket
 *   - Easy manual inspection / auditing by userId prefix
 */

import { uploadFile } from '@/lib/storage';

/**
 * Upload a file to cloud storage and return the opaque storageUri.
 *
 * @param file    The File object from FormData.
 * @param userId  The authenticated user's ID (used to namespace the object key).
 * @returns       Opaque storageUri, e.g. "gcs://bucket/documents/u1/ts-report.pdf"
 */
export async function saveFile(file: File, userId: string): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());

  // Sanitise filename: lowercase, only alphanumeric + dots/hyphens
  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
  const key = `documents/${userId}/${timestamp}-${safeName}`;

  const { storageUri } = await uploadFile(key, buffer, file.type || 'application/octet-stream');
  return storageUri;
}
