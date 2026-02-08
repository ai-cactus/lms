'use server';

import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';
import { revalidatePath } from 'next/cache';

// --- Staff Management ---

export async function getStaffUsers() {
    const session = await auth();
    if (!session?.user) {
        throw new Error('Unauthorized');
    }

    try {
        const users = await prisma.user.findMany({
            where: {
                role: { not: 'admin' }
            },
            include: {
                profile: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        return users.map(user => ({
            id: user.id,
            name: user.profile?.fullName || user.email.split('@')[0],
            email: user.email,
            avatarUrl: user.profile?.avatarUrl || null,
            role: user.role || 'worker',
            jobTitle: user.profile?.jobTitle || 'Staff Member',
            dateInvited: user.createdAt,
        }));
    } catch (error) {
        console.error('Failed to fetch staff users:', error);
        return [];
    }
}

// --- Onboarding / Profile Management ---

export async function updateRole(role: 'admin' | 'worker') {
    const session = await auth();

    if (!session?.user?.email || !session?.user?.id) {
        return { success: false, error: 'Not authenticated' };
    }

    try {
        // Update User role
        await prisma.user.update({
            where: {
                email: session.user.email,
            },
            data: { role }
        });

        revalidatePath('/dashboard');
        return { success: true };
    } catch (error) {
        console.error('Failed to update role:', error);
        return { success: false, error: 'Failed to update role' };
    }
}

export async function updateProfile(data: {
    first_name: string;
    last_name: string;
    company_name?: string;
}) {
    const session = await auth();

    if (!session?.user?.email) {
        return { success: false, error: 'Not authenticated' };
    }

    try {
        const fullName = `${data.first_name} ${data.last_name}`.trim();

        await prisma.profile.update({
            where: {
                email: session.user.email,
            },
            data: {
                firstName: data.first_name,
                lastName: data.last_name,
                fullName: fullName,
                companyName: data.company_name,
            },
        });

        revalidatePath('/dashboard/profile');
        return { success: true };
    } catch (error) {
        console.error('Failed to update profile:', error);
        return { success: false, error: 'Failed to update profile' };
    }
}
