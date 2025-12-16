import { createClient } from "@/lib/supabase/server";
import { getOrgSettings } from "@/app/actions/settings";
import SettingsForm from "@/components/SettingsForm";
import { redirect } from "next/navigation";

export default async function AdminSettingsPage() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
        redirect("/login");
    }

    // Fetch User's Org
    const { data: userData } = await supabase
        .from('users')
        .select('organization_id')
        .eq('id', user.id)
        .single();

    const organizationId = userData?.organization_id;

    if (!organizationId) {
        return <div>No organization found for this user.</div>;
    }

    // Fetch Settings
    const { settings } = await getOrgSettings(organizationId);

    return (
        <div className="min-h-screen bg-white py-8 px-4">
            <div className="max-w-3xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-slate-900 mb-2">Admin Settings</h1>
                    <p className="text-slate-600">
                        Manage your organization's preferences and automated reporting.
                    </p>
                </div>

                <SettingsForm
                    organizationId={organizationId}
                    initialSettings={settings}
                />
            </div>
        </div>
    );
}
