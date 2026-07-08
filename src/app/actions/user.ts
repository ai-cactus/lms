'use server';

import prisma from '@/lib/prisma';
import { auth as adminAuth } from '@/auth';
import { auth as workerAuth } from '@/auth.worker';
import { revalidatePath } from 'next/cache';

import { headers } from 'next/headers';
import { logger } from '@/lib/logger';
import bcrypt from 'bcryptjs';

// Helper: resolve the active session from either auth instance
async function resolveSession() {
  const headersList = await headers();
  const referer = headersList.get('referer');
  const isWorkerRoute = referer?.includes('/worker');

  if (isWorkerRoute) {
    const worker = await workerAuth();
    if (worker?.user?.id) return worker;
  } else {
    const admin = await adminAuth();
    if (admin?.user?.id) return admin;
  }

  // Fallback if referer doesn't help or we are outside known bounds
  const [admin, worker] = await Promise.all([adminAuth(), workerAuth()]);
  return admin?.user?.id ? admin : worker?.user?.id ? worker : null;
}

// --- Staff Management ---

export async function getStaffUsers() {
  const session = await resolveSession();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { organizationId: true },
  });

  if (!currentUser?.organizationId) {
    return [];
  }

  try {
    const [users, invites] = await Promise.all([
      prisma.user.findMany({
        where: {
          organizationId: currentUser.organizationId,
          // Show every seat-consuming staff member (all roles except owner).
          role: { not: 'owner' },
        },
        include: { profile: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.invite.findMany({
        where: {
          organizationId: currentUser.organizationId,
          status: 'pending',
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const now = new Date();

    // Build a set of emails that already have accounts to avoid duplication
    const acceptedEmails = new Set(users.map((u) => u.email.toLowerCase()));

    const acceptedEntries = users.map((user) => ({
      id: user.id,
      name: user.profile?.fullName || user.email.split('@')[0],
      email: user.email,
      avatarUrl: user.profile?.avatarUrl || null,
      role: user.role,
      jobTitle: user.profile?.jobTitle || 'Staff Member',
      dateInvited: user.createdAt,
      isPending: false,
      isExpired: false,
      token: null as string | null,
    }));

    const pendingEntries = invites
      .filter((invite) => !acceptedEmails.has(invite.email.toLowerCase()))
      .map((invite) => {
        const isExpired = invite.expiresAt <= now;
        return {
          id: invite.id,
          name: invite.email.split('@')[0],
          email: invite.email,
          avatarUrl: null,
          role: invite.role,
          jobTitle: isExpired ? 'Expired Invite' : 'Pending Invite',
          dateInvited: invite.createdAt,
          isPending: true,
          isExpired,
          token: invite.token as string | null,
        };
      });

    // Accepted users first, then pending invites (both already ordered desc by createdAt)
    return [...acceptedEntries, ...pendingEntries];
  } catch (error) {
    logger.error({ msg: 'Failed to fetch staff users and invites:', err: error });
    return [];
  }
}

export async function searchStaffUsers(query: string) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    return [];
  }

  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { organizationId: true },
  });

  if (!currentUser?.organizationId) {
    return [];
  }

  if (!query || query.length < 2) return [];

  try {
    const users = await prisma.user.findMany({
      where: {
        organizationId: currentUser.organizationId,
        role: { not: 'owner' },
        OR: [
          { email: { contains: query, mode: 'insensitive' } },
          { profile: { fullName: { contains: query, mode: 'insensitive' } } },
        ],
      },
      include: {
        profile: true,
      },
      take: 5,
    });

    return users.map((user) => ({
      id: user.id,
      name: user.profile?.fullName || user.email.split('@')[0],
      email: user.email,
      initials: (user.profile?.fullName || user.email).slice(0, 2).toUpperCase(),
      role: user.role,
    }));
  } catch (error) {
    logger.error({ msg: 'Failed to search staff:', err: error });
    return [];
  }
}

// --- Onboarding / Profile Management ---

export async function updateProfile(data: {
  first_name: string;
  last_name: string;
  company_name?: string;
  jobTitle?: string;
  avatarUrl?: string;
}) {
  const session = await resolveSession();

  if (!session?.user?.email) {
    logger.warn({ msg: '[user] updateProfile: not authenticated' });
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const fullName = `${data.first_name} ${data.last_name}`.trim();

    if (!session.user.id) {
      logger.warn({ msg: '[user] updateProfile: user ID missing', email: session.user.email });
      return { success: false, error: 'User ID missing' };
    }

    logger.info({ msg: '[user] Upserting profile', userId: session.user.id });
    const result = await prisma.profile.upsert({
      where: {
        id: session.user.id,
      },
      update: {
        firstName: data.first_name,
        lastName: data.last_name,
        fullName: fullName,
        companyName: data.company_name,
        jobTitle: data.jobTitle,
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
        jobTitle: data.jobTitle,
        avatarUrl: data.avatarUrl,
      },
    });

    logger.info({
      msg: '[user] Profile updated successfully',
      userId: session.user.id,
      profileId: result.id,
    });

    revalidatePath('/dashboard/profile');
    revalidatePath('/worker/profile');
    revalidatePath('/dashboard');
    revalidatePath('/worker');
    return { success: true };
  } catch (error: unknown) {
    const err = error as Error;
    logger.error({ msg: '[user] Failed to update profile', userId: session.user.id, err });
    return { success: false, error: 'Failed to update profile' };
  }
}

export async function uploadAvatar(formData: FormData) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    return { error: 'Not authenticated' };
  }

  const file = formData.get('file') as File;
  if (!file) {
    return { error: 'No file provided' };
  }

  if (!file.type.startsWith('image/')) {
    return { error: 'Invalid file type. Please upload an image.' };
  }

  // Validate file size (e.g., 5MB)
  if (file.size > 5 * 1024 * 1024) {
    return { error: 'File size too large. Max 5MB.' };
  }

  try {
    // Upload avatar to cloud storage — namespaced under avatars/ to separate from documents
    const { uploadFile } = await import('@/lib/storage');
    const buffer = Buffer.from(await file.arrayBuffer());
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
    const key = `avatars/${session.user.id}/${timestamp}-${safeName}`;
    const { storageUri } = await uploadFile(key, buffer, file.type || 'image/jpeg');

    // Return the storageUri as the avatar URL — the client stores this in profile.avatarUrl
    // and the signed URL is resolved when needed.
    return { success: true, url: storageUri };
  } catch (error) {
    logger.error({ msg: 'Failed to upload avatar:', err: error });
    return { error: 'Failed to upload avatar' };
  }
}

export async function changePassword(data: { currentPassword?: string; newPassword: string }) {
  const session = await resolveSession();
  if (!session?.user?.id) {
    return { success: false, error: 'Not authenticated' };
  }

  const { currentPassword, newPassword } = data;

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { password: true, authProvider: true },
    });

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Check if the user is using an OAuth provider (no password to change)
    if (user.authProvider !== 'credentials') {
      return { success: false, error: 'Cannot change password for OAuth accounts.' };
    }

    // Verify current password if user has one
    if (user.password) {
      if (!currentPassword) {
        return { success: false, error: 'Current password is required.' };
      }
      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid) {
        return { success: false, error: 'Incorrect current password.' };
      }
    }

    // Password strength is validated on the client, but we should do a basic check here
    if (newPassword.length < 12) {
      return { success: false, error: 'New password must be at least 12 characters long.' };
    }

    const hashedNewPassword = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        password: hashedNewPassword,
        passwordResetRequired: false,
      },
    });

    logger.info({ msg: 'User changed password successfully', userId: session.user.id });
    return { success: true };
  } catch (error) {
    logger.error({ msg: 'Failed to change password:', err: error });
    return { success: false, error: 'Failed to change password' };
  }
}
