import React from 'react';
import { getStaffDetails } from '@/app/actions/staff';
import StaffProfileClient from '@/components/dashboard/staff/StaffProfileClient';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface PageProps {
    params: Promise<{ id: string }>;
}

export default async function StaffProfilePage({ params }: PageProps) {
    const { id } = await params;
    const staff = await getStaffDetails(id);

    if (!staff) {
        notFound();
    }

    return <StaffProfileClient staff={staff} />;
}
