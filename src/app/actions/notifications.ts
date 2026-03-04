'use server';

import { prisma } from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { revalidatePath } from 'next/cache';

// Helper: resolve the active session from either auth instance
async function resolveSession() {
    const [admin, worker] = await Promise.all([adminAuth(), workerAuth()]);
    return admin?.user?.id ? admin : worker?.user?.id ? worker : null;
}

/**
 * Fetch all notifications for the currently logged-in user.
 */
export async function getNotifications() {
    const session = await resolveSession();
    if (!session?.user?.id) {
        return { success: false, error: 'Unauthorized' };
    }

    try {
        const notifications = await prisma.notification.findMany({
            where: { userId: session.user.id },
            orderBy: { createdAt: 'desc' },
            take: 50, // Limit to 50 most recent for performance
        });

        // Compute unread count
        const unreadCount = notifications.filter(n => !n.isRead).length;

        return { success: true, notifications, unreadCount };
    } catch (error) {
        console.error('Failed to get notifications:', error);
        return { success: false, error: 'Failed to fetch notifications' };
    }
}

/**
 * Mark a specific notification as read.
 */
export async function markAsRead(notificationId: string) {
    const session = await resolveSession();
    if (!session?.user?.id) {
        return { success: false, error: 'Unauthorized' };
    }

    try {
        await prisma.notification.updateMany({
            where: {
                id: notificationId,
                userId: session.user.id // Ensure they own it
            },
            data: { isRead: true }
        });

        return { success: true };
    } catch (error) {
        console.error('Failed to mark read:', error);
        return { success: false, error: 'Failed to update' };
    }
}

/**
 * Mark all unread notifications for the user as read.
 */
export async function markAllAsRead() {
    const session = await resolveSession();
    if (!session?.user?.id) {
        return { success: false, error: 'Unauthorized' };
    }

    try {
        await prisma.notification.updateMany({
            where: {
                userId: session.user.id,
                isRead: false
            },
            data: { isRead: true }
        });

        return { success: true };
    } catch (error) {
        console.error('Failed to mark all as read:', error);
        return { success: false, error: 'Failed to update' };
    }
}

/**
 * Internal helper to create a notification. Not exposed directly to client.
 */
export async function createNotification(data: {
    userId: string;
    type: string;
    title: string;
    message: string;
    linkUrl?: string;
    metadata?: any;
}) {
    try {
        await prisma.notification.create({
            data: {
                userId: data.userId,
                type: data.type,
                title: data.title,
                message: data.message,
                linkUrl: data.linkUrl,
                metadata: data.metadata ? JSON.parse(JSON.stringify(data.metadata)) : undefined,
            }
        });
    } catch (error) {
        console.error('Failed to create notification:', error);
        // We don't throw here to avoid disrupting the main flow (like course assignment)
    }
}

/**
 * Create notification for all admins of a specific organization.
 */
export async function notifyOrganizationAdmins(organizationId: string, data: {
    type: string;
    title: string;
    message: string;
    linkUrl?: string;
    metadata?: any;
}) {
    try {
        const admins = await prisma.user.findMany({
            where: {
                organizationId: organizationId,
                role: 'admin'
            },
            select: { id: true }
        });

        if (admins.length === 0) return;

        await prisma.notification.createMany({
            data: admins.map(admin => ({
                userId: admin.id,
                type: data.type,
                title: data.title,
                message: data.message,
                linkUrl: data.linkUrl,
                metadata: data.metadata ? JSON.parse(JSON.stringify(data.metadata)) : undefined,
            }))
        });
    } catch (error) {
        console.error('Failed to notify admins:', error);
    }
}
