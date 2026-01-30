import React from 'react';
import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';
import DashboardLayoutClient from '@/components/dashboard/DashboardLayoutClient';

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const supabase = await createClient();

    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
        redirect('/login');
    }

    // Fetch profile role
    const { data: profile } = await supabase
        .from('profiles')
        .select('role, full_name')
        .eq('id', user.id)
        .single();

    const role = profile?.role;
    const fullName = profile?.full_name || user.email || 'User';

    return (
        <DashboardLayoutClient
            userEmail={user.email || ''}
            fullName={fullName}
            role={role}
        >
            {children}
        </DashboardLayoutClient>
    );
}
