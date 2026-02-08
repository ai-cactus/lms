'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { suggestMappings } from '@/lib/mapping';
import { revalidatePath } from 'next/cache';

export async function getMappingSuggestions(text: string) {
    return await suggestMappings(text);
}

export async function saveMapping(documentVersionId: string, standardId: string, snippet: string, justification: string) {
    const session = await auth();
    if (!session?.user?.id) return { error: "Not authenticated" };

    try {
        await prisma.mappingEvidence.create({
            data: {
                documentVersionId,
                standardId,
                snippet,
                justification,
                status: 'pending'
            }
        });
        revalidatePath(`/dashboard/courses`); // broadly revalidate for now
        return { success: true };
    } catch (e) {
        return { error: "Failed to save mapping" };
    }
}
