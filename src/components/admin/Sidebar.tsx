"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
    LayoutDashboard,
    FileText,
    Lightbulb,
    BookOpen,
    UserCircle,
    HelpCircle,
    ChevronDown,
    ChevronRight
} from "lucide-react";

export function Sidebar() {
    const pathname = usePathname();
    const [isTrainingCenterOpen, setIsTrainingCenterOpen] = useState(true);

    const isActive = (path: string) => pathname?.startsWith(path);

    return (
        <aside className="w-64 bg-white border-r border-gray-200 flex flex-col h-full fixed left-0 top-0 z-30">
            {/* Logo */}
            <div className="h-16 flex items-center px-6 border-b border-gray-100">
                <div className="flex items-center gap-2 text-blue-600">
                    <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </div>
                    <span className="text-xl font-bold tracking-tight text-blue-600">Theraptly</span>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto py-6 px-3 space-y-6">
                {/* MAIN Section */}
                <div>
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-3 mb-2">
                        Main
                    </div>
                    <div className="space-y-1">
                        <Link
                            href="/admin/dashboard"
                            className={`flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors ${isActive('/admin/dashboard')
                                ? 'text-blue-600 bg-blue-50'
                                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                                }`}
                        >
                            <LayoutDashboard className="w-5 h-5 mr-3" />
                            Dashboard
                        </Link>
                        <Link
                            href="/admin/documents"
                            className={`flex items-center justify-between px-3 py-2 text-sm font-medium rounded-lg transition-colors ${isActive('/admin/documents')
                                ? 'text-blue-600 bg-blue-50'
                                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                                }`}
                        >
                            <div className="flex items-center">
                                <FileText className="w-5 h-5 mr-3" />
                                Documents
                            </div>
                            <ChevronRight className="w-4 h-4 text-slate-400" />
                        </Link>
                    </div>
                </div>

                {/* LEARNING Section */}
                <div>
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-3 mb-2">
                        Learning
                    </div>
                    <div className="space-y-1">
                        {/* Training Center Dropdown Button */}
                        <button
                            onClick={() => setIsTrainingCenterOpen(!isTrainingCenterOpen)}
                            className={`w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-lg transition-colors ${isActive('/admin/training-center') || isActive('/admin/courses') || isActive('/admin/workers')
                                    ? 'text-blue-600 bg-blue-50'
                                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                                }`}
                        >
                            <div className="flex items-center">
                                <Lightbulb className="w-5 h-5 mr-3" />
                                Training Center
                            </div>
                            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isTrainingCenterOpen ? 'rotate-0' : '-rotate-90'
                                }`} />
                        </button>

                        {/* Nested items - Courses and Staff Details */}
                        {isTrainingCenterOpen && (
                            <div className="pl-4 space-y-1">
                                <Link
                                    href="/admin/courses"
                                    className={`flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors ${isActive('/admin/courses')
                                        ? 'text-blue-600 bg-blue-50'
                                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                                        }`}
                                >
                                    <BookOpen className="w-5 h-5 mr-3" />
                                    Courses
                                </Link>
                                <Link
                                    href="/admin/workers"
                                    className={`flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors ${isActive('/admin/workers')
                                        ? 'text-blue-600 bg-blue-50'
                                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                                        }`}
                                >
                                    <UserCircle className="w-5 h-5 mr-3" />
                                    Staff Details
                                </Link>
                            </div>
                        )}
                    </div>
                </div>

                {/* HELP Section */}
                <div>
                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-3 mb-2">
                        Help
                    </div>
                    <div className="space-y-1">
                        <Link
                            href="/admin/help"
                            className={`flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors ${isActive('/admin/help')
                                ? 'text-blue-600 bg-blue-50'
                                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                                }`}
                        >
                            <HelpCircle className="w-5 h-5 mr-3" />
                            Help Center
                        </Link>
                    </div>
                </div>
            </div>
        </aside>
    );
}
