import React from 'react';
import { auth } from '@/auth.worker';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import WorkerDashboardLayout from '@/components/worker/WorkerDashboardLayout';
import { WorkerSessionProvider } from '@/components/providers/WorkerSessionProvider';


export default async function WorkerLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth();

    if (!session?.user?.email) {
        redirect('/login-worker');
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
    console.log('[WorkerLayout] Rendering for user:', session.user.email, 'Role:', role);
    const organizationId = user?.organizationId;

    if (!organizationId) {
        redirect('/onboarding-worker');
    }

    return (
        <WorkerSessionProvider>
            <WorkerDashboardLayout
                userEmail={session.user.email || ''}
                fullName={fullName}
            >
                {children}
            </WorkerDashboardLayout>
        </WorkerSessionProvider>
    );
}
