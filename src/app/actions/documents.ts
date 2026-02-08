'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { saveFile } from '@/lib/documents/uploadHandler';
import { calculateHash } from '@/lib/documents/versioning';
import { scanText } from '@/lib/documents/phiScanner';
import { revalidatePath } from 'next/cache';

export async function uploadDocument(prevState: any, formData: FormData) {
    const session = await auth();
    if (!session?.user?.id || !session.user.organizationId) {
        return { error: "Not authenticated or not in an organization" };
    }

    const file = formData.get('file') as File;
    if (!file) {
        return { error: "No file provided" };
    }

    // 1. Calculate Hash & Check Duplicates (Conceptually)
    // For MVP, we just proceed.
    const buffer = Buffer.from(await file.arrayBuffer());
    const hash = await calculateHash(buffer);

    // 2. Scan for PHI (Mocking text extraction for now)
    // Real implementation needs parsing (PDF/Docx -> Text).
    // Here we just use the filename or empty string if binary.
    // NOTE: This 'scanText' is placeholder.
    const mockTextContent = file.type === 'text/plain' ? await file.text() : `Scanned content of ${file.name}`;
    const phiResult = await scanText(mockTextContent);

    if (phiResult.hasPHI) {
        // Ideally we block or warn. For now, we save but flag it.
        // return { error: "PHI Detected: " + JSON.stringify(phiResult.findings) }; 
        // Let's proceed but return warning? Actions usually return state.
        // I'll assume we proceed but save the report.
    }

    try {
        // 3. Save File
        const storagePath = await saveFile(file);

        await prisma.$transaction(async (tx) => {
            // Create Document Parent
            const doc = await tx.document.create({
                data: {
                    userId: session.user.id!,
                    // We should verify if organization model has documents relation?
                    // Schema showed Document->User. User->Organization.
                    // It is implicitly owned by Organization via User.
                    filename: file.name,
                    originalName: file.name,
                    mimeType: file.type,
                    size: file.size,
                }
            });

            // Create Version
            const version = await tx.documentVersion.create({
                data: {
                    documentId: doc.id,
                    version: 1,
                    storagePath,
                    hash,
                    content: mockTextContent,
                }
            });

            // Create PHI Report
            // Create PHI Report
            await tx.phiReport.create({
                data: {
                    documentVersionId: version.id,
                    hasPHI: phiResult.hasPHI,
                    detectedEntities: phiResult.findings as any, // Cast JSON
                }
            });
        });

        revalidatePath('/dashboard/documents');
        return { success: true, phiDetected: phiResult.hasPHI };

    } catch (e) {
        console.error(e);
        return { error: "Upload failed" };
    }
}
