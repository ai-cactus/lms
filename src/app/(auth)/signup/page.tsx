'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Logo, Input, Button } from '@/components/ui';
import { createClient } from '@/utils/supabase/client';
import styles from './page.module.css';

// Feature data from Figma (same as login)
const features = [
    {
        icon: (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
            </svg>
        ),
        title: 'Policy Analyzer',
        description: 'Instantly detect non-compliant content in your policy documents with AI-powered analysis.',
    },
    {
        icon: (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
            </svg>
        ),
        title: 'Compliance Scoring',
        description: 'Receive a percentage-based score for easy evaluation and quick decision-making.',
    },
    {
        icon: (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
            </svg>
        ),
        title: 'Billing & Plan Management',
        description: 'Flexible subscription options designed to fit your needs.',
    },
    {
        icon: (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
            </svg>
        ),
        title: 'Secure Cloud Storage',
        description: 'Keep all your sensitive compliance documents safe and accessible anytime, anywhere.',
    },
];

export default function SignupPage() {
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(false);
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

        setIsLoading(true);
        setErrors({});

        try {
            const supabase = createClient();
            const { data, error } = await supabase.auth.signUp({
                email: formData.email,
                password: formData.password,
                options: {
                    data: {
                        first_name: formData.firstName,
                        last_name: formData.lastName,
                        full_name: `${formData.firstName} ${formData.lastName}`.trim(),
                    },
                },
            });

            if (error) {
                setErrors({ email: error.message });
                return;
            }

            // Check if session was created (Email Confirmation might be ON)
            if (data.user && !data.session) {
                // Email confirmation is required.
                // Show a success message telling them to check email.
                setErrors({ email: 'Success! Please check your email to confirm your account.' });
                // Alternatively, switch to a "Check Email" UI state.
                return;
            }

            // Session exists (Email Confirmation OFF or Auto-Confirm)
            if (data.session) {
                router.push('/onboarding/role-selection');
            }

        } catch (error) {
            console.error('Signup error:', error);
            setErrors({ email: 'An unexpected error occurred. Please try again.' });
        } finally {
            setIsLoading(false);
        }
    };

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
                            loading={isLoading}
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

            {/* Right Side - Hero (Same as Login) */}
            <div className={styles.heroSection}>
                {/* Background doodle decoration from Figma */}
                <Image
                    src="/images/bg-vectors.svg"
                    alt=""
                    fill
                    className={styles.bgDoodle}
                    priority
                />

                {/* Hero Content */}
                <div className={styles.heroContent}>
                    {/* Header */}
                    <div className={styles.heroHeader}>
                        <h2 className={styles.heroTitle}>
                            Take the Stress Out of your Compliance Today
                        </h2>
                        <p className={styles.heroSubtitle}>
                            Powerful tools to simplify, streamline and strengthen your CARF compliance processes, all in one place.
                        </p>
                    </div>

                    {/* Features Grid */}
                    <div className={styles.featuresGrid}>
                        {features.map((feature, index) => (
                            <div key={index} className={styles.featureCard}>
                                <div className={styles.featureIcon}>
                                    {feature.icon}
                                </div>
                                <h3 className={styles.featureTitle}>{feature.title}</h3>
                                <p className={styles.featureDesc}>{feature.description}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
