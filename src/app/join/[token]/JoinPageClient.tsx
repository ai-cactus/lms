'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Checkbox } from '@/components/ui';
import styles from './JoinPage.module.css';

interface JoinPageClientProps {
    invite: any; // Type safe in real app
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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        if (!agreed) {
            setError('You must agree to the Terms of Service');
            return;
        }

        if (password.length < 8) {
            setError('Password must be at least 8 characters');
            return;
        }

        setIsLoading(true);

        try {
            // Call API to create user
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

            // Success! Redirect to login or dashboard
            router.push('/login?joined=true');

        } catch (err: any) {
            setError(err.message);
            setIsLoading(false);
        }
    };

    return (
        <div className={styles.container}>
            <div className={styles.card}>
                <div className={styles.logo}>
                    {/* Placeholder for Logo */}
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#4C6EF5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="16"></line>
                        <line x1="8" y1="12" x2="16" y2="12"></line>
                    </svg>
                </div>

                <h1 className={styles.title}>
                    You're joining <span>{orgName}</span> as a <span>{invite.role}</span>.
                </h1>
                <h2 className={styles.subtitle}>Sign in to continue</h2>

                {error && <div className={styles.errorBanner}>{error}</div>}

                <form onSubmit={handleSubmit} className={styles.form}>
                    <div className={styles.row}>
                        <Input
                            label="First Name"
                            placeholder="John"
                            value={firstName}
                            onChange={(e) => setFirstName(e.target.value)}
                            required
                        />
                        <Input
                            label="Last Name"
                            placeholder="Doe"
                            value={lastName}
                            onChange={(e) => setLastName(e.target.value)}
                            required
                        />
                    </div>

                    <Input
                        label="Work Email"
                        value={invite.email}
                        disabled
                        className={styles.disabledInput}
                    />

                    <div className={styles.field}>
                        <label className={styles.label}>Assigned role</label>
                        <div className={styles.disabledBox}>{invite.role}</div>
                    </div>

                    <Input
                        label="Password"
                        type="password"
                        placeholder="Password (at least 8 characters long)"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />

                    <Input
                        label="Confirm Password"
                        type="password"
                        placeholder="Password (at least 8 characters long)"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                    />

                    <div className={styles.checkboxWrapper}>
                        <Checkbox
                            checked={agreed}
                            onChange={(e) => setAgreed(e.target.checked)}
                            label="Yes, I understand and agree to the Theraptly Terms of Service"
                        />
                    </div>

                    <Button type="submit" variant="primary" className={styles.submitButton} disabled={isLoading}>
                        {isLoading ? 'Creating Account...' : 'Create Account'}
                    </Button>
                </form>
            </div>
        </div>
    );
}
