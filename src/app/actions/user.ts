'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

export async function updateRole(role: 'admin' | 'worker') {
    const session = await auth();
    if (!session?.user?.email) {
        throw new Error('Not authenticated');
    }

    try {
        await prisma.profile.update({
            where: { email: session.user.email },
            data: { role },
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
        throw new Error('Not authenticated');
    }

    try {
        await prisma.profile.update({
            where: { email: session.user.email },
            data: {
                firstName: data.first_name,
                lastName: data.last_name,
                companyName: data.company_name,
                fullName: `${data.first_name} ${data.last_name}`
            }
        });

        revalidatePath('/dashboard/profile');
        return { success: true };
    } catch (error) {
        console.error('Failed to update profile:', error);
        return { success: false, error: 'Failed to update profile' };
    }
}
