'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { revalidatePath } from 'next/cache';

// Helper to generate a random 6-digit code
function generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function generateOrganizationCode() {
    const session = await auth();

    if (!session?.user?.email || !session?.user?.organizationId) {
        return { success: false, error: 'Unauthorized' };
    }

    const orgId = session.user.organizationId;

    try {
        let code = generateCode();
        let isUnique = false;
        let attempts = 0;

        // Ensure uniqueness (though collision is unlikely for active codes)
        while (!isUnique && attempts < 5) {
            const existing = await prisma.organization.findUnique({
                where: { joinCode: code }
            });
            if (!existing) {
                isUnique = true;
            } else {
                code = generateCode();
                attempts++;
            }
        }

        if (!isUnique) {
            return { success: false, error: 'Failed to generate a unique code. Please try again.' };
        }

        // Set expiration to 6 hours from now
        const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000);

        await prisma.organization.update({
            where: { id: orgId },
            data: {
                joinCode: code,
                joinCodeExpiresAt: expiresAt
            }
        });

        revalidatePath('/dashboard/profile');
        return { success: true, code, expiresAt };
    } catch (error) {
        console.error('Failed to generate organization code:', error);
        return { success: false, error: `Failed to generate code: ${error instanceof Error ? error.message : String(error)}` };
    }
}

export async function getOrganizationCode() {
    const session = await auth();

    if (!session?.user?.email || !session?.user?.organizationId) {
        return { success: false, error: 'Unauthorized' };
    }

    try {
        const org = await prisma.organization.findUnique({
            where: { id: session.user.organizationId },
            select: { joinCode: true, joinCodeExpiresAt: true }
        });

        if (!org) return { success: false, error: 'Organization not found' };

        return {
            success: true,
            code: org.joinCode,
            expiresAt: org.joinCodeExpiresAt
        };
    } catch (error) {
        console.error('Failed to fetch organization code:', error);
        return { success: false, error: 'Failed to fetch code' };
    }
}

export async function verifyOrganizationCode(code: string) {
    try {
        const org = await prisma.organization.findUnique({
            where: { joinCode: code },
            select: {
                id: true,
                name: true,
                joinCodeExpiresAt: true,
                programServices: true,
                primaryBusinessType: true,
                country: true,
                phone: true,
                primaryContact: true
            }
        });

        if (!org) {
            return { success: false, error: 'Invalid code.' };
        }

        if (org.joinCodeExpiresAt && new Date() > org.joinCodeExpiresAt) {
            return { success: false, error: 'This code has expired.' };
        }

        return {
            success: true,
            organization: {
                id: org.id,
                name: org.name,
                type: org.primaryBusinessType,
                services: org.programServices,
                country: org.country,
                phone: org.phone,
                contactName: org.primaryContact
            }
        };
    } catch (error) {
        console.error('Failed to verify code:', error);
        return { success: false, error: 'Failed to verify code' };
    }
}

export async function joinOrganization(code: string) {
    const session = await auth();

    if (!session?.user?.email || !session?.user?.id) {
        return { success: false, error: 'Unauthorized' };
    }

    const userId = session.user.id;

    try {
        // Verify code again to be safe
        const verifyResult = await verifyOrganizationCode(code);
        if (!verifyResult.success || !verifyResult.organization) {
            return { success: false, error: verifyResult.error || 'Invalid code' };
        }

        const orgId = verifyResult.organization.id;

        // Update user to link to organization
        await prisma.user.update({
            where: { id: userId },
            data: {
                organizationId: orgId,
                role: 'worker' // Ensure role is worker
            }
        });

        return { success: true, organizationId: orgId };
    } catch (error) {
        console.error('Failed to join organization:', error);
        return { success: false, error: 'Failed to join organization' };
    }
}
