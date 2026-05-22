'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { saveFile } from '@/lib/documents/uploadHandler';
import { calculateHash } from '@/lib/documents/versioning';
import { scanText } from '@/lib/documents/phiScanner';
import { extractTextFromFile } from '@/lib/file-parser';
import { deleteFile } from '@/lib/storage';
import { logger } from '@/lib/logger';
import { revalidatePath } from 'next/cache';

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

  // 3. Scan for PHI
  let phiResult;
  try {
    phiResult = await scanText(textContent);
  } catch (e) {
    logger.error({ msg: 'PHI scan error', err: e });
    return { error: 'Security Check Failed: Unable to scan document for PHI.' };
  }

  const rejectOnPHI = formData.get('rejectOnPHI') === 'true';
  if (phiResult.hasPHI && rejectOnPHI) {
    return { error: 'PHI Detected in document.', phiDetected: true };
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
    await prisma.$transaction(async (tx) => {
      // Check if document already exists for this user with the same filename
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

      // Create new version record
      const version = await tx.documentVersion.create({
        data: {
          documentId: docId!,
          version: versionNumber,
          storagePath,
          hash,
          content: textContent,
        },
      });

      // Create PHI report for this version
      await tx.phiReport.create({
        data: {
          documentVersionId: version.id,
          hasPHI: phiResult.hasPHI,
          detectedEntities: phiResult.findings as unknown as Prisma.InputJsonValue,
        },
      });
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

  revalidatePath('/dashboard/documents');
  return { success: true };
}
