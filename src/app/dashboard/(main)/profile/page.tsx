import React from 'react';
import ProfileForm from '@/components/dashboard/ProfileForm';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';

export default async function ProfilePage() {
    const session = await auth();

    if (!session?.user) {
        redirect('/login');
    }

    // Fetch profile
    const profile = await prisma.profile.findUnique({
        where: { id: session.user.id },
    });


    // Construct initial data
    const initialData = {
        id: session.user.id!,
        first_name: profile?.firstName || '',
        last_name: profile?.lastName || '',
        email: session.user.email || '',
        role: (profile?.role as 'admin' | 'worker') || 'worker',
        company_name: profile?.companyName || ''
    };

    return (
        <ProfileForm initialData={initialData} />
    );
}
