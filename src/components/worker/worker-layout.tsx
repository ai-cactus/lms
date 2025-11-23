"use client";

import { useState } from "react";
import { WorkerSidebar } from "./worker-sidebar";
import { WorkerHeader } from "./worker-header";

export function WorkerLayout({ children }: { children: React.ReactNode }) {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    return (
        <div className="min-h-screen bg-slate-50">
            <WorkerSidebar
                isMobileMenuOpen={isMobileMenuOpen}
                onCloseMobileMenu={() => setIsMobileMenuOpen(false)}
            />
            <div className="pl-0 lg:pl-64">
                <WorkerHeader onOpenMobileMenu={() => setIsMobileMenuOpen(true)} />
                <main>
                    {children}
                </main>
            </div>
        </div>
    );
}
