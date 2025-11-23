"use client";

import { Bell, CaretDown, UserCircle } from "@phosphor-icons/react";
import { Menu } from "lucide-react";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

interface WorkerHeaderProps {
    onOpenMobileMenu: () => void;
}

export function WorkerHeader({ onOpenMobileMenu }: WorkerHeaderProps) {
    const [userName, setUserName] = useState("Worker");
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
                }
            }
        };
        getUser();
    }, []);

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

                {/* Title - hidden on very small screens */}
                <h1 className="hidden sm:block text-lg font-semibold text-slate-900">My Training</h1>
            </div>

            <div className="flex items-center gap-4 sm:gap-6">
                <button className="relative p-2 text-slate-400 hover:text-slate-600 transition-colors">
                    <Bell className="text-xl sm:text-2xl" />
                </button>
                <div className="flex items-center gap-2 sm:gap-3 pl-3 sm:pl-6 border-l border-gray-200">
                    <div className="flex items-center gap-2 sm:gap-3 bg-gray-50 hover:bg-gray-100 px-2 sm:px-3 py-1.5 rounded-full cursor-pointer transition-colors">
                        <div className="h-7 w-7 sm:h-8 sm:w-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
                            <UserCircle className="text-xl sm:text-2xl" weight="fill" />
                        </div>
                        <span className="text-xs sm:text-sm font-medium text-slate-700 hidden sm:inline">{userName}</span>
                        <CaretDown className="text-slate-400 hidden sm:block" size={14} />
                    </div>
                </div>
            </div>
        </header>
    );
}
