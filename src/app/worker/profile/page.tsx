import React from 'react';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import WorkerProfileForm from '@/components/worker/WorkerProfileForm';

export default async function WorkerProfilePage() {
    const session = await auth();

    if (!session?.user?.id) {
        redirect('/login');
    }

    // Fetch user with profile and organization
    const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        include: {
            profile: true,
            organization: true
        }
    });

    if (!user) {
        redirect('/login');
    }

    const userData = {
        id: user.id,
        first_name: user.profile?.firstName || '',
        last_name: user.profile?.lastName || '',
        email: user.email,
        role: user.role,
        avatarUrl: user.profile?.avatarUrl
    };

    const organizationData = user.organization ? {
        name: user.organization.name,
        address: user.organization.address,
        city: user.organization.city,
        state: user.organization.state,
        zipCode: user.organization.zipCode
    } : null;

    return (
        <WorkerProfileForm
            user={userData}
            organization={organizationData}
        />
    );
}
