'use client';

import React, { useState, useEffect } from 'react';
import styles from '@/app/dashboard/(main)/layout.module.css';
import { Logo } from '@/components/ui';
import WorkerHeader from '@/components/worker/WorkerHeader';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface WorkerDashboardLayoutProps {
    children: React.ReactNode;
    userEmail: string;
    fullName: string;
}

export default function WorkerDashboardLayout({
    children,
    userEmail,
    fullName
}: WorkerDashboardLayoutProps) {
    const pathname = usePathname();
    const [sidebarOpen, setSidebarOpen] = useState(false);

    // Close sidebar on route change
    useEffect(() => {
        setSidebarOpen(false);
    }, [pathname]);

    // Prevent body scroll when sidebar is open on mobile
    useEffect(() => {
        if (sidebarOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [sidebarOpen]);

    return (
        <div className={styles.container}>
            {/* Mobile Backdrop */}
            {sidebarOpen && (
                <div
                    className={styles.backdrop}
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
                <div className={styles.logoWrapper}>
                    <Logo size="sm" />
                </div>

                <nav className={styles.nav}>
                    {/* MAIN MENU Section */}
                    <div className={styles.navSection}>
                        <h4 className={styles.navSectionTitle}>MAIN MENU</h4>

                        <Link href="/worker" className={`${styles.navItem} ${pathname === '/worker' ? styles.active : ''}`}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                                <polyline points="9 22 9 12 15 12 15 22" />
                            </svg>
                            <span>Dashboard</span>
                        </Link>

                        <Link href="/worker/trainings" className={`${styles.navItem} ${pathname.startsWith('/worker/trainings') ? styles.active : ''}`}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                            </svg>
                            <span>Trainings</span>
                        </Link>
                    </div>

                </nav>
            </aside>

            {/* Main Content Area */}
            <main className={styles.main}>
                {/* Top Header */}
                <WorkerHeader
                    userEmail={userEmail}
                    fullName={fullName}
                    onMenuClick={() => setSidebarOpen(true)}
                />

                <div className={styles.content}>
                    {children}
                </div>
            </main>
        </div>
    );
}
