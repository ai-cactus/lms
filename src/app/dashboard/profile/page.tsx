import React from 'react';
import ProfileForm from '@/components/dashboard/ProfileForm';
import { createClient } from '@/utils/supabase/server';
import { redirect } from 'next/navigation';

export default async function ProfilePage() {
    const supabase = await createClient();

    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
        redirect('/login');
    }

    // Fetch profile
    const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

    // Construct initial data
    const initialData = {
        id: user.id,
        first_name: profile?.first_name || '',
        last_name: profile?.last_name || '',
        email: user.email || '',
        role: profile?.role || 'worker',
        company_name: profile?.company_name || ''
    };

    return (
        <ProfileForm initialData={initialData} />
    );
}
