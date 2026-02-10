'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, FileUpload, TagInput } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import styles from '@/app/onboarding/onboarding.module.css';
import Stepper from '@/components/onboarding/Stepper';
import * as XLSX from 'xlsx';

export default function OnboardingStep5() {
    const router = useRouter();
    const [emails, setEmails] = useState<string[]>([]);
    const [csvFile, setCsvFile] = useState<File | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [attemptedSkip, setAttemptedSkip] = useState(false);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [csvEmails, setCsvEmails] = useState<string[]>([]);

    const validateEmail = (email: string) => {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        // Combine manual emails and CSV emails
        const allEmails = [...emails, ...csvEmails];
        // If empty, but attempted skip or explicit skip logic matches original, handle usage:

        setIsLoading(true);

        try {
            // 1. Gather all data
            let allData: any = {};
            if (typeof window !== 'undefined') {
                allData = JSON.parse(localStorage.getItem('onboarding_data') || '{}');
            }

            // Add Step 5 data
            allData.step5 = { workerEmails: allEmails };

            console.log('Submitting Full Onboarding Data:', allData);

            // 2. Call Server Action
            const { completeOnboarding } = await import('@/app/actions/onboarding-complete');
            const result = await completeOnboarding(allData);

            if (!result.success) {
                setError(result.error || 'Failed to complete onboarding');
                setIsLoading(false);
                return;
            }

            // 3. Clear Storage
            if (typeof window !== 'undefined') {
                localStorage.removeItem('onboarding_data');
                // Remove old keys if any
                localStorage.removeItem('onboarding_org_id');
            }

            router.push('/onboarding/complete');

        } catch (e) {
            console.error('Error completing onboarding', e);
            setError('System error completing onboarding');
            setIsLoading(false);
            return;
        }
    };

    const handleCsvUpload = async (files: File[]) => {
        if (files.length === 0) return;

        const file = files[0];
        setIsLoading(true);
        setError('');

        try {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data, { type: 'array' });

            // Get first sheet
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];

            // Convert to JSON
            const jsonData = XLSX.utils.sheet_to_json<any>(sheet, { header: 1 });

            // Find email column (look for header or just use first column with emails)
            const extractedEmails: string[] = [];

            for (const row of jsonData) {
                if (Array.isArray(row)) {
                    for (const cell of row) {
                        if (typeof cell === 'string' && validateEmail(cell.trim())) {
                            extractedEmails.push(cell.trim().toLowerCase());
                        }
                    }
                }
            }

            // Remove duplicates
            const uniqueEmails = [...new Set(extractedEmails)];

            if (uniqueEmails.length === 0) {
                setError('No valid emails found in the file. Please check the file format.');
                setIsLoading(false);
                return;
            }

            setCsvFile(file);
            setCsvEmails(uniqueEmails);
            setIsModalOpen(false);
            setEmails([]); // Clear manual input if CSV is used
            setAttemptedSkip(false);

        } catch (err) {
            console.error('Error parsing file:', err);
            setError('Failed to parse file. Please check the format.');
        }

        setIsLoading(false);
    };

    const removeCsv = () => {
        setCsvFile(null);
        setCsvEmails([]);
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
                                <span style={{ fontSize: '12px', color: '#10B981' }}>{csvEmails.length} email{csvEmails.length !== 1 ? 's' : ''} found</span>
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
