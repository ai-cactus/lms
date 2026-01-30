import React from 'react';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import DashboardLayoutClient from '@/components/dashboard/DashboardLayoutClient';

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
        select: { role: true, fullName: true }
    });

    const role = profile?.role;
    const fullName = profile?.fullName || session.user.name || session.user.email || 'User';

    return (
        <DashboardLayoutClient
            userEmail={session.user.email || ''}
            fullName={fullName}
            role={role || undefined}
        >
            {children}
        </DashboardLayoutClient>
    );
}
