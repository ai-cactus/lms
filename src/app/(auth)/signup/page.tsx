'use client';

import React, { useState, useActionState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Logo, Input, Button } from '@/components/ui';
import { signup, SignupResult } from '@/app/actions/auth';
import styles from './page.module.css';

export default function SignupPage() {
    const router = useRouter();
    const [result, dispatch, isPending] = useActionState<SignupResult | undefined, FormData>(signup, undefined);

    const [formData, setFormData] = useState({
        firstName: '',
        lastName: '',
        email: '',
        password: '',
        confirmPassword: '',
        agreeTerms: false,
    });
    const [errors, setErrors] = useState<Record<string, string>>({});

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
        if (errors[name]) {
            setErrors(prev => ({ ...prev, [name]: '' }));
        }
    };

    const validateForm = () => {
        const newErrors: Record<string, string> = {};

        if (!formData.firstName.trim()) {
            newErrors.firstName = 'First name is required';
        }

        if (!formData.lastName.trim()) {
            newErrors.lastName = 'Last name is required';
        }

        if (!formData.email) {
            newErrors.email = 'Email is required';
        } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
            newErrors.email = 'Please enter a valid email';
        }

        if (!formData.password) {
            newErrors.password = 'Password is required';
        } else if (formData.password.length < 8) {
            newErrors.password = 'Password must be at least 8 characters';
        }

        if (!formData.confirmPassword) {
            newErrors.confirmPassword = 'Please confirm your password';
        } else if (formData.password !== formData.confirmPassword) {
            newErrors.confirmPassword = 'Passwords do not match';
        }

        if (!formData.agreeTerms) {
            newErrors.agreeTerms = 'You must agree to the terms';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!validateForm()) return;
        setErrors({});

        // Construct FormData manually
        // Store form data in sessionStorage for role selection page
        sessionStorage.setItem('pendingSignup', JSON.stringify({
            email: formData.email,
            password: formData.password,
            firstName: formData.firstName,
            lastName: formData.lastName
        }));

        // Redirect to role selection
        router.push('/signup/role-selection');
    };

    useEffect(() => {
        if (result) {
            if (result.success) {
                // This shouldn't happen anymore as signup is called from role-selection
                router.push('/verify-email');
            } else {
                setErrors(prev => ({ ...prev, email: result.error }));
            }
        }
    }, [result, router]);

    return (
        <div className={styles.container}>
            {/* Left Side - Form */}
            <div className={styles.formSection}>
                <div className={styles.formContent}>
                    <Logo size="md" />

                    <div className={styles.formHeader}>
                        <h1 className={styles.title}>Create an account</h1>
                        <p className={styles.subtitle}>
                            Start your learning journey with Theraptly
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className={styles.form}>
                        <div className={styles.nameRow}>
                            <Input
                                label="First Name"
                                type="text"
                                name="firstName"
                                placeholder="First Name"
                                value={formData.firstName}
                                onChange={handleChange}
                                error={errors.firstName}
                                autoComplete="given-name"
                            />
                            <Input
                                label="Last Name"
                                type="text"
                                name="lastName"
                                placeholder="Last Name"
                                value={formData.lastName}
                                onChange={handleChange}
                                error={errors.lastName}
                                autoComplete="family-name"
                            />
                        </div>

                        <Input
                            label="Email"
                            type="email"
                            name="email"
                            placeholder="Enter your email"
                            value={formData.email}
                            onChange={handleChange}
                            error={errors.email}
                            autoComplete="email"
                        />

                        <Input
                            label="Password"
                            type="password"
                            name="password"
                            placeholder="Create a password"
                            value={formData.password}
                            onChange={handleChange}
                            error={errors.password}
                            autoComplete="new-password"
                        />

                        <Input
                            label="Confirm Password"
                            type="password"
                            name="confirmPassword"
                            placeholder="Confirm your password"
                            value={formData.confirmPassword}
                            onChange={handleChange}
                            error={errors.confirmPassword}
                            autoComplete="new-password"
                        />

                        <div className={styles.termsCheckbox}>
                            <label className={styles.checkboxLabel}>
                                <input
                                    type="checkbox"
                                    name="agreeTerms"
                                    checked={formData.agreeTerms}
                                    onChange={handleChange}
                                    className={styles.checkbox}
                                />
                                <span className={styles.checkboxText}>
                                    I agree to the{' '}
                                    <Link href="/terms" className={styles.link}>Terms of Service</Link>
                                    {' '}and{' '}
                                    <Link href="/privacy" className={styles.link}>Privacy Policy</Link>
                                </span>
                            </label>
                            {errors.agreeTerms && (
                                <span className={styles.error}>{errors.agreeTerms}</span>
                            )}
                        </div>

                        <Button
                            type="submit"
                            size="lg"
                            fullWidth
                            loading={isPending}
                        >
                            Create Account
                        </Button>
                    </form>

                    <p className={styles.loginPrompt}>
                        Already have an account?{' '}
                        <Link href="/login" className={styles.loginLink}>
                            Login
                        </Link>
                    </p>
                </div>
            </div>

            {/* Right Side - Hero Image (Same as Login) */}
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
