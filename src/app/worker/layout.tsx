import React from 'react';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import WorkerDashboardLayout from '@/components/worker/WorkerDashboardLayout';
import OrganizationActivationModal from '@/components/dashboard/OrganizationActivationModal';

export default async function WorkerLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth();

    if (!session?.user?.email) {
        redirect('/login');
    }

    // Fetch profile for full name
    const profile = await prisma.profile.findUnique({
        where: { id: session.user.id },
        select: { fullName: true }
    });

    // Fetch fresh user data
    const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { organizationId: true, role: true }
    });

    const fullName = profile?.fullName || session.user.name || session.user.email || 'User';
    const role = user?.role || session.user.role;
    const organizationId = user?.organizationId;

    return (
        <>
            <OrganizationActivationModal hasOrganization={!!organizationId} />
            <WorkerDashboardLayout
                userEmail={session.user.email || ''}
                fullName={fullName}
            >
                {children}
            </WorkerDashboardLayout>
        </>
    );
}
