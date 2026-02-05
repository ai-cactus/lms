'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Logo, Input, Button } from '@/components/ui';
import { sendPasswordResetLink } from '@/app/actions/auth';
import styles from './page.module.css';

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('');
    const [isSubmitted, setIsSubmitted] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const result = await sendPasswordResetLink(email);
            if (result.success) {
                setIsSubmitted(true);
            } else {
                setError(result.error || 'Failed to send reset link');
            }
        } catch (err) {
            setError('Something went wrong. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.container}>
            {/* Left Side - Form */}
            <div className={styles.formSection}>
                <div className={styles.formContent}>
                    <Logo size="md" />

                    {!isSubmitted ? (
                        <>
                            <div className={styles.formHeader}>
                                <h1 className={styles.title}>Reset your password</h1>
                                <p className={styles.subtitle}>
                                    Enter your email address and we'll send you a link to reset your password.
                                </p>
                            </div>

                            <form onSubmit={handleSubmit} className={styles.form}>
                                <Input
                                    label="Email"
                                    type="email"
                                    name="email"
                                    placeholder="Enter your email address"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                    autoComplete="email"
                                    error={error}
                                />

                                <Button
                                    type="submit"
                                    size="lg"
                                    fullWidth
                                    loading={loading}
                                >
                                    Send Reset Link
                                </Button>

                                <div className={styles.backLinkContainer}>
                                    <Link href="/login" className={styles.link}>
                                        Back to Login
                                    </Link>
                                </div>
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
                            <h3>Check your email</h3>
                            <p>If an account exists for {email}, we have sent a password reset link.</p>
                            <Button
                                variant="outline"
                                fullWidth
                                onClick={() => setIsSubmitted(false)}
                                className={styles.resendButton}
                            >
                                Try another email
                            </Button>
                            <div className={styles.backLinkContainer}>
                                <Link href="/login" className={styles.link}>
                                    Back to Login
                                </Link>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Right Side - Hero Image */}
            <div className={styles.heroSection}>
                <Image
                    src="/images/login-bg.png"
                    alt="Secure Access"
                    fill
                    className={styles.heroImage}
                    priority
                    quality={100}
                />

                {/* Overlay Content */}
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
