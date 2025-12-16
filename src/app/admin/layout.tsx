"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/admin/Sidebar";
import { Header } from "@/components/admin/Header";

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const pathname = usePathname();

    // Hide sidebar and header for course creation wizard
    const isWizardPage = pathname?.startsWith("/admin/courses/create");

    if (isWizardPage) {
        return <>{children}</>;
    }

    return (
        <div className="min-h-screen bg-white">
            <Sidebar
                isMobileMenuOpen={isMobileMenuOpen}
                onCloseMobileMenu={() => setIsMobileMenuOpen(false)}
            />
            <div className="pl-0 lg:pl-64 flex flex-col min-h-screen">
                <Header onOpenMobileMenu={() => setIsMobileMenuOpen(true)} />
                <main className="flex-1 p-4 sm:p-6 lg:p-8">
                    {children}
                </main>
            </div>
        </div>
    );
}
