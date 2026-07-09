'use server';

import { auth } from '@/auth';
import { uploadFile, deleteFile, parseStorageUri } from '@/lib/storage';
import { logger } from '@/lib/logger';

/**
 * Onboarding compliance-document handling.
 *
 * Step 2 of the wizard runs BEFORE the org/facility exists, so uploaded bytes
 * are parked under a per-user `onboarding/{userId}/` storage prefix and their
 * metadata is stashed in the client's localStorage draft. `completeOnboarding`
 * later creates the `FacilityDocument` rows that link them to the new facility.
 */

const MAX_ONBOARDING_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB

export interface OnboardingDocumentMeta {
  url: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
}

type UploadResult =
  | { success: true; document: OnboardingDocumentMeta }
  | { success: false; error: string };

export async function uploadOnboardingDocument(formData: FormData): Promise<UploadResult> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return { success: false, error: 'No file provided' };
  }

  if (file.size > MAX_ONBOARDING_DOCUMENT_BYTES) {
    return { success: false, error: 'File size too large. Max 10MB.' };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
    const key = `onboarding/${session.user.id}/${timestamp}-${safeName}`;
    const mimeType = file.type || 'application/octet-stream';
    const { storageUri } = await uploadFile(key, buffer, mimeType);

    logger.info({
      msg: '[onboarding] Compliance document uploaded to temp storage',
      userId: session.user.id,
      sizeBytes: file.size,
    });

    return {
      success: true,
      document: { url: storageUri, name: file.name, sizeBytes: file.size, mimeType },
    };
  } catch (error) {
    logger.error({ msg: '[onboarding] Failed to upload compliance document', err: error });
    return { success: false, error: 'Failed to upload document' };
  }
}

export async function deleteOnboardingDocument(
  storageUri: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    // Restrict deletion to the caller's own onboarding prefix — a user must
    // never be able to delete another tenant's parked upload.
    const { key } = parseStorageUri(storageUri);
    if (!key.startsWith(`onboarding/${session.user.id}/`)) {
      logger.warn({
        msg: '[onboarding] Rejected delete outside caller onboarding prefix',
        userId: session.user.id,
      });
      return { success: false, error: 'Unauthorized' };
    }

    await deleteFile(storageUri);
    logger.info({ msg: '[onboarding] Temp compliance document deleted', userId: session.user.id });
    return { success: true };
  } catch (error) {
    logger.error({ msg: '[onboarding] Failed to delete compliance document', err: error });
    return { success: false, error: 'Failed to delete document' };
  }
}
