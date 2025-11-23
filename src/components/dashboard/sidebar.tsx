"use client";

import {
    SquaresFour,
    Files,
    Lightbulb,
    BookOpen,
    UserCircle,
    Headset,
    CaretDown,
    CaretRight
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export function Sidebar() {
    const pathname = usePathname();
    const [isTrainingCenterOpen, setIsTrainingCenterOpen] = useState(true);

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
                    <div className="ml-auto text-gray-400">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M4 4H20V20H4V4Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M9 4V20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </div>
                </div>

                <nav className="mt-2 px-4 space-y-1">
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-2 mb-3 mt-4">Main</div>

                    <Link
                        href="/admin/dashboard"
                        className={`flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${isActive('/admin/dashboard')
                                ? 'text-slate-900 bg-gray-100'
                                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                            }`}
                    >
                        <SquaresFour className="text-xl mr-3" weight={isActive('/admin/dashboard') ? "fill" : "regular"} />
                        Dashboard
                    </Link>

                    <Link
                        href="/admin/documents"
                        className={`flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${isActive('/admin/documents')
                                ? 'text-slate-900 bg-gray-100'
                                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                            }`}
                    >
                        <Files className="text-xl mr-3" weight={isActive('/admin/documents') ? "fill" : "regular"} />
                        Documents
                        <CaretRight className="ml-auto text-slate-400" size={16} />
                    </Link>

                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-2 mb-3 mt-8">Learning</div>

                    {/* Training Center Group */}
                    <div className="space-y-1">
                        <button
                            onClick={() => setIsTrainingCenterOpen(!isTrainingCenterOpen)}
                            className={`w-full flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${isActive('/admin/training-center') || isTrainingCenterOpen
                                    ? 'bg-gray-100 text-slate-900'
                                    : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                                }`}
                        >
                            <Lightbulb className="text-xl mr-3" weight={isActive('/admin/training-center') ? "fill" : "regular"} />
                            Training Center
                            <CaretDown className={`ml-auto text-slate-400 transition-transform ${isTrainingCenterOpen ? 'rotate-0' : '-rotate-90'}`} size={16} />
                        </button>

                        {isTrainingCenterOpen && (
                            <div className="pl-4 space-y-1 mt-1">
                                <Link
                                    href="/admin/courses"
                                    className={`flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${isActive('/admin/courses')
                                            ? 'text-slate-900'
                                            : 'text-slate-500 hover:text-slate-900'
                                        }`}
                                >
                                    <BookOpen className="text-xl mr-3" weight={isActive('/admin/courses') ? "fill" : "regular"} />
                                    Courses
                                </Link>
                                <Link
                                    href="/admin/staff"
                                    className={`flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-colors ${isActive('/admin/staff')
                                            ? 'text-slate-900'
                                            : 'text-slate-500 hover:text-slate-900'
                                        }`}
                                >
                                    <UserCircle className="text-xl mr-3" weight={isActive('/admin/staff') ? "fill" : "regular"} />
                                    Staff Details
                                </Link>
                            </div>
                        )}
                    </div>
                </nav>
            </div>

            <div className="p-4">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-2 mb-3">Help</div>
                <Link
                    href="/admin/help"
                    className="flex items-center px-3 py-2.5 text-slate-500 text-sm font-medium rounded-lg transition-colors hover:bg-slate-50 hover:text-slate-900"
                >
                    <Headset className="text-xl mr-3" />
                    Help Center
                </Link>
            </div>
        </aside>
    );
}
