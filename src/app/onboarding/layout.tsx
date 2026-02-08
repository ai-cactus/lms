import React from 'react';
import { Logo } from '@/components/ui';
import styles from './onboarding.module.css';

export default function OnboardingLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div className={styles.logoWrapper}>
                    <Logo variant="blue" />
                </div>
            </header>
            <main className={styles.main}>
                {children}
            </main>
        </div>
    );
}
