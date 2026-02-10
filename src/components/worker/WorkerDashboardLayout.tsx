'use client';

import React from 'react';
import styles from '@/app/dashboard/(main)/layout.module.css';
import { Logo } from '@/components/ui';
import Header from '@/components/dashboard/Header';
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

    return (
        <div className={styles.container}>
            {/* Sidebar */}
            <aside className={styles.sidebar}>
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

                    {/* HELP Section */}
                    <div className={styles.navSection}>
                        <h4 className={styles.navSectionTitle}>HELP</h4>

                        <Link href="/worker/help" className={`${styles.navItem} ${pathname.startsWith('/worker/help') ? styles.active : ''}`}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                                <line x1="12" y1="17" x2="12.01" y2="17" />
                            </svg>
                            <span>Help Center</span>
                        </Link>
                    </div>
                </nav>
            </aside>

            {/* Main Content Area */}
            <main className={styles.main}>
                {/* Top Header */}
                <Header userEmail={userEmail} fullName={fullName} />

                <div className={styles.content}>
                    {children}
                </div>
            </main>
        </div>
    );
}
