'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { createJob } from '@/lib/jobs';
import { revalidatePath } from 'next/cache';

export async function generateCourseFromDocument(documentVersionId: string) {
    const session = await auth();
    if (!session?.user?.id) return { error: "Not authenticated" };

    // Verify ownership
    const docVer = await prisma.documentVersion.findUnique({
        where: { id: documentVersionId },
        include: { document: true }
    });

    if (!docVer || docVer.document.userId !== session.user.id) {
        return { error: "Document not found or unauthorized" };
    }

    try {
        await createJob('GENERATE_DRAFT', {
            documentVersionId,
            userId: session.user.id
        });

        revalidatePath('/dashboard/courses/queue');
        return { success: true };
    } catch (e) {
        return { error: "Failed to queue job" };
    }
}
