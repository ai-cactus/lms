'use client';

import React from 'react';
import styles from '@/app/dashboard/(main)/layout.module.css';
import { Logo } from '@/components/ui';
import Header from '@/components/dashboard/Header';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface DashboardLayoutClientProps {
    children: React.ReactNode;
    userEmail: string;
    fullName: string;
    role: string | undefined;
}

export default function DashboardLayoutClient({
    children,
    userEmail,
    fullName,
    role
}: DashboardLayoutClientProps) {
    const pathname = usePathname();
    const isProfilePage = pathname === '/dashboard/profile';

    // If on profile page, render simplified layout
    if (isProfilePage) {
        return (
            <div className={styles.container} style={{ flexDirection: 'column', backgroundColor: '#FFFFFF' }}>
                <header style={{
                    height: '80px',
                    padding: '0 40px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderBottom: '1px solid #E2E8F0',
                    width: '100%'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                        {/* Blue Logo for Profile Page */}
                        <Logo size="md" variant="blue" />
                    </div>

                    <div className={styles.headerEnd}>
                        <div className={styles.profile}>
                            <div className={styles.avatar}>
                                {fullName ? fullName[0] : userEmail[0]}
                            </div>
                            <span className={styles.profileName}>{fullName}</span>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.chevron}>
                                <polyline points="6 9 12 15 18 9"></polyline>
                            </svg>
                        </div>
                    </div>
                </header>

                <main style={{ flex: 1, width: '100%', maxWidth: '1200px', margin: '0 auto', padding: '0' }}>
                    {children}
                </main>
            </div>
        );
    }

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

                        <Link href="/dashboard" className={`${styles.navItem} ${pathname === '/dashboard' ? styles.active : ''}`}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                                <polyline points="9 22 9 12 15 12 15 22" />
                            </svg>
                            <span>Dashboard</span>
                        </Link>

                        <Link href="/dashboard/documents" className={`${styles.navItem} ${pathname.startsWith('/dashboard/documents') ? styles.active : ''}`}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                                <line x1="16" y1="13" x2="8" y2="13" />
                                <line x1="16" y1="17" x2="8" y2="17" />
                                <polyline points="10 9 9 9 8 9" />
                            </svg>
                            <span>Documents</span>
                        </Link>

                        <Link href="/dashboard/courses" className={`${styles.navItem} ${pathname.startsWith('/dashboard/courses') ? styles.active : ''}`}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                            </svg>
                            <span>Courses</span>
                        </Link>
                    </div>

                    {/* PERFORMANCE Section */}
                    <div className={styles.navSection}>
                        <h4 className={styles.navSectionTitle}>PERFORMANCE</h4>

                        <Link href="/dashboard/staff" className={`${styles.navItem} ${pathname.startsWith('/dashboard/staff') ? styles.active : ''}`}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                <circle cx="12" cy="7" r="4" />
                            </svg>
                            <span>Staff Management</span>
                        </Link>

                        <Link href="/dashboard/auditor-pack" className={`${styles.navItem} ${pathname.startsWith('/dashboard/auditor-pack') ? styles.active : ''}`}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M18 20V10" />
                                <path d="M12 20V4" />
                                <path d="M6 20v-6" />
                            </svg>
                            <span>Auditor Pack</span>
                        </Link>
                    </div>

                    {/* SETTINGS Section */}
                    <div className={styles.navSection}>
                        <h4 className={styles.navSectionTitle}>SETTINGS</h4>

                        <Link href="/dashboard/billing" className={`${styles.navItem} ${pathname.startsWith('/dashboard/billing') ? styles.active : ''}`}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="2" y="5" width="20" height="14" rx="2" />
                                <line x1="2" y1="10" x2="22" y2="10" />
                            </svg>
                            <span>Billing</span>
                        </Link>

                        <Link href="/dashboard/help" className={`${styles.navItem} ${pathname.startsWith('/dashboard/help') ? styles.active : ''}`}>
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
