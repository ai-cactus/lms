import React from 'react';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import DashboardLayoutClient from '@/components/dashboard/DashboardLayoutClient';
import OrganizationActivationModal from '@/components/dashboard/OrganizationActivationModal';

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth();

    if (!session?.user?.email) {
        redirect('/login');
    }

    // Fetch profile role. Note: We use findUnique on email since we added @unique to Profile.email
    // Or we use id if we set user.id in session (which we did in auth.ts callbacks)
    const profile = await prisma.profile.findUnique({
        where: { id: session.user.id },
        select: { fullName: true }
    });

    // Fetch fresh user data from DB to get current organizationId (session may be stale after onboarding)
    const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { organizationId: true, role: true }
    });

    const fullName = profile?.fullName || session.user.name || session.user.email || 'User';
    // User role should be in session or fetched from User model if needed. 
    // For now we rely on session.
    // User role should be in session or fetched from User model if needed. 
    // For now we rely on session.
    const role = user?.role || session.user.role;
    const organizationId = user?.organizationId; // Fetch from DB for freshest data

    return (
        <>
            <OrganizationActivationModal hasOrganization={!!organizationId} />
            <DashboardLayoutClient
                userEmail={session.user.email || ''}
                fullName={fullName}
                role={role || undefined}
            >
                {children}
            </DashboardLayoutClient>
        </>
    );
}
