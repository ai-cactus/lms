"use client";

import { WorkerSidebar } from "./worker-sidebar";
import { WorkerHeader } from "./worker-header";

export function WorkerLayout({ children }: { children: React.ReactNode }) {
    return (
        <div className="min-h-screen bg-slate-50">
            <WorkerSidebar />
            <div className="pl-64">
                <WorkerHeader />
                <main>
                    {children}
                </main>
            </div>
        </div>
    );
}
