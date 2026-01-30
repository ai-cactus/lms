'use client';

import React, { useState, useActionState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Logo, Input, Button } from '@/components/ui';
import { authenticate } from '@/app/actions/auth';
import styles from './page.module.css';

// Feature data from Figma
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

export default function LoginPage() {
    const router = useRouter();
    const [errorMessage, dispatch, isPending] = useActionState(authenticate, undefined);

    const [formData, setFormData] = useState({
        email: '',
        password: '',
        rememberMe: false,
    });
    const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

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
        } else if (formData.password.length < 6) {
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

        dispatch(form);
    };

    useEffect(() => {
        if (errorMessage) {
            setErrors(prev => ({ ...prev, email: errorMessage }));
        }
    }, [errorMessage]);

    return (
        <div className={styles.container}>
            {/* Left Side - Form */}
            <div className={styles.formSection}>
                <div className={styles.formContent}>
                    <Logo size="md" />

                    <div className={styles.formHeader}>
                        <h1 className={styles.title}>Welcome back</h1>
                        <p className={styles.subtitle}>
                            Enter your credentials to access your account
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className={styles.form}>
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
                            placeholder="Enter your password"
                            value={formData.password}
                            onChange={handleChange}
                            error={errors.password}
                            autoComplete="current-password"
                        />

                        <div className={styles.formOptions}>
                            <label className={styles.rememberMe}>
                                <input
                                    type="checkbox"
                                    name="rememberMe"
                                    checked={formData.rememberMe}
                                    onChange={handleChange}
                                    className={styles.checkbox}
                                />
                                <span>Remember me</span>
                            </label>
                            <Link href="/forgot-password" className={styles.link}>
                                Forgot Password?
                            </Link>
                        </div>

                        <Button
                            type="submit"
                            size="lg"
                            fullWidth
                            loading={isPending}
                        >
                            Login
                        </Button>
                    </form>

                    <p className={styles.signupPrompt}>
                        Don&apos;t have an account?{' '}
                        <Link href="/signup" className={styles.signupLink}>
                            Sign Up
                        </Link>
                    </p>
                </div>
            </div>

            {/* Right Side - Hero (Built with code, doodle SVG as background) */}
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
