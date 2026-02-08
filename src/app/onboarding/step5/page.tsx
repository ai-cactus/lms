'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, FileUpload, TagInput } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import styles from '@/app/onboarding/onboarding.module.css';
import Stepper from '@/components/onboarding/Stepper';

export default function OnboardingStep5() {
    const router = useRouter();
    const [emails, setEmails] = useState<string[]>([]);
    const [csvFile, setCsvFile] = useState<File | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [attemptedSkip, setAttemptedSkip] = useState(false);
    const [error, setError] = useState('');

    const validateEmail = (email: string) => {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        const hasData = emails.length > 0 || csvFile !== null;

        if (!hasData) {
            if (!attemptedSkip) {
                setAttemptedSkip(true);
                setError('Please add at least one worker. Click Next again to skip.');
                return;
            }
            // If already attempted, let them pass (skip)
            router.push('/onboarding/complete');
            return;
        }

        console.log('Step 5 Data:', { emails, csvFile });

        // Call the server action
        try {
            const { createInvites } = await import('@/app/actions/invite');

            // Retrieve actual Organization ID from localStorage (set in Step 1)
            let organizationId = '';
            if (typeof window !== 'undefined') {
                organizationId = localStorage.getItem('onboarding_org_id') || '';
            }

            if (!organizationId) {
                console.error('Real Life Check: No Organization ID found in storage. Please restart onboarding from Step 1.');
                setError('Organization ID missing. Please restart onboarding from Step 1.');
                return;
            }

            const result = await createInvites(emails, 'worker', organizationId);
            if (!result.success) {
                // Non-blocking error for now
                console.error('Invite failed:', result.error);
                setError(result.error || 'Failed to send invites');
                return;
            }
        } catch (e) {
            console.error('Error sending invites', e);
            setError('System error sending invites');
            return;
        }

        router.push('/onboarding/complete');
    };

    const handleCsvUpload = (files: File[]) => {
        if (files.length > 0) {
            setCsvFile(files[0]);
            setIsModalOpen(false);
            setEmails([]); // Clear manual input if CSV is used
            setAttemptedSkip(false);
            setError('');
        }
    };

    const removeCsv = () => {
        setCsvFile(null);
    };

    return (
        <div className={styles.stepContainer}>
            <Stepper currentStep={5} />

            <h1 className={styles.stepTitle}>Invite your Workers/Staffs</h1>
            <p className={styles.stepDescription}>
                Add your team so they can access assigned trainings and complete compliance requirements.
            </p>

            <form onSubmit={handleSubmit} className={styles.form}>

                {!csvFile ? (
                    <>
                        <div className={styles.formGroup}>
                            <TagInput
                                value={emails}
                                onChange={(newEmails) => {
                                    setEmails(newEmails);
                                    if (newEmails.length > 0) {
                                        setAttemptedSkip(false);
                                        setError('');
                                    }
                                }}
                                placeholder="Type email and press Enter..."
                                validate={validateEmail}
                                error={error}
                            />
                        </div>

                        <button
                            type="button"
                            onClick={() => setIsModalOpen(true)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                color: '#4C6EF5',
                                fontWeight: 600,
                                fontSize: '14px',
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '0',
                                width: 'fit-content'
                            }}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="12" y1="8" x2="12" y2="16"></line>
                                <line x1="8" y1="12" x2="16" y2="12"></line>
                            </svg>
                            Import with .csv file instead
                        </button>
                    </>
                ) : (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '16px',
                        background: 'white',
                        border: '1px solid #E2E8F0',
                        borderRadius: '8px',
                        justifyContent: 'space-between',
                        marginTop: '8px'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{
                                width: '32px',
                                height: '32px',
                                background: '#10B981', // Green for Excel/CSV
                                borderRadius: '6px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'white'
                            }}>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                    <polyline points="14 2 14 8 20 8"></polyline>
                                    <line x1="12" y1="18" x2="12" y2="12"></line>
                                    <line x1="9" y1="15" x2="15" y2="15"></line>
                                </svg>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span style={{ fontSize: '14px', fontWeight: 500, color: '#2D3748' }}>{csvFile.name}</span>
                                <span style={{ fontSize: '12px', color: '#A0AEC0' }}>{(csvFile.size / 1024).toFixed(2)} KB</span>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={removeCsv}
                            style={{
                                color: '#E53E3E',
                                padding: '8px',
                                cursor: 'pointer',
                                background: 'none',
                                border: 'none'
                            }}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </button>
                    </div>
                )}

                <div className={styles.actions}>
                    <Button variant="outline" type="button" onClick={() => router.push('/dashboard')}>
                        Skip for now
                    </Button>
                    <Button variant="primary" type="submit">
                        Next
                    </Button>
                </div>
            </form>

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
                <div style={{ padding: '24px', width: '500px', maxWidth: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                        <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#1A202C' }}>Upload .csv file</h2>
                        <button onClick={() => setIsModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#A0AEC0' }}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>

                    <p style={{ fontSize: '14px', color: '#718096', marginBottom: '16px' }}>
                        You can add multiple staffs from an uploaded csv file
                    </p>

                    <div style={{ height: '240px' }}>
                        <FileUpload
                            onFilesSelected={handleCsvUpload}
                            multiple={false}
                            accept=".csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            description=".csv or .xls files only. 10MB max."
                        />
                    </div>

                    <div style={{ marginTop: '24px' }}>
                        <Button variant="primary" onClick={() => { }} style={{ width: '100%' }}>
                            Continue
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
