'use client';

import React, { useState, useActionState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { Logo, Input, Button } from '@/components/ui';
import { authenticate } from '@/app/actions/auth';
import styles from './page.module.css';
import { signIn } from 'next-auth/react';

function LoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const joined = searchParams.get('joined');

    const [state, dispatch, isPending] = useActionState(authenticate, undefined);

    const [formData, setFormData] = useState({
        email: '',
        password: '',
        rememberMe: false,
    });
    const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

    const handleMicrosoftLogin = () => {
        signIn('microsoft-entra-id', { callbackUrl: '/dashboard' });
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
        if (errors[name as keyof typeof errors]) {
            setErrors(prev => ({ ...prev, [name]: undefined }));
        }
    };

    const validateForm = () => {
        const newErrors: typeof errors = {};

        if (!formData.email) {
            newErrors.email = 'Email is required';
        } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
            newErrors.email = 'Please enter a valid email';
        }

        if (!formData.password) {
            newErrors.password = 'Password is required';
        } else if ((formData.password || '').length < 6) {
            newErrors.password = 'Password must be at least 6 characters';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!validateForm()) return;

        setErrors({});
        // Construct FormData manually 
        const form = new FormData();
        form.append('email', formData.email);
        form.append('password', formData.password);

        React.startTransition(() => {
            dispatch(form);
        });
    };

    useEffect(() => {
        if (state?.success) {
            router.push('/dashboard');
        } else if (state?.error) {
            setErrors(prev => ({ ...prev, email: state.error }));
        }
    }, [state, router]);

    return (
        <div className={styles.formContent}>
            <Logo size="md" />

            <div className={styles.formHeader}>
                <h1 className={styles.title}>Log in to your account</h1>
                <p className={styles.subtitle}>
                    Log in to your workspace and get back to what matters.
                </p>
            </div>

            {joined && (
                <div style={{
                    backgroundColor: '#ECFDF5',
                    color: '#065F46',
                    padding: '12px',
                    borderRadius: '6px',
                    marginBottom: '16px',
                    border: '1px solid #A7F3D0',
                    fontSize: '14px',
                    textAlign: 'center'
                }}>
                    Account created successfully! Please log in.
                </div>
            )}

            {searchParams.get('verified') && (
                <div style={{
                    backgroundColor: '#ECFDF5',
                    color: '#065F46',
                    padding: '16px 20px',
                    borderRadius: '12px',
                    marginBottom: '24px',
                    border: '1px solid #A7F3D0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    width: '100%'
                }}>
                    <div style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '50%',
                        backgroundColor: '#10B981',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                    }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                    </div>
                    <div>
                        <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '2px' }}>
                            Email verified successfully!
                        </div>
                        <div style={{ fontSize: '13px', color: '#047857' }}>
                            Please log in to continue to your account.
                        </div>
                    </div>
                </div>
            )}

            <div className={styles.socialLogin}>
                <button type="button" className={styles.microsoftButton} onClick={handleMicrosoftLogin}>
                    <Image
                        src="/icons/microsoft.svg"
                        alt="Microsoft"
                        width={20}
                        height={20}
                    />
                    <span>Log In with Microsoft</span>
                </button>
            </div>

            <div className={styles.divider}>
                <span>or continue with email</span>
            </div>

            <form onSubmit={handleSubmit} className={styles.form}>
                <Input
                    label="Email"
                    type="email"
                    name="email"
                    placeholder="Enter your email address"
                    value={formData.email}
                    onChange={handleChange}
                    error={errors.email}
                    autoComplete="email"
                />

                <Input
                    label="Password"
                    type="password"
                    name="password"
                    placeholder="Enter your password"
                    value={formData.password}
                    onChange={handleChange}
                    error={errors.password}
                    autoComplete="current-password"
                />

                <div className={styles.formOptions}>
                    <Link href="/forgot-password" className={styles.link}>
                        Forgot your password?
                    </Link>
                </div>

                <Button
                    type="submit"
                    size="lg"
                    fullWidth
                    loading={isPending}
                >
                    Log in
                </Button>
            </form>

            <p className={styles.signupPrompt}>
                Don&apos;t have an account?{' '}
                <Link href="/signup" className={styles.signupLink}>
                    Sign Up
                </Link>
            </p>
        </div>
    );
}

export default function LoginPage() {
    return (
        <div className={styles.container}>
            {/* Left Side - Form */}
            <div className={styles.formSection}>
                <Suspense fallback={<div>Loading...</div>}>
                    <LoginForm />
                </Suspense>
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
