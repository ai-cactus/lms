'use server';

import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { saveFile } from '@/lib/documents/uploadHandler';
import { calculateHash } from '@/lib/documents/versioning';
import { scanText } from '@/lib/documents/phiScanner';
import { MAX_DOCUMENT_UPLOAD_BYTES } from '@/lib/documents/upload-config';
import { extractTextFromFile } from '@/lib/file-parser';
import { deleteFile } from '@/lib/storage';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { audit, getClientContext } from '@/lib/audit';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { Prisma } from '@/generated/prisma/client';

export async function uploadDocument(
  _prevState: { success?: boolean; error?: string; phiDetected?: boolean } | null,
  formData: FormData,
) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return { error: 'Not authenticated or not in an organization' };
  }

  const userId = session.user.id;

  const file = formData.get('file') as File;
  if (!file) {
    return { error: 'No file provided' };
  }

  // F-017: reject oversized uploads BEFORE buffering the whole file into memory.
  if (file.size > MAX_DOCUMENT_UPLOAD_BYTES) {
    const maxMb = Math.round(MAX_DOCUMENT_UPLOAD_BYTES / (1024 * 1024));
    logger.warn({ msg: '[doc] Upload rejected — file too large', userId, size: file.size });
    return { error: `File is too large. The maximum document size is ${maxMb} MB.` };
  }

  // 1. Calculate Hash & Check Duplicates (Conceptually)
  const buffer = Buffer.from(await file.arrayBuffer());
  const hash = await calculateHash(buffer);

  // 2. Extract Text
  let textContent = '';
  try {
    textContent = await extractTextFromFile(file);
    if (!textContent || textContent.trim().length === 0) {
      return {
        error:
          'Extraction Error: Document contains no extractable text. Scanned images are not supported.',
      };
    }
  } catch (err: unknown) {
    const e = err as Error;
    logger.error({ msg: 'Text extraction failed', err: e.message });
    return { error: `Extraction Failed: ${e.message || 'Could not read text from document.'}` };
  }

  // F-018: rate-limit the expensive AI-backed PHI scan per user (20 / 5 min).
  const { allowed, resetInSeconds } = await checkRateLimit(`phi-scan:${userId}`, 20, 300);
  if (!allowed) {
    logger.warn({ msg: '[doc] PHI scan rate limit exceeded', userId });
    return {
      error: `Too many uploads in a short period. Please wait ${resetInSeconds} seconds and try again.`,
    };
  }

  // 3. Scan for PHI
  let phiResult;
  try {
    phiResult = await scanText(textContent);
  } catch (e) {
    logger.error({ msg: '[doc] PHI scan error', err: e });
    return {
      error: 'We could not verify this document for PHI. Please try again in a moment.',
    };
  }

  // Compliance product: never store a document we could not confirm is
  // PHI-free. A scan that failed to complete is blocked with a distinct,
  // retry-able message; a genuine PHI detection is blocked with a clear reason.
  if (phiResult.scanFailed) {
    logger.warn({ msg: '[doc] Upload blocked — PHI scan could not complete', userId });
    return {
      error: 'We could not verify this document for PHI. Please try again in a moment.',
    };
  }

  if (phiResult.hasPHI) {
    logger.warn({ msg: '[doc] Upload blocked — PHI detected', userId });
    return {
      error: 'This document appears to contain PHI (e.g. SSN/DOB/MRN) and cannot be uploaded.',
      phiDetected: true,
    };
  }

  // 4. Upload to cloud storage (GCS → MinIO fallback)
  let storagePath: string;
  try {
    storagePath = await saveFile(file, userId);
  } catch (err: unknown) {
    const e = err as Error;
    logger.error({ msg: 'File storage upload failed', err: e.message, userId });
    return { error: 'Upload failed: could not store the file. Please try again.' };
  }

  // 5. Persist metadata in DB (transactional)
  try {
    const uploadedDocumentId = await prisma.$transaction(async (tx) => {
      const existingDoc = await tx.document.findFirst({
        where: { userId, filename: file.name },
      });

      let docId = existingDoc?.id;
      let versionNumber = 1;

      if (existingDoc) {
        const latestVersion = await tx.documentVersion.findFirst({
          where: { documentId: existingDoc.id },
          orderBy: { version: 'desc' },
        });
        versionNumber = (latestVersion?.version || 0) + 1;
      } else {
        const newDoc = await tx.document.create({
          data: {
            userId,
            filename: file.name,
            originalName: file.name,
            mimeType: file.type,
            size: file.size,
          },
        });
        docId = newDoc.id;
      }

      const version = await tx.documentVersion.create({
        data: {
          documentId: docId!,
          version: versionNumber,
          storagePath,
          hash,
          content: textContent,
        },
      });

      // F-003: `phiResult.findings` is the value-free shape ({ type, offsetStart,
      // offsetEnd, confidence }) — raw PHI/PII strings are NEVER persisted.
      await tx.phiReport.create({
        data: {
          documentVersionId: version.id,
          hasPHI: phiResult.hasPHI,
          detectedEntities: phiResult.findings as unknown as Prisma.InputJsonValue,
          scannerVersion: 'v2',
        },
      });

      return docId!;
    });

    logger.info({
      msg: '[doc] Document uploaded successfully',
      userId,
      filename: file.name,
      size: file.size,
      hasPHI: phiResult.hasPHI,
    });

    // F-001: record the sensitive mutation on the authorized, successful path.
    await audit({
      action: 'document.upload',
      actorId: userId,
      actorRole: session.user.role,
      organizationId: session.user.organizationId,
      targetType: 'document',
      targetId: uploadedDocumentId,
      metadata: { size: file.size, mimeType: file.type },
      ...getClientContext(await headers()),
    });

    revalidatePath('/dashboard/documents');
    return { success: true, phiDetected: phiResult.hasPHI };
  } catch (err: unknown) {
    const e = err as Error;
    logger.error({
      msg: 'DB transaction failed after successful upload',
      err: e.message,
      storagePath,
    });
    // Best-effort cleanup: remove orphaned object from storage
    deleteFile(storagePath).catch((cleanupErr: unknown) => {
      logger.error({
        msg: 'Failed to clean up orphaned storage object',
        err: cleanupErr,
        storagePath,
      });
    });
    return { error: 'Upload failed. Please try again.' };
  }
}

export async function getDocuments() {
  const session = await auth();
  if (!session?.user?.id) {
    return [];
  }

  const docs = await prisma.document.findMany({
    where: { userId: session.user.id },
    include: {
      versions: {
        orderBy: { version: 'desc' },
        take: 1,
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  return docs;
}

/**
 * Delete a document and all its versions, including the stored objects.
 * Cascade in the DB schema handles DocumentVersion and PhiReport deletion.
 */
export async function deleteDocument(
  documentId: string,
): Promise<{ success?: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: 'Not authenticated' };
  }

  // Verify ownership before any destructive operation
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      versions: { select: { id: true, storagePath: true } },
    },
  });

  if (!doc || doc.userId !== session.user.id) {
    return { error: 'Document not found' };
  }

  // Delete each stored object from cloud storage before removing DB records.
  // Failures are logged but do not abort the DB delete — orphaned objects
  // are preferable to an inconsistent DB state.
  const storageDeleteJobs = doc.versions.map((v) =>
    deleteFile(v.storagePath).catch((err: unknown) => {
      logger.error({
        msg: 'Failed to delete storage object during document deletion',
        err,
        storagePath: v.storagePath,
        documentId,
      });
    }),
  );
  await Promise.allSettled(storageDeleteJobs);

  // Remove DB record (cascade deletes versions + PHI reports)
  await prisma.document.delete({ where: { id: documentId } });

  logger.info({
    msg: '[doc] Document deleted',
    documentId,
    userId: session.user.id,
    versionCount: doc.versions.length,
  });

  // F-001: record the sensitive mutation on the authorized, successful path.
  await audit({
    action: 'document.delete',
    actorId: session.user.id,
    actorRole: session.user.role,
    organizationId: session.user.organizationId ?? undefined,
    targetType: 'document',
    targetId: documentId,
    metadata: { versionCount: doc.versions.length },
    ...getClientContext(await headers()),
  });

  revalidatePath('/dashboard/documents');
  return { success: true };
}

/**
 * Rename a document by updating its filename field.
 * Only the owning user may rename their document.
 */
export async function renameDocument(
  documentId: string,
  newFilename: string,
): Promise<{ success?: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: 'Not authenticated' };
  }

  const trimmed = newFilename.trim();
  if (!trimmed) {
    return { error: 'Filename cannot be empty.' };
  }
  if (trimmed.length > 255) {
    return { error: 'Filename is too long (max 255 characters).' };
  }

  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { userId: true },
  });

  if (!doc || doc.userId !== session.user.id) {
    return { error: 'Document not found' };
  }

  await prisma.document.update({
    where: { id: documentId },
    data: { filename: trimmed, updatedAt: new Date() },
  });

  logger.info({
    msg: '[doc] Document renamed',
    documentId,
    userId: session.user.id,
    newFilename: trimmed,
  });
  revalidatePath('/dashboard/documents');
  return { success: true };
}
