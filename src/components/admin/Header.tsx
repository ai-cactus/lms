"use client";

import { Bell, ChevronDown, Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

interface HeaderProps {
    onOpenMobileMenu: () => void;
}

export function Header({ onOpenMobileMenu }: HeaderProps) {
    const pathname = usePathname();
    const [userName, setUserName] = useState("Loading...");
    const [userInitials, setUserInitials] = useState("--");
    const supabase = createClient();

    useEffect(() => {
        loadUserData();
    }, []);

    const loadUserData = async () => {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            // Get user's full name from users table
            const { data: userData } = await supabase
                .from("users")
                .select("full_name")
                .eq("id", user.id)
                .single();

            if (userData?.full_name) {
                setUserName(userData.full_name);
                // Generate initials from full name
                const names = userData.full_name.split(" ");
                const initials = names.length >= 2
                    ? `${names[0][0]}${names[names.length - 1][0]}`.toUpperCase()
                    : names[0].substring(0, 2).toUpperCase();
                setUserInitials(initials);
            }
        } catch (error) {
            console.error("Error loading user data:", error);
        }
    };

    // Determine title based on path
    const getTitle = () => {
        if (pathname?.includes('/admin/dashboard')) return 'Dashboard';
        if (pathname?.includes('/admin/training-center')) return 'Training Center';
        if (pathname?.includes('/admin/courses')) return 'Courses';
        if (pathname?.includes('/admin/workers')) return 'Staff Details';
        if (pathname?.includes('/admin/documents')) return 'Documents';
        if (pathname?.includes('/admin/policies')) return 'Policies';
        if (pathname?.includes('/admin/settings')) return 'Settings';
        if (pathname?.includes('/admin/reports')) return 'Reports';
        return 'Dashboard';
    };

    return (
        <header className="bg-white h-16 px-4 sm:px-6 lg:px-8 flex items-center justify-between sticky top-0 z-20 border-b border-gray-100">
            <div className="flex items-center gap-3">
                {/* Hamburger menu button - shows on mobile, hides on desktop */}
                <button
                    onClick={onOpenMobileMenu}
                    className="lg:hidden p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    aria-label="Open menu"
                >
                    <Menu className="w-6 h-6 text-slate-600" />
                </button>

                {/* Breadcrumb */}
                <div className="hidden sm:flex items-center gap-2 text-sm text-slate-500">
                    <span>Home</span>
                    <span>/</span>
                    <span className="text-slate-900 font-medium">{getTitle()}</span>
                </div>

                {/* Mobile title */}
                <div className="sm:hidden">
                    <span className="text-lg font-semibold text-slate-900">{getTitle()}</span>
                </div>
            </div>

            <div className="flex items-center gap-3 sm:gap-6">
                <button className="relative text-slate-400 hover:text-slate-600 transition-colors p-2">
                    <Bell className="w-5 h-5 sm:w-6 sm:h-6" />
                </button>

                <div className="flex items-center gap-2 sm:gap-3 pl-3 sm:pl-6 border-l border-gray-200">
                    <div className="h-8 w-8 sm:h-10 sm:w-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-xs sm:text-sm">
                        {userInitials}
                    </div>
                    <div className="hidden md:block">
                        <div className="flex items-center gap-2 cursor-pointer">
                            <p className="font-medium text-slate-700 text-sm">{userName}</p>
                            <ChevronDown className="w-4 h-4 text-slate-400" />
                        </div>
                    </div>
                </div>
            </div>
        </header>
    );
}
