"use client";
"use client";

import { UserCircle } from "@phosphor-icons/react";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { UserProfileDropdown } from "@/components/UserProfileDropdown";

import NotificationBell from "@/components/notifications/NotificationBell";

export function Header() {
    const [userName, setUserName] = useState("Loading...");
    const [userInitials, setUserInitials] = useState("--");
    const supabase = createClient();

    useEffect(() => {
        const getUser = async () => {
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                const { data } = await supabase
                    .from("users")
                    .select("full_name")
                    .eq("id", user.id)
                    .single();
                if (data?.full_name) {
                    setUserName(data.full_name);
                    // Generate initials from full name
                    const names = data.full_name.split(" ");
                    const initials = names.length >= 2
                        ? `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase()
                        : names[0].substring(0, 2).toUpperCase();
                    setUserInitials(initials);
                }
            }
        };
        getUser();
    }, []);

    return (
        <header className="bg-white h-16 px-8 flex items-center justify-end sticky top-0 z-20">
            <div className="flex items-center gap-6">
                <NotificationBell />
                <div className="flex items-center gap-3 pl-6 border-l border-gray-200">
                    <UserProfileDropdown userName={userName} userInitials={userInitials} />
                </div>
            </div>
        </header>
    );
}
