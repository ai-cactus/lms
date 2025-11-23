"use client";

import {
    SquaresFour,
    BookOpen,
    Headset,
    Lifebuoy
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function WorkerSidebar() {
    const pathname = usePathname();

    const isActive = (path: string) => pathname?.startsWith(path);

    return (
        <aside className="w-64 bg-white border-r border-gray-200 flex flex-col justify-between h-full fixed left-0 top-0 z-10">
            <div>
                {/* Logo */}
                <div className="p-6 flex items-center gap-3">
                    <div className="text-blue-600">
                        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M16 2L2.5 9.5L16 17L29.5 9.5L16 2Z" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M2.5 22.5L16 30L29.5 22.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M2.5 16L16 23.5L29.5 16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </div>
                    <span className="text-xl font-bold tracking-tight text-blue-600">Theraptly</span>
                </div>

                <nav className="mt-2 px-4 space-y-1">
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-2 mb-3 mt-4">Learning</div>

                    <Link
                        href="/worker/dashboard"
                        className={`flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${isActive('/worker/dashboard')
                            ? 'text-slate-900 bg-gray-100'
                            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                            }`}
                    >
                        <SquaresFour className="text-xl mr-3" weight={isActive('/worker/dashboard') ? "fill" : "regular"} />
                        Dashboard
                    </Link>

                    <Link
                        href="/worker/courses"
                        className={`flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${isActive('/worker/courses')
                            ? 'text-slate-900 bg-gray-100'
                            : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                            }`}
                    >
                        <BookOpen className="text-xl mr-3" weight={isActive('/worker/courses') ? "fill" : "regular"} />
                        Courses
                    </Link>
                </nav>
            </div>

            <div className="p-4">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-2 mb-3">Help & Settings</div>
                <Link
                    href="/worker/help"
                    className={`flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${isActive('/worker/help')
                        ? 'text-slate-900 bg-gray-100'
                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                        }`}
                >
                    <Lifebuoy className="text-xl mr-3" weight={isActive('/worker/help') ? "fill" : "regular"} />
                    Help Center
                </Link>
            </div>
        </aside>
    );
}
