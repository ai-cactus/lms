'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { z } from 'zod';

const createOrgSchema = z.object({
    name: z.string().min(2, "Organization name must be at least 2 characters"),
});

export type State = {
    error?: string;
    success?: boolean;
};

export async function createOrganization(prevState: State, formData: FormData): Promise<State> {
    const session = await auth();
    if (!session?.user?.id) {
        return { error: "Not authenticated" };
    }

    const validatedFields = createOrgSchema.safeParse({
        name: formData.get('name'),
    });

    if (!validatedFields.success) {
        return { error: validatedFields.error.flatten().fieldErrors.name?.[0] || "Invalid input" };
    }

    const { name } = validatedFields.data;
    const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-') + '-' + Math.random().toString(36).substring(2, 7);

    try {
        await prisma.$transaction(async (tx) => {
            // Create Organization
            const org = await tx.organization.create({
                data: {
                    name,
                    slug,
                    // Connect the user implicitly via the relation update below? 
                    // No, organization.users is a relation. We update the user side.
                },
            });

            // Update User
            await tx.user.update({
                where: { id: session.user.id },
                data: {
                    organizationId: org.id,
                    role: 'admin',
                },
            });
        });
    } catch (error) {
        console.error("Failed to create organization:", error);
        return { error: "Failed to create organization. Please try again." };
    }

    // Redirect must be outside try/catch in Next.js server actions
    redirect('/dashboard');
}
