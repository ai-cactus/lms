"use client";

import { Hexagon } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function WizardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    // In a real app, we might determine the step based on the route or state
    // For now, hardcoding "Step 1 of 7" as per the design for this specific page
    const stepText = "Step 1 of 7";

    return (
        <div className="min-h-screen bg-white flex flex-col">
            {/* Wizard Header */}
            <header className="bg-white border-b border-gray-200 h-16 flex items-center justify-between px-6 sticky top-0 z-20">
                <div className="flex items-center gap-8">
                    <Link href="/admin/dashboard" className="flex items-center gap-2 text-blue-600">
                        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                        </div>
                        <span className="text-xl font-bold tracking-tight text-blue-600">Theraptly</span>
                    </Link>
                    <div className="h-8 w-px bg-gray-200"></div>
                    <span className="text-slate-500 font-medium">{stepText}</span>
                </div>

                <Link
                    href="/admin/training-center"
                    className="text-slate-900 font-semibold hover:text-slate-700 transition-colors"
                >
                    Exit
                </Link>
            </header>

            {/* Progress Bar (Optional, but good for UX) */}
            <div className="h-1 bg-gray-100 w-full">
                <div className="h-full bg-blue-600 w-[14.28%]"></div>
            </div>

            {/* Main Content */}
            <main className="flex-1 flex flex-col">
                {children}
            </main>
        </div>
    );
}
