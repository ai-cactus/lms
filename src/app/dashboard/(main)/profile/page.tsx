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

    // Fetch user with organization
    const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        include: { organization: true }
    });

    const role = session?.user?.role || 'worker';

    // Construct initial profile data
    const initialData = {
        id: session.user.id!,
        first_name: profile?.firstName || '',
        last_name: profile?.lastName || '',
        email: session.user.email || '',
        role: role as 'admin' | 'worker',
        company_name: profile?.companyName || ''
    };

    // Construct organization data
    const organizationData = user?.organization ? {
        id: user.organization.id,
        name: user.organization.name,
        dba: user.organization.dba,
        ein: user.organization.ein,
        staffCount: user.organization.staffCount,
        primaryContact: user.organization.primaryContact,
        primaryEmail: user.organization.primaryEmail,
        phone: user.organization.phone,
        address: user.organization.address,
        country: user.organization.country,
        state: user.organization.state,
        zipCode: user.organization.zipCode,
        licenseNumber: user.organization.licenseNumber,
        isHipaaCompliant: user.organization.isHipaaCompliant,
    } : null;

    return (
        <ProfileForm
            initialData={initialData}
            organizationData={organizationData}
        />
    );
}
