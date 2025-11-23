"use client";

import { Bell, CaretDown, UserCircle } from "@phosphor-icons/react";
import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export function WorkerHeader() {
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
        <header className="bg-white h-16 px-8 flex items-center justify-end sticky top-0 z-20 border-b border-gray-100">
            <div className="flex items-center gap-6">
                <button className="relative p-2 text-slate-400 hover:text-slate-600 transition-colors">
                    <Bell className="text-2xl" />
                </button>
                <div className="flex items-center gap-3 pl-6 border-l border-gray-200">
                    <div className="flex items-center gap-3 bg-gray-50 hover:bg-gray-100 px-3 py-1.5 rounded-full cursor-pointer transition-colors">
                        <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
                            <UserCircle className="text-2xl" weight="fill" />
                        </div>
                        <span className="text-sm font-medium text-slate-700">{userName}</span>
                        <CaretDown className="text-slate-400" size={14} />
                    </div>
                </div>
            </div>
        </header>
    );
}
