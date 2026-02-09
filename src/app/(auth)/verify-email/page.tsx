'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { Logo, Button } from '@/components/ui';
import styles from './page.module.css';

function VerifyEmailContent() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const success = searchParams.get('success');
    const error = searchParams.get('error');
    const email = searchParams.get('email');

    const [resendCooldown, setResendCooldown] = useState(0);
    const [isResending, setIsResending] = useState(false);
    const [resendError, setResendError] = useState('');
    const [resendSuccess, setResendSuccess] = useState(false);

    // Handle successful verification - redirect to login for authentication
    useEffect(() => {
        if (success === 'true' && email) {
            router.push('/login?verified=true');
        }
    }, [success, email, router]);

    // Cooldown timer
    useEffect(() => {
        if (resendCooldown > 0) {
            const timer = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
            return () => clearTimeout(timer);
        }
    }, [resendCooldown]);

    const handleResend = async () => {
        const storedEmail = localStorage.getItem('pendingVerificationEmail');
        if (!storedEmail) {
            setResendError('Please sign up again to receive a new verification email.');
            return;
        }

        setIsResending(true);
        setResendError('');

        try {
            const response = await fetch('/api/auth/resend-verification', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: storedEmail })
            });

            const data = await response.json();

            if (data.success) {
                setResendSuccess(true);
                setResendCooldown(60);
            } else {
                setResendError(data.error || 'Failed to resend email');
            }
        } catch (err) {
            setResendError('Failed to resend verification email');
        } finally {
            setIsResending(false);
        }
    };

    // Error states
    if (error) {
        let errorMessage = 'Something went wrong. Please try again.';
        if (error === 'invalid_or_expired') {
            errorMessage = 'This verification link has expired or is invalid. Please request a new one.';
        } else if (error === 'missing_token') {
            errorMessage = 'Invalid verification link.';
        }

        return (
            <div className={styles.formContent}>
                <Logo size="md" />

                <div className={styles.iconWrapper}>
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="15" y1="9" x2="9" y2="15" />
                        <line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                </div>

                <h1 className={styles.title}>Verification Failed</h1>
                <p className={styles.subtitle}>{errorMessage}</p>

                <Button
                    size="lg"
                    fullWidth
                    onClick={handleResend}
                    loading={isResending}
                    disabled={resendCooldown > 0}
                >
                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Verification Email'}
                </Button>

                {resendError && <p className={styles.error}>{resendError}</p>}
                {resendSuccess && <p className={styles.success}>Verification email sent!</p>}

                <Link href="/signup" className={styles.link}>
                    Back to Sign Up
                </Link>
            </div>
        );
    }

    // Success state
    if (success === 'true') {
        return (
            <div className={styles.formContent}>
                <Logo size="md" />
                <div className={styles.iconWrapper}>
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="9 12 12 15 16 10" />
                    </svg>
                </div>
                <h1 className={styles.title}>Email Verified!</h1>
                <p className={styles.subtitle}>Redirecting you to login...</p>
            </div>
        );
    }

    // Default state - check your email
    return (
        <div className={styles.formContent}>
            <Logo size="md" />

            <div className={styles.iconWrapper}>
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#4C6EF5" strokeWidth="2">
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <polyline points="22 6 12 13 2 6" />
                </svg>
            </div>

            <h1 className={styles.title}>Check your email</h1>
            <p className={styles.subtitle}>
                We've sent a verification link to your email address.
                Please click the link to verify your account.
            </p>
            <p className={styles.expiry}>The link expires in 5 minutes.</p>

            <div className={styles.actions}>
                <Button
                    size="lg"
                    fullWidth
                    variant="secondary"
                    onClick={handleResend}
                    loading={isResending}
                    disabled={resendCooldown > 0}
                >
                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Email'}
                </Button>
            </div>

            {resendError && <p className={styles.error}>{resendError}</p>}
            {resendSuccess && <p className={styles.success}>Verification email sent!</p>}

            <Link href="/signup" className={styles.link}>
                Use a different email
            </Link>
        </div>
    );
}

export default function VerifyEmailPage() {
    return (
        <div className={styles.container}>
            {/* Left Side - Form */}
            <div className={styles.formSection}>
                <Suspense fallback={
                    <div className={styles.formContent}>
                        <Logo size="md" />
                        <p>Loading...</p>
                    </div>
                }>
                    <VerifyEmailContent />
                </Suspense>
            </div>

            {/* Right Side - Hero Image (Same as Login/Signup) */}
            <div className={styles.heroSection}>
                <Image
                    src="/images/login-bg.png"
                    alt="Theraptly Training"
                    fill
                    className={styles.heroImage}
                    priority
                    quality={100}
                />

                {/* Overlay Content */}
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
                        <div className={`${styles.progressSegment} ${styles.active}`}></div>
                        <div className={styles.progressSegment}></div>
                        <div className={styles.progressSegment}></div>
                        <div className={styles.progressSegment}></div>
                    </div>
                </div>
            </div>
        </div>
    );
}
