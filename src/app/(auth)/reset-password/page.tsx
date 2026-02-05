'use client';

import React, { useState, Suspense } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { Logo, Input, Button } from '@/components/ui';
import { resetPasswordWithToken } from '@/app/actions/auth';
import styles from './page.module.css';

function ResetPasswordForm() {
    const searchParams = useSearchParams();
    const token = searchParams.get('token');

    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        if (newPassword !== confirmPassword) {
            setError("Passwords do not match");
            setLoading(false);
            return;
        }

        if (!token) {
            setError("Invalid or missing token.");
            setLoading(false);
            return;
        }

        try {
            const result = await resetPasswordWithToken(token, newPassword);
            if (result.success) {
                setSuccess(true);
            } else {
                setError(result.error || 'Failed to reset password');
            }
        } catch (err) {
            setError('Something went wrong. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    if (!token) {
        return (
            <div className={styles.container}>
                <div className={styles.formSection}>
                    <div className={styles.formContent}>
                        <Logo size="md" />
                        <div className={styles.formHeader}>
                            <h1 className={styles.title}>Invalid Link</h1>
                            <p className={styles.subtitle}>
                                This password reset link is invalid or has expired.
                            </p>
                            <div className={styles.backLinkContainer}>
                                <Link href="/forgot-password" className={styles.link}>
                                    Request a new link
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>
                <div className={styles.heroSection}>
                    <Image src="/images/login-bg.png" alt="Secure Access" fill className={styles.heroImage} priority quality={100} />
                    <div className={styles.heroOverlay}>
                        <div className={styles.heroTextContent}>
                            <h2 className={styles.heroTitle}>Secure Access Recovery</h2>
                            <p className={styles.heroSubtitle}>Your data is protected with industry-standard security protocols.</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.formSection}>
                <div className={styles.formContent}>
                    <Logo size="md" />

                    {!success ? (
                        <>
                            <div className={styles.formHeader}>
                                <h1 className={styles.title}>Set New Password</h1>
                                <p className={styles.subtitle}>
                                    Please enter your new password below.
                                </p>
                            </div>

                            <form onSubmit={handleSubmit} className={styles.form}>
                                <Input
                                    label="New Password"
                                    type="password"
                                    name="newPassword"
                                    placeholder="Enter new password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    required
                                    minLength={6}
                                />
                                <Input
                                    label="Confirm Password"
                                    type="password"
                                    name="confirmPassword"
                                    placeholder="Confirm new password"
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    required
                                    minLength={6}
                                    error={error}
                                />

                                <Button
                                    type="submit"
                                    size="lg"
                                    fullWidth
                                    loading={loading}
                                >
                                    Reset Password
                                </Button>
                            </form>
                        </>
                    ) : (
                        <div className={styles.successMessage}>
                            <div className={styles.successIcon}>
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                                    <polyline points="22 4 12 14.01 9 11.01" />
                                </svg>
                            </div>
                            <h3>Password Reset Complete</h3>
                            <p>Your password has been successfully updated.</p>
                            <div className={styles.backLinkContainer}>
                                <Link href="/login" className={styles.link}>
                                    Log In Now
                                </Link>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className={styles.heroSection}>
                <Image
                    src="/images/login-bg.png"
                    alt="Secure Access"
                    fill
                    className={styles.heroImage}
                    priority
                    quality={100}
                />
                <div className={styles.heroOverlay}>
                    <div className={styles.heroTextContent}>
                        <h2 className={styles.heroTitle}>
                            Secure Access Recovery
                        </h2>
                        <p className={styles.heroSubtitle}>
                            Your data is protected with industry-standard security protocols to ensure only authorized personnel can access sensitive information.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function ResetPasswordPage() {
    return (
        <Suspense fallback={<div>Loading...</div>}>
            <ResetPasswordForm />
        </Suspense>
    );
}
