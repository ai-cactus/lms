'use client';

import React, { useState } from 'react';
import styles from './WorkerProfile.module.css';
import { Button, Input, Modal } from '@/components/ui';
import { updateProfile } from '@/app/actions/user';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface WorkerProfileProps {
    user: {
        id: string;
        first_name: string;
        last_name: string;
        email: string;
        role: string;
        avatarUrl?: string | null;
    };
    organization?: {
        name: string;
        address?: string | null;
        city?: string | null;
        state?: string | null;
        zipCode?: string | null;
    } | null;
}

export default function WorkerProfileForm({ user, organization }: WorkerProfileProps) {
    const router = useRouter();
    const [formData, setFormData] = useState({
        first_name: user.first_name,
        last_name: user.last_name,
    });
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const [showConfirm, setShowConfirm] = useState(false);

    const isDirty = formData.first_name !== user.first_name || formData.last_name !== user.last_name;

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setShowConfirm(true);
    };

    const handleConfirmSave = async () => {
        setShowConfirm(false);
        setIsLoading(true);
        setMessage(null);

        try {
            const result = await updateProfile({
                first_name: formData.first_name,
                last_name: formData.last_name,
                // Worker cannot update company name, so we don't send it or send empty
            });

            if (result.success) {
                setMessage({ type: 'success', text: 'Profile updated successfully' });
                router.refresh();
            } else {
                setMessage({ type: 'error', text: result.error || 'Failed to update profile' });
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'An unexpected error occurred' });
        } finally {
            setIsLoading(false);
        }
    };

    const businessAddress = organization
        ? `${organization.address || ''}, ${organization.city || ''}`.replace(/^, /, '').replace(/, $/, '')
        : '';

    return (
        <div className={styles.container}>
            <Link href="/worker" className={styles.backLink}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="19" y1="12" x2="5" y2="12"></line>
                    <polyline points="12 19 5 12 12 5"></polyline>
                </svg>
                Back to dashboard
            </Link>

            <div className={styles.card}>
                <div className={styles.avatarWrapper}>
                    {user.avatarUrl ? (
                        <img src={user.avatarUrl} alt="Profile" className={styles.avatarImage} />
                    ) : (
                        <div className={styles.avatarFallback}>
                            {formData.first_name?.[0] || user.email[0].toUpperCase()}
                        </div>
                    )}
                    <button className={styles.editAvatarBtn} title="Change Avatar">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                </div>

                {message && (
                    <div className={`${styles.message} ${message.type === 'success' ? styles.success : styles.error}`}>
                        {message.text}
                    </div>
                )}

                <form onSubmit={handleSubmit} className={styles.form}>
                    <div className={styles.row}>
                        <div className={styles.fieldGroup}>
                            <label className={styles.label}>First Name</label>
                            <input
                                className={styles.input}
                                name="first_name"
                                value={formData.first_name}
                                onChange={handleChange}
                                placeholder="First Name"
                            />
                        </div>
                        <div className={styles.fieldGroup}>
                            <label className={styles.label}>Last Name</label>
                            <input
                                className={styles.input}
                                name="last_name"
                                value={formData.last_name}
                                onChange={handleChange}
                                placeholder="Last Name"
                            />
                        </div>
                    </div>

                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>Company</label>
                        <input
                            className={styles.input}
                            value={organization?.name || ''}
                            disabled
                            placeholder="Company Name"
                        />
                    </div>

                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>Email Address</label>
                        <input
                            className={styles.input}
                            value={user.email}
                            disabled
                        />
                    </div>

                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>Role</label>
                        <input
                            className={styles.input}
                            value={user.role === 'worker' ? 'Worker' : user.role === 'admin' ? 'Compliance Officer' : user.role}
                            disabled
                        />
                    </div>

                    <div className={styles.row}>
                        <div className={styles.fieldGroup}>
                            <label className={styles.label}>State</label>
                            <input
                                className={styles.input}
                                value={organization?.state || ''}
                                disabled
                                placeholder="State"
                            />
                        </div>
                        <div className={styles.fieldGroup}>
                            <label className={styles.label}>Zip Code</label>
                            <input
                                className={styles.input}
                                value={organization?.zipCode || ''}
                                disabled
                                placeholder="Zip Code"
                            />
                        </div>
                    </div>

                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>Business Address</label>
                        <input
                            className={styles.input}
                            value={businessAddress}
                            disabled
                            placeholder="Business Address"
                        />
                    </div>

                    <div className={styles.actions}>
                        <button
                            type="button"
                            className={styles.discardBtn}
                            onClick={() => setFormData({ first_name: user.first_name, last_name: user.last_name })}
                            disabled={!isDirty}
                        >
                            Discard
                        </button>
                        <button
                            type="submit"
                            className={`${styles.saveBtn} ${isDirty ? styles.active : ''}`}
                            disabled={!isDirty || isLoading}
                        >
                            {isLoading ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>
                </form>
            </div>

            <Modal isOpen={showConfirm} onClose={() => setShowConfirm(false)}>
                <div style={{ padding: '20px', textAlign: 'center' }}>
                    <h3 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '10px' }}>Confirm Changes</h3>
                    <p style={{ color: '#718096', marginBottom: '20px' }}>Are you sure you want to update your profile?</p>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '10px' }}>
                        <Button variant="secondary" onClick={() => setShowConfirm(false)}>Cancel</Button>
                        <Button variant="primary" onClick={handleConfirmSave}>Confirm</Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
