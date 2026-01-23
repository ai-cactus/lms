"use client";

import { CaretDown, UserCircle } from "@phosphor-icons/react";
import { Menu } from "lucide-react";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { UserProfileDropdown } from "@/components/UserProfileDropdown";
import NotificationBell from "@/components/notifications/NotificationBell";

interface WorkerHeaderProps {
    onOpenMobileMenu: () => void;
}

export function WorkerHeader({ onOpenMobileMenu }: WorkerHeaderProps) {
    const [userName, setUserName] = useState("Worker");
    const [userInitials, setUserInitials] = useState("W");
    const router = useRouter();
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
        <header className="bg-white h-16 px-4 sm:px-6 lg:px-8 flex items-center justify-between sticky top-0 z-20">
            <div className="flex items-center gap-3">
                {/* Hamburger menu button - shows on mobile, hides on desktop */}
                <button
                    onClick={onOpenMobileMenu}
                    className="lg:hidden p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    aria-label="Open menu"
                >
                    <Menu className="w-6 h-6 text-slate-600" />
                </button>

                {/* Title - hidden on very small screens */}

            </div>

            <div className="flex items-center gap-4 sm:gap-6">
                <NotificationBell />
                <div className="flex items-center gap-2 sm:gap-3 pl-3 sm:pl-6">
                    <UserProfileDropdown
                        userName={userName}
                        userInitials={userInitials}
                        onEditProfile={() => router.push('/worker/profile')}
                    />
                </div>
            </div>
        </header>
    );
}
