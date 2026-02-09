'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Checkbox, Logo } from '@/components/ui';
import styles from './JoinPage.module.css';

interface JoinPageClientProps {
    invite: any;
    orgName: string;
}

export default function JoinPageClient({ invite, orgName }: JoinPageClientProps) {
    const router = useRouter();
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [agreed, setAgreed] = useState(false);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [showBanner, setShowBanner] = useState(true);

    // Capitalize role for display
    const displayRole = invite.role.charAt(0).toUpperCase() + invite.role.slice(1);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (!firstName.trim() || !lastName.trim()) {
            setError('Please enter your first and last name');
            return;
        }

        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        if (password.length < 8) {
            setError('Password must be at least 8 characters');
            return;
        }

        if (!agreed) {
            setError('You must agree to the Terms of Service');
            return;
        }

        setIsLoading(true);

        try {
            const response = await fetch('/api/invite/accept', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    token: invite.token,
                    firstName,
                    lastName,
                    password
                })
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to create account');
            }

            router.push('/login?joined=true');

        } catch (err: any) {
            setError(err.message);
            setIsLoading(false);
        }
    };

    return (
        <div className={styles.container}>
            {/* Rainbow Gradient Header */}
            <div className={styles.gradientHeader} />

            {/* Main Content */}
            <div className={styles.content}>
                {/* Logo */}
                <div className={styles.logo}>
                    <Logo size="md" />
                </div>

                {/* Notification Banner */}
                {showBanner && (
                    <div className={styles.notificationBanner}>
                        <svg className={styles.notificationIcon} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="16" x2="12" y2="12" />
                            <line x1="12" y1="8" x2="12.01" y2="8" />
                        </svg>
                        <span className={styles.notificationText}>
                            You've been invited to join <strong>{orgName}</strong> as a <strong>{displayRole}</strong>.
                        </span>
                        <button
                            className={styles.closeButton}
                            onClick={() => setShowBanner(false)}
                            type="button"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    </div>
                )}

                {/* Title */}
                <div className={styles.titleSection}>
                    <h1 className={styles.title}>
                        You're joining <span>{orgName}</span> as a <span>{displayRole}</span>.
                    </h1>
                    <h2 className={styles.subtitle}>Sign in to continue</h2>
                </div>

                {/* Error Banner */}
                {error && <div className={styles.errorBanner}>{error}</div>}

                {/* Form */}
                <form onSubmit={handleSubmit} className={styles.form}>
                    {/* Name Row */}
                    <div className={styles.row}>
                        <Input
                            label="First Name"
                            placeholder="Enter your first name"
                            value={firstName}
                            onChange={(e) => setFirstName(e.target.value)}
                            required
                        />
                        <Input
                            label="Last Name"
                            placeholder="Enter your last name"
                            value={lastName}
                            onChange={(e) => setLastName(e.target.value)}
                            required
                        />
                    </div>

                    {/* Work Email (Disabled) */}
                    <div className={styles.field}>
                        <label className={styles.label}>Work Email</label>
                        <div className={styles.disabledField}>{invite.email}</div>
                    </div>

                    {/* Assigned Role (Disabled) */}
                    <div className={styles.field}>
                        <label className={styles.label}>Assigned role</label>
                        <div className={styles.disabledField}>{displayRole}</div>
                    </div>

                    {/* Password */}
                    <Input
                        label="Password"
                        type="password"
                        placeholder="Password (at least 8 characters long)"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />

                    {/* Confirm Password */}
                    <Input
                        label="Confirm Password"
                        type="password"
                        placeholder="Password (at least 8 characters long)"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                    />

                    {/* Terms Checkbox */}
                    <div className={styles.checkboxWrapper}>
                        <Checkbox
                            checked={agreed}
                            onChange={(e) => setAgreed(e.target.checked)}
                            label={
                                <>
                                    Yes, I understand and agree to the{' '}
                                    <a href="/terms" target="_blank" rel="noopener noreferrer">
                                        Theraptly Terms of Service
                                    </a>
                                </>
                            }
                        />
                    </div>

                    {/* Submit Button */}
                    <Button
                        type="submit"
                        variant="primary"
                        className={styles.submitButton}
                        loading={isLoading}
                        disabled={isLoading}
                    >
                        Create Account
                    </Button>
                </form>
            </div>
        </div>
    );
}
