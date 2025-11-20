"use client";

import { Bell } from "@phosphor-icons/react";

export function Header() {
    return (
        <header className="bg-white border-b border-gray-200 h-16 px-8 flex items-center justify-between sticky top-0 z-20">
            <h2 className="text-xl font-semibold text-slate-800">Dashboard</h2>
            <div className="flex items-center gap-4">
                <button className="relative p-2 text-slate-400 hover:text-slate-500">
                    <Bell className="text-xl" />
                    <span className="absolute top-1.5 right-1.5 block h-2 w-2 rounded-full bg-red-500 ring-2 ring-white"></span>
                </button>
                <div className="flex items-center gap-2 pl-4 border-l border-gray-200">
                    <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-sm">JD</div>
                    <div className="text-sm">
                        <p className="font-medium text-slate-700">Jane Doe</p>
                        <p className="text-xs text-slate-500">Admin</p>
                    </div>
                </div>
            </div>
        </header>
    );
}
