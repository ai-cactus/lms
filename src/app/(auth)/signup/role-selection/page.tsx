'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Logo, Button } from '@/components/ui';
import { signupWithRole } from '@/app/actions/auth';
import styles from './page.module.css';

interface PendingSignup {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
}

export default function RoleSelectionPage() {
    const router = useRouter();
    const [selectedRole, setSelectedRole] = useState<'admin' | 'worker'>('admin');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [pendingSignup, setPendingSignup] = useState<PendingSignup | null>(null);

    useEffect(() => {
        // Get pending signup data from sessionStorage
        const stored = sessionStorage.getItem('pendingSignup');
        if (stored) {
            try {
                setPendingSignup(JSON.parse(stored));
            } catch {
                router.push('/signup');
            }
        } else {
            // No pending signup, redirect back
            router.push('/signup');
        }
    }, [router]);

    const handleContinue = async () => {
        if (!pendingSignup) return;
        setIsLoading(true);
        setError('');

        try {
            const result = await signupWithRole({
                email: pendingSignup.email,
                password: pendingSignup.password,
                firstName: pendingSignup.firstName,
                lastName: pendingSignup.lastName,
                role: selectedRole
            });

            if (result.success) {
                // Clear pending signup data
                sessionStorage.removeItem('pendingSignup');
                // Store email for resend functionality
                localStorage.setItem('pendingVerificationEmail', pendingSignup.email);
                // Redirect to verify email page
                router.push('/verify-email');
            } else {
                setError(result.error || 'Failed to create account');
            }
        } catch (err) {
            console.error('Signup error:', err);
            setError('An unexpected error occurred.');
        } finally {
            setIsLoading(false);
        }
    };

    if (!pendingSignup) {
        return (
            <div className={styles.container}>
                <div className={styles.formSection}>
                    <div className={styles.formContent}>
                        <Logo size="md" />
                        <p>Loading...</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            {/* Left Side - Form */}
            <div className={styles.formSection}>
                <div className={styles.formContent}>
                    <Logo size="md" />

                    <div className={styles.formHeader}>
                        <h1 className={styles.title}>Tell us about your role</h1>
                        <p className={styles.subtitle}>
                            Choose the option that best describes how you wish to use Theraptly.
                        </p>
                    </div>

                    <div className={styles.roleCards}>
                        {/* Admin Card */}
                        <div
                            className={`${styles.roleCard} ${selectedRole === 'admin' ? styles.selected : ''}`}
                            onClick={() => setSelectedRole('admin')}
                        >
                            <div className={styles.cardHeader}>
                                <div className={styles.iconWrapper}>
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="2" y="5" width="20" height="14" rx="2" />
                                        <line x1="2" y1="10" x2="22" y2="10" />
                                    </svg>
                                </div>
                                <div className={styles.radio}>
                                    {selectedRole === 'admin' && <div className={styles.radioInner} />}
                                </div>
                            </div>
                            <h3 className={styles.roleName}>Health Service Provider (Admin)</h3>
                        </div>

                        {/* Worker Card */}
                        <div
                            className={`${styles.roleCard} ${selectedRole === 'worker' ? styles.selected : ''}`}
                            onClick={() => setSelectedRole('worker')}
                        >
                            <div className={styles.cardHeader}>
                                <div className={styles.iconWrapper}>
                                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="2" y="5" width="20" height="14" rx="2" />
                                        <line x1="2" y1="10" x2="22" y2="10" />
                                    </svg>
                                </div>
                                <div className={styles.radio}>
                                    {selectedRole === 'worker' && <div className={styles.radioInner} />}
                                </div>
                            </div>
                            <h3 className={styles.roleName}>Worker</h3>
                        </div>
                    </div>

                    {error && <p className={styles.error}>{error}</p>}

                    <Button
                        size="lg"
                        fullWidth
                        onClick={handleContinue}
                        loading={isLoading}
                    >
                        Continue
                    </Button>

                    <p className={styles.backLink}>
                        <a href="/signup" onClick={(e) => { e.preventDefault(); router.back(); }}>
                            ← Back to signup
                        </a>
                    </p>
                </div>
            </div>

            {/* Right Side - Hero Image */}
            <div className={styles.heroSection}>
                <Image
                    src="/images/login-bg.png"
                    alt="Theraptly Training"
                    fill
                    className={styles.heroImage}
                    priority
                    quality={100}
                />

                <div className={styles.heroOverlay}>
                    <div className={styles.heroTextContent}>
                        <h2 className={styles.heroTitle}>
                            Audit-ready training, built from your policies
                        </h2>
                        <p className={styles.heroSubtitle}>
                            Turn compliance policies into structured training, track completion automatically, and keep clear records that stand up during audits.
                        </p>
                    </div>

                    <div className={styles.progressBarContainer}>
                        <div className={styles.progressSegment}></div>
                        <div className={`${styles.progressSegment} ${styles.active}`}></div>
                        <div className={styles.progressSegment}></div>
                        <div className={styles.progressSegment}></div>
                    </div>
                </div>
            </div>
        </div>
    );
}
