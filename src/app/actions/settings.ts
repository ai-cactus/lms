'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export interface OrgSettings {
    id: string;
    organization_id: string;
    weekly_report_enabled: boolean;
    monthly_report_enabled: boolean;
    additional_recipients: string[];
}

export async function getOrgSettings(organizationId: string): Promise<{
    success: boolean;
    settings?: OrgSettings;
    error?: string;
}> {
    try {
        const supabase = await createClient();

        const { data, error } = await supabase
            .from('organization_settings')
            .select('*')
            .eq('organization_id', organizationId)
            .single();

        if (error) {
            // If not found, return default (or create one?)
            // For now, let's return null and handle creation in UI or here
            if (error.code === 'PGRST116') {
                return { success: true, settings: undefined };
            }
            throw error;
        }

        return { success: true, settings: data };
    } catch (err) {
        console.error('Error fetching org settings:', err);
        return { success: false, error: err instanceof Error ? err.message : 'An unexpected error occurred' };
    }
}

export async function updateOrgSettings(
    organizationId: string,
    settings: {
        weekly_report_enabled: boolean;
        monthly_report_enabled: boolean;
        additional_recipients: string[];
    }
): Promise<{
    success: boolean;
    message?: string;
    error?: string;
}> {
    try {
        const supabase = await createClient();

        // Check if exists
        const { data: existing } = await supabase
            .from('organization_settings')
            .select('id')
            .eq('organization_id', organizationId)
            .single();

        let error;

        if (existing) {
            const { error: updateError } = await supabase
                .from('organization_settings')
                .update({
                    weekly_report_enabled: settings.weekly_report_enabled,
                    monthly_report_enabled: settings.monthly_report_enabled,
                    additional_recipients: settings.additional_recipients,
                    updated_at: new Date().toISOString()
                })
                .eq('organization_id', organizationId);
            error = updateError;
        } else {
            const { error: insertError } = await supabase
                .from('organization_settings')
                .insert({
                    organization_id: organizationId,
                    weekly_report_enabled: settings.weekly_report_enabled,
                    monthly_report_enabled: settings.monthly_report_enabled,
                    additional_recipients: settings.additional_recipients
                });
            error = insertError;
        }

        if (error) throw error;

        revalidatePath('/admin/settings');
        return { success: true, message: 'Settings updated successfully' };

    } catch (err) {
        console.error('Error updating org settings:', err);
        return { success: false, error: err instanceof Error ? err.message : 'An unexpected error occurred' };
    }
}
