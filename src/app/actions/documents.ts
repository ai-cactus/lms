'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { saveFile } from '@/lib/documents/uploadHandler';
import { calculateHash } from '@/lib/documents/versioning';
import { scanText } from '@/lib/documents/phiScanner';
import { extractTextFromFile } from '@/lib/file-parser';
import { revalidatePath } from 'next/cache';

export async function uploadDocument(
  _prevState: { success?: boolean; error?: string; phiDetected?: boolean } | null,
  formData: FormData,
) {
  const session = await auth();
  if (!session?.user?.id || !session.user.organizationId) {
    return { error: 'Not authenticated or not in an organization' };
  }

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
    console.error('Text extraction failed:', e);
    return { error: `Extraction Failed: ${e.message || 'Could not read text from document.'}` };
  }

  // 3. Scan for PHI
  let phiResult;
  try {
    phiResult = await scanText(textContent);
  } catch (e) {
    console.error('PHI Scan Error:', e);
    return { error: 'Security Check Failed: Unable to scan document for PHI.' };
  }

  const rejectOnPHI = formData.get('rejectOnPHI') === 'true';
  if (phiResult.hasPHI && rejectOnPHI) {
    return { error: 'PHI Detected in document.', phiDetected: true };
  }

  try {
    // 4. Save File
    const storagePath = await saveFile(file);

    await prisma.$transaction(async (tx) => {
      // Check if document already exists
      const existingDoc = await tx.document.findFirst({
        where: {
          userId: session.user.id!,
          filename: file.name,
        },
      });

      let docId = existingDoc?.id;
      // Determine version number
      let versionNumber = 1;
      if (existingDoc) {
        const latestVersion = await tx.documentVersion.findFirst({
          where: { documentId: existingDoc.id },
          orderBy: { version: 'desc' },
        });
        versionNumber = (latestVersion?.version || 0) + 1;
      } else {
        // Create New Document
        const newDoc = await tx.document.create({
          data: {
            userId: session.user.id!,
            filename: file.name,
            originalName: file.name,
            mimeType: file.type,
            size: file.size,
          },
        });
        docId = newDoc.id;
      }

      // Create Version
      const version = await tx.documentVersion.create({
        data: {
          documentId: docId!,
          version: versionNumber,
          storagePath,
          hash,
          content: textContent,
        },
      });

      // Create PHI Report
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
  } catch (e) {
    console.error(e);
    return { error: 'Upload failed' };
  }
}

export async function getDocuments() {
  const session = await auth();
  if (!session?.user?.id) {
    return [];
  }

  // Get documents with their latest version info
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
