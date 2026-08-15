'use server';

import { auth } from '@/auth';
import prisma from '@/lib/prisma';
import { getSignedUrl, isLegacyPath } from '@/lib/storage';
import { can } from '@/lib/rbac/permissions';
import { dbRoleToRoleKey } from '@/lib/rbac/role-utils';
import { logger } from '@/lib/logger';

const SIGNED_URL_EXPIRY_SECONDS = 900; // 15 minutes

/**
 * Generate a short-lived (15 min) signed URL for a document version's stored file.
 *
 * The signed URL is generated server-side and handed directly to the browser —
 * no proxy stream needed. The browser fetches the file straight from GCS/MinIO
 * with the token embedded in the URL.
 *
 * Returns { url } on success, or { error } on failure.
 *
 * @param documentVersionId  The ID of the DocumentVersion to get a URL for.
 */
export async function getDocumentSignedUrl(
  documentVersionId: string,
): Promise<{ url?: string; error?: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: 'Not authenticated' };
  }

  // Fetch the version and verify access via the parent document: the uploader
  // always may read their own file; any same-org member holding document.read
  // (the documents-page gate) may read the rest. Cross-org stays "not found".
  const version = await prisma.documentVersion.findUnique({
    where: { id: documentVersionId },
    include: {
      document: {
        select: {
          organizationUserId: true,
          organizationUser: { select: { organizationId: true } },
        },
      },
    },
  });

  const isUploader = version?.document.organizationUserId === session.user.organizationUserId;
  const isSameOrgReader =
    version?.document.organizationUser?.organizationId === session.user.organizationId &&
    can(dbRoleToRoleKey(session.user.role), 'document.read');

  if (!version || (!isUploader && !isSameOrgReader)) {
    return { error: 'Document not found' };
  }

  const { storagePath } = version;

  // Legacy local paths (pre-migration) — return as-is so old docs still render
  if (isLegacyPath(storagePath)) {
    return { url: storagePath };
  }

  try {
    const url = await getSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS);
    return { url };
  } catch (err: unknown) {
    const e = err as Error;
    logger.error({
      msg: 'Failed to generate signed URL',
      err: e.message,
      documentVersionId,
      storagePath,
    });
    return { error: 'Could not generate a secure link for this document. Please try again.' };
  }
}
