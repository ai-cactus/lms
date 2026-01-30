'use client';

import React, { useState } from 'react';
import styles from './ProfileForm.module.css';
import { Button, Input, Modal, Select } from '@/components/ui';
import { updateProfile } from '@/app/actions/user';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface ProfileData {
    id: string;
    first_name: string;
    last_name: string;
    email: string; // From auth.users, rendered as read-only or fetched from profile if replicated
    role: 'admin' | 'worker';
    company_name?: string;
}

interface ProfileFormProps {
    initialData: ProfileData;
}

export default function ProfileForm({ initialData }: ProfileFormProps) {
    const [formData, setFormData] = useState(initialData);
    const [isLoading, setIsLoading] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
    const router = useRouter();

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    // Sync initialData when it changes
    React.useEffect(() => {
        setFormData(initialData);
    }, [initialData]);

    // Auto-dismiss message after 10 seconds
    React.useEffect(() => {
        if (message) {
            const timer = setTimeout(() => {
                setMessage(null);
            }, 10000);
            return () => clearTimeout(timer);
        }
    }, [message]);

    const isDirty =
        formData.first_name !== initialData.first_name ||
        formData.last_name !== initialData.last_name ||
        formData.role !== initialData.role ||
        // Handle undefined/null vs empty string differences
        (formData.company_name || '') !== (initialData.company_name || '');

    // Debug logging
    console.log('Form State:', { active: isDirty, formData, initialData });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setMessage(null);
        setShowConfirm(true);
    };

    const handleConfirmSave = async () => {
        setShowConfirm(false);
        setIsLoading(true);

        try {
            const result = await updateProfile({
                first_name: formData.first_name,
                last_name: formData.last_name,
                company_name: formData.company_name,
            });

            if (!result.success) throw new Error(result.error);

            setMessage({ type: 'success', text: 'Profile updated successfully' });
            router.refresh();
        } catch (error: any) {
            setMessage({ type: 'error', text: error.message || 'Failed to update profile' });
        } finally {
            setIsLoading(false);
        }
    };



    // Validation Logic
    const validateEmail = (email: string) => {
        return String(email)
            .toLowerCase()
            .match(
                /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
            );
    };

    const isValid =
        formData.first_name?.trim() !== '' &&
        formData.last_name?.trim() !== '' &&
        formData.email?.trim() !== '' &&
        validateEmail(formData.email);

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <Link href="/dashboard" className={styles.backLink}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="19" y1="12" x2="5" y2="12"></line>
                        <polyline points="12 19 5 12 12 5"></polyline>
                    </svg>
                    Back to dashboard
                </Link>
            </div>

            <div className={styles.card}>
                <div className={styles.tabs}>
                    <button className={`${styles.tab} ${styles.activeTab}`}>EDIT PROFILE</button>
                    <button className={styles.tab}>YOUR ORGANIZATION</button>
                </div>

                <div className={styles.profileHeader}>
                    <div className={styles.avatarLarge}>
                        {formData.first_name ? formData.first_name[0] : 'U'}
                        <button className={styles.editAvatarButton}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M12 20h9"></path>
                                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
                            </svg>
                        </button>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className={styles.form}>
                    <div className={styles.formGrid}>
                        <div className={styles.fieldGroup}>
                            <label className={styles.label}>First Name</label>
                            <Input
                                name="first_name"
                                value={formData.first_name}
                                onChange={handleChange}
                                placeholder="Jane"
                                error={!formData.first_name.trim() ? "First name is required" : undefined}
                            />
                        </div>
                        <div className={styles.fieldGroup}>
                            <label className={styles.label}>Last Name</label>
                            <Input
                                name="last_name"
                                value={formData.last_name}
                                onChange={handleChange}
                                placeholder="Doe"
                                error={!formData.last_name.trim() ? "Last name is required" : undefined}
                            />
                        </div>
                    </div>

                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>Company</label>
                        <Input
                            name="company_name"
                            value={formData.company_name || ''}
                            onChange={handleChange}
                            placeholder="Enter your company name"
                        />
                    </div>

                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>Email Address</label>
                        <Input
                            name="email"
                            value={formData.email}
                            disabled
                            className={styles.readOnlyInput}
                            // Although email is disabled/read-only in this form as per previous request, 
                            // if it were editable, this error would show.
                            // Since user asked for the rule, we implement it for completeness in case it becomes editable.
                            error={!formData.email.trim() || !validateEmail(formData.email) ? "Terminates with valid email required" : undefined}
                        />
                    </div>

                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>Role</label>
                        <Select
                            value={formData.role}
                            onChange={(value) => setFormData(prev => ({ ...prev, role: value as 'admin' | 'worker' }))}
                            options={[
                                { label: 'Compliance Professional (Admin)', value: 'admin' },
                                { label: 'Worker', value: 'worker' }
                            ]}
                            disabled={true} // Role cannot be changed after signup
                        />
                    </div>

                    {message && (
                        <div className={`${styles.message} ${styles[message.type]}`}>
                            {message.text}
                        </div>
                    )}

                    <div className={styles.actions}>
                        <Button
                            variant="primary"
                            type="submit"
                            disabled={!isDirty || !isValid || isLoading}
                            className={styles.saveButton}
                        >
                            {isLoading ? 'Saving...' : 'Save Changes'}
                        </Button>
                    </div>
                </form>
            </div>

            {/* Confirmation Modal */}
            <Modal isOpen={showConfirm} onClose={() => setShowConfirm(false)}>
                <div className={styles.modalContent}>
                    <div className={styles.modalIcon}>
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </div>
                    <h3 className={styles.modalTitle}>Confirm profile update</h3>
                    <p className={styles.modalText}>
                        Are you sure you want to make these changes to your profile?
                    </p>
                    <div className={styles.modalActions}>
                        <Button
                            variant="secondary"
                            onClick={() => setShowConfirm(false)}
                            className={styles.modalCancel}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="primary"
                            onClick={handleConfirmSave}
                            className={styles.modalConfirm}
                        >
                            Confirm
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
