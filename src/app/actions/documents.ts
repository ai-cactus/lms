'use server';

import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { saveFile } from '@/lib/documents/uploadHandler';
import { calculateHash } from '@/lib/documents/versioning';
import { scanText } from '@/lib/documents/phiScanner';
import { recordPhiDecision, recordPhiDecisionInTransaction } from '@/lib/documents/phiDecision';
import { MAX_DOCUMENT_UPLOAD_BYTES } from '@/lib/documents/upload-config';
import { extractTextFromFile } from '@/lib/file-parser';
import { deleteFile } from '@/lib/storage';
import { checkRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { audit, getClientContext } from '@/lib/audit';
import { dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import { can } from '@/lib/rbac/permissions';
import { emitNotificationEvent } from '@/lib/notifications/emit';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { Prisma } from '@/generated/prisma/client';
import type { AuthSession } from '@/types/next-auth';

// Spec: only .pdf and .docx are accepted. The upload modal enforces this
// client-side; these mirror that server-side so a crafted request can't slip
// an unsupported type past validation.
const ALLOWED_DOCUMENT_EXTENSIONS = /\.(pdf|docx)$/i;
const ALLOWED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

/** The session fields the upload pipeline reads. */
type UploadSession = {
  user: Pick<
    AuthSession['user'],
    'id' | 'email' | 'role' | 'organizationId' | 'organizationUserId'
  >;
};

/** Outcome of one file — the shape the single-file action has always returned. */
interface SingleUploadResult {
  success?: boolean;
  error?: string;
  phiDetected?: boolean;
}

/** Per-file outcome of a batch upload. */
export interface DocumentUploadResult {
  name: string;
  ok: boolean;
  error?: string;
}

function readCategory(formData: FormData): string | undefined {
  const value = formData.get('category');
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export async function uploadDocument(
  _prevState: { success?: boolean; error?: string; phiDetected?: boolean } | null,
  formData: FormData,
) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId || !session.user.organizationUserId) {
    return { error: 'Not authenticated or not in an organization' };
  }

  const userId = session.user.id;

  // Registry gate: only roles granted `document.create` may upload (e.g. Finance
  // has no document access — it must not be able to seed the Document Hub).
  if (!can(dbRoleToRoleKey(session.user.role), 'document.create')) {
    logger.warn({
      msg: '[doc] Upload denied — missing document.create',
      userId,
      role: session.user.role,
    });
    return { error: 'You do not have permission to upload documents.' };
  }

  const file = formData.get('file') as File;
  if (!file) {
    return { error: 'No file provided' };
  }

  // #11: the caller must attest the document is PHI-free. The modal checkbox only
  // gates its submit button; this is the authoritative server-side gate. Fail
  // fast before any file processing.
  if (formData.get('phiAttested') !== 'true') {
    logger.warn({ msg: '[doc] Upload rejected — PHI attestation missing', userId });
    return {
      error: 'You must confirm this document contains no PHI (Personal Health Information).',
    };
  }

  const result = await processSingleUpload(file, session, readCategory(formData));
  if (result.success) {
    revalidatePath('/dashboard/documents');
  }

  return result;
}

/**
 * Upload several documents in one submission, sharing a single category.
 *
 * Files are processed SEQUENTIALLY: each one spends a token of the per-user
 * PHI-scan rate limit and is buffered whole in memory, so running the AI-backed
 * scans concurrently would both exhaust that budget and spike memory. A file
 * that fails is reported in its own row and never aborts the rest of the batch.
 */
export async function uploadDocuments(
  formData: FormData,
): Promise<{ results: DocumentUploadResult[]; error?: string }> {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId || !session.user.organizationUserId) {
    return { results: [], error: 'Not authenticated or not in an organization' };
  }

  const userId = session.user.id;

  if (!can(dbRoleToRoleKey(session.user.role), 'document.create')) {
    logger.warn({
      msg: '[doc] Batch upload denied — missing document.create',
      userId,
      role: session.user.role,
    });
    return { results: [], error: 'You do not have permission to upload documents.' };
  }

  const files = formData.getAll('files').filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) {
    return { results: [], error: 'No files provided' };
  }

  // Same authoritative attestation gate as the single-file path — a new upload
  // surface must not become a way around it.
  if (formData.get('phiAttested') !== 'true') {
    logger.warn({ msg: '[doc] Batch upload rejected — PHI attestation missing', userId });
    return {
      results: [],
      error: 'You must confirm these documents contain no PHI (Personal Health Information).',
    };
  }

  const category = readCategory(formData);
  const results: DocumentUploadResult[] = [];

  for (const file of files) {
    const outcome = await processSingleUpload(file, session, category);
    results.push({ name: file.name, ok: outcome.success === true, error: outcome.error });
  }

  const succeeded = results.filter((r) => r.ok).length;
  logger.info({
    msg: '[doc] Batch document upload processed',
    userId,
    total: files.length,
    succeeded,
  });

  if (succeeded > 0) {
    revalidatePath('/dashboard/documents');
  }

  return { results };
}

/**
 * Validate → extract → PHI-scan → store → persist ONE file, then notify.
 *
 * Shared by the single-file and batch actions so both run the identical
 * compliance pipeline. The caller owns authentication, the `document.create`
 * gate, the PHI attestation and cache revalidation.
 */
async function processSingleUpload(
  file: File,
  session: UploadSession,
  category?: string,
): Promise<SingleUploadResult> {
  const { id: userId, organizationId, organizationUserId } = session.user;
  if (!organizationId || !organizationUserId) {
    return { error: 'Not authenticated or not in an organization' };
  }

  // Server-side format guard: client validation is not a security boundary.
  // The filename extension is authoritative (a spoofed MIME type must not admit
  // a .doc as PDF); a declared MIME type, if present, must not contradict an
  // allowed one. Both signals must agree — a missing MIME type is permitted.
  const isAllowedType =
    ALLOWED_DOCUMENT_EXTENSIONS.test(file.name) &&
    (file.type === '' || ALLOWED_DOCUMENT_MIME_TYPES.includes(file.type));
  if (!isAllowedType) {
    logger.warn({
      msg: '[doc] Upload rejected — unsupported file type',
      userId,
      mimeType: file.type,
    });
    return { error: 'Only PDF and DOCX files are allowed.' };
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
  // F-092: record the decision BEFORE returning. A block leaves no
  // DocumentVersion and therefore no PhiReport, so without this the rejection
  // would exist only as a stdout warning — and "prove you rejected it" is the
  // question that actually matters.
  if (phiResult.scanFailed || phiResult.hasPHI) {
    await recordPhiDecision({
      source: 'document_upload',
      scan: phiResult,
      scannedText: textContent,
      filename: file.name,
      actorId: userId,
      organizationId,
    });
  }

  if (phiResult.scanFailed) {
    logger.warn({ msg: '[doc] Upload blocked — PHI scan could not complete', userId });
    return {
      error: 'We could not verify this document for PHI. Please try again in a moment.',
    };
  }

  if (phiResult.hasPHI) {
    logger.warn({
      msg: '[doc] Upload blocked — PHI detected',
      userId,
      decidedBy: phiResult.decidedBy,
    });
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
        where: { organizationUserId, filename: file.name },
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
            organizationUserId,
            filename: file.name,
            originalName: file.name,
            mimeType: file.type,
            size: file.size,
            category: category ?? null,
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

      // F-092: inside the transaction on purpose — the decision row and the
      // stored version commit or roll back together, so the ledger cannot be
      // missing a row for content that was accepted. Throws on failure, which
      // correctly fails the upload rather than storing unattested content.
      await recordPhiDecisionInTransaction(tx, {
        source: 'document_upload',
        scan: phiResult,
        scannedText: textContent,
        filename: file.name,
        documentVersionId: version.id,
        actorId: userId,
        organizationId,
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
      organizationId,
      targetType: 'document',
      targetId: uploadedDocumentId,
      metadata: { size: file.size, mimeType: file.type, category },
      ...getClientContext(await headers()),
    });
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

  // Notify the clinical/quality director (falling back to the owner). Kept
  // outside the block above so a notification-side failure can never trigger the
  // orphan cleanup and delete a document that was stored successfully.
  const uploader = await prisma.organizationUser
    .findUnique({
      where: { id: organizationUserId },
      select: {
        user: { select: { fullName: true } },
        facilities: { where: { active: true }, select: { facilityId: true }, take: 1 },
      },
    })
    .catch((err: unknown) => {
      logger.error({ msg: '[doc] Could not load uploader for upload notification', err, userId });
      return null;
    });
  const uploaderName = uploader?.user.fullName || session.user.email.split('@')[0];

  await emitNotificationEvent({
    organizationId,
    type: 'DOCUMENT_UPLOADED',
    title: 'New document uploaded',
    message: `${uploaderName} uploaded '${file.name}'.`,
    actor: { userId, role: session.user.role },
    facilityId: uploader?.facilities[0]?.facilityId ?? null,
    linkUrl: '/dashboard/documents',
    context: { documentTitle: file.name, uploaderName },
  });

  return { success: true, phiDetected: phiResult.hasPHI };
}

export async function getDocuments() {
  const session = await auth();
  // Org-scoped Document Hub: any role granted `document.read` sees every document
  // uploaded within their organization. The registry gate is defense-in-depth;
  // the tenancy boundary is the uploader's organizationId.
  if (
    !session?.user?.id ||
    !session.user.organizationId ||
    !can(dbRoleToRoleKey(session.user.role), 'document.read')
  ) {
    return [];
  }

  const docs = await prisma.document.findMany({
    where: { organizationUser: { organizationId: session.user.organizationId } },
    include: {
      organizationUser: {
        select: { user: { select: { email: true, firstName: true, lastName: true } } },
      },
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
  if (!session?.user?.id || !session.user.organizationId) {
    return { error: 'Not authenticated' };
  }
  if (!can(dbRoleToRoleKey(session.user.role), 'document.delete')) {
    logger.warn({
      msg: '[doc] Delete denied — missing document.delete',
      userId: session.user.id,
      role: session.user.role,
    });
    return { error: 'Document not found' };
  }

  // Verify the document belongs to the caller's organization before any
  // destructive operation. Any authorized role may delete any org document; a
  // cross-org document is reported as not found — never leak its existence.
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      organizationUser: { select: { organizationId: true } },
      versions: { select: { id: true, storagePath: true } },
    },
  });

  if (!doc || doc.organizationUser.organizationId !== session.user.organizationId) {
    return { error: 'Document not found' };
  }

  const versionIds = doc.versions.map((v) => v.id);

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

  // Sever course lineage first: CourseVersion→DocumentVersion is a Restrict
  // relation, so course-backed documents would otherwise be undeletable. The
  // course itself survives — only its source-document link is removed, and the
  // UI already renders "View Source Document" disabled when lineage is gone.
  await prisma.$transaction([
    prisma.courseVersion.deleteMany({ where: { documentVersionId: { in: versionIds } } }),
    // Remove DB record (cascade deletes versions + PHI reports)
    prisma.document.delete({ where: { id: documentId } }),
  ]);

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
  if (!session?.user?.id || !session.user.organizationId) {
    return { error: 'Not authenticated' };
  }
  if (!can(dbRoleToRoleKey(session.user.role), 'document.edit')) {
    logger.warn({
      msg: '[doc] Rename denied — missing document.edit',
      userId: session.user.id,
      role: session.user.role,
    });
    return { error: 'Document not found' };
  }

  const trimmed = newFilename.trim();
  if (!trimmed) {
    return { error: 'Filename cannot be empty.' };
  }
  if (trimmed.length > 255) {
    return { error: 'Filename is too long (max 255 characters).' };
  }

  // Any org admin may rename any document in their organization; a cross-org
  // document is reported as not found so its existence is never leaked.
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { organizationUser: { select: { organizationId: true } } },
  });

  if (!doc || doc.organizationUser.organizationId !== session.user.organizationId) {
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
