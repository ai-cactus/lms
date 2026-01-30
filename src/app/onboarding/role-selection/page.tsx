'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo, Button } from '@/components/ui';
import { createClient } from '@/utils/supabase/client';
import styles from './page.module.css';

export default function RoleSelectionPage() {
    const router = useRouter();
    const [selectedRole, setSelectedRole] = useState<'admin' | 'worker' | null>('admin');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const handleContinue = async () => {
        if (!selectedRole) return;
        setIsLoading(true);
        setError('');

        try {
            const supabase = createClient();

            // Get current user
            const { data: { user }, error: userError } = await supabase.auth.getUser();

            if (userError || !user) {
                setError('User not found. Please log in.');
                return;
            }

            // Update profile table
            const { error: updateError } = await supabase
                .from('profiles')
                .update({ role: selectedRole })
                .eq('id', user.id);

            if (updateError) {
                console.error('Error updating role:', updateError);
                setError('Failed to save role. Please try again.');
                return;
            }

            // Also update metadata for faster access if needed, but profile is primary now
            await supabase.auth.updateUser({
                data: { role: selectedRole }
            });

            // Redirect to dashboard
            router.push('/dashboard');

        } catch (err) {
            console.error('Unexpected error:', err);
            setError('An unexpected error occurred.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className={styles.wrapper}>
            <div className={styles.container}>
                <div className={styles.header}>
                    <Logo size="md" />
                </div>

                <h1 className={styles.title}>Tell us about your role</h1>
                <p className={styles.subtitle}>
                    Choose the option that best describes how you wish to use Theraptly.
                </p>

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
                        <h3 className={styles.roleName}>Admin</h3>
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
                    disabled={!selectedRole}
                >
                    Continue
                </Button>
            </div>
        </div>
    );
}
