'use server';

import { prisma } from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { revalidatePath } from 'next/cache';

import { headers } from 'next/headers';

// Helper: resolve the active session from either auth instance
async function resolveSession() {
    const headersList = await headers();
    const referer = headersList.get('referer');
    const isWorkerRoute = referer?.includes('/worker');

    if (isWorkerRoute) {
        try { const worker = await workerAuth(); if (worker?.user?.id) return worker; } catch { /* no session */ }
    } else {
        try { const admin = await adminAuth(); if (admin?.user?.id) return admin; } catch { /* no session */ }
    }

    // Fallback if referer doesn't help or we are outside known bounds
    let admin = null;
    let worker = null;
    try { admin = await adminAuth(); } catch { /* no admin session */ }
    try { worker = await workerAuth(); } catch { /* no worker session */ }
    return admin?.user?.id ? admin : worker?.user?.id ? worker : null;
}

// --- Staff Management ---

export async function getStaffUsers() {
    const session = await resolveSession();
    if (!session?.user?.id) {
        throw new Error('Unauthorized');
    }

    // Get current user's org ID
    const currentUser = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { organizationId: true }
    });

    if (!currentUser?.organizationId) {
        return [];
    }

    try {
        const users = await prisma.user.findMany({
            where: {
                organizationId: currentUser.organizationId,
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

export async function searchStaffUsers(query: string) {
    const session = await resolveSession();
    if (!session?.user?.id) {
        return [];
    }

    // Get current user's org ID
    const currentUser = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { organizationId: true }
    });

    if (!currentUser?.organizationId) {
        return [];
    }

    if (!query || query.length < 2) return [];

    try {
        const users = await prisma.user.findMany({
            where: {
                organizationId: currentUser.organizationId,
                role: { not: 'admin' },
                OR: [
                    { email: { contains: query, mode: 'insensitive' } },
                    { profile: { fullName: { contains: query, mode: 'insensitive' } } }
                ]
            },
            include: {
                profile: true,
            },
            take: 5
        });

        return users.map(user => ({
            id: user.id,
            name: user.profile?.fullName || user.email.split('@')[0],
            email: user.email,
            initials: (user.profile?.fullName || user.email).slice(0, 2).toUpperCase(),
            role: user.role || 'worker',
        }));
    } catch (error) {
        console.error('Failed to search staff:', error);
        return [];
    }
}

// --- Onboarding / Profile Management ---

export async function updateRole(role: 'admin' | 'worker') {
    const session = await resolveSession();

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
    avatarUrl?: string; // New field
}) {
    console.log('[UpdateProfile Action] Called with data:', data);
    const session = await resolveSession();
    console.log('[UpdateProfile Action] Session:', session?.user?.id);

    if (!session?.user?.email) {
        console.log('[UpdateProfile Action] Failed: Not authenticated');
        return { success: false, error: 'Not authenticated' };
    }

    try {
        const fullName = `${data.first_name} ${data.last_name}`.trim();

        if (!session.user.id) {
            console.log('[UpdateProfile Action] Failed: User ID missing');
            return { success: false, error: 'User ID missing' };
        }

        console.log(`[UpdateProfile Action] Upserting profile for user ${session.user.id}...`);
        const result = await prisma.profile.upsert({
            where: {
                id: session.user.id,
            },
            update: {
                firstName: data.first_name,
                lastName: data.last_name,
                fullName: fullName,
                companyName: data.company_name,
                email: session.user.email,
                avatarUrl: data.avatarUrl,
            },
            create: {
                id: session.user.id,
                email: session.user.email,
                firstName: data.first_name,
                lastName: data.last_name,
                fullName: fullName,
                companyName: data.company_name,
                avatarUrl: data.avatarUrl,
            },
        });

        console.log('[UpdateProfile Action] Upsert successful:', result);

        revalidatePath('/dashboard/profile');
        revalidatePath('/worker/profile');
        console.log('[UpdateProfile Action] Paths revalidated');
        return { success: true };
    } catch (error) {
        console.error('[UpdateProfile Action] Failed to update profile:', error);
        return { success: false, error: 'Failed to update profile' };
    }
}

export async function uploadAvatar(formData: FormData) {
    const session = await resolveSession();
    if (!session?.user?.id) {
        return { error: "Not authenticated" };
    }

    const file = formData.get('file') as File;
    if (!file) {
        return { error: "No file provided" };
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
        return { error: "Invalid file type. Please upload an image." };
    }

    // Validate file size (e.g., 5MB)
    if (file.size > 5 * 1024 * 1024) {
        return { error: "File size too large. Max 5MB." };
    }

    try {
        const { saveFile } = await import('@/lib/documents/uploadHandler');
        const publicUrl = await saveFile(file);
        return { success: true, url: publicUrl };
    } catch (error) {
        console.error('Failed to upload avatar:', error);
        return { error: "Failed to upload avatar" };
    }
}
