"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { User, Mail, Shield, UserCircle } from "lucide-react";

interface UserProfile {
    id: string;
    full_name: string;
    email: string;
    role: string;
}

export default function WorkerProfilePage() {
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const supabase = createClient();

    useEffect(() => {
        const getProfile = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return;

                const { data } = await supabase
                    .from("users")
                    .select("id, full_name, email, role")
                    .eq("id", user.id)
                    .single();

                if (data) {
                    setProfile(data);
                }
            } catch (error) {
                console.error("Error loading profile:", error);
            } finally {
                setLoading(false);
            }
        };

        getProfile();
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    if (!profile) {
        return <div className="p-8">Profile not found.</div>;
    }

    return (
        <div className="p-8">
            <h1 className="text-2xl font-bold text-slate-900 mb-8">My Profile</h1>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden max-w-2xl">
                <div className="p-6 border-b border-gray-200 bg-gray-50 flex items-center gap-4">
                    <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 text-2xl font-bold">
                        {profile.full_name?.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-slate-900">{profile.full_name}</h2>
                        <p className="text-slate-500">{profile.role}</p>
                    </div>
                </div>

                <div className="p-6 space-y-6">
                    <div className="grid grid-cols-1 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-500 mb-1">Full Name</label>
                            <div className="flex items-center gap-3 text-slate-900 p-3 bg-gray-50 rounded-lg">
                                <User className="w-5 h-5 text-slate-400" />
                                {profile.full_name}
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-500 mb-1">Email Address</label>
                            <div className="flex items-center gap-3 text-slate-900 p-3 bg-gray-50 rounded-lg">
                                <Mail className="w-5 h-5 text-slate-400" />
                                {profile.email}
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-500 mb-1">Role</label>
                            <div className="flex items-center gap-3 text-slate-900 p-3 bg-gray-50 rounded-lg">
                                <Shield className="w-5 h-5 text-slate-400" />
                                <span className="capitalize">{profile.role}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
