'use client';

import React, { useState } from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { Button, Input, Select, FileUpload } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import styles from '@/app/onboarding/onboarding.module.css';
import Stepper from '@/components/onboarding/Stepper';
import * as XLSX from 'xlsx';

interface InviteValues {
    email: string;
    role: string;
    permissions: string;
}

interface Step4FormData {
    invites: InviteValues[];
}

export default function OnboardingStep4() {
    const router = useRouter();
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    
    // CSV State
    const [csvFile, setCsvFile] = useState<File | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [csvEmails, setCsvEmails] = useState<string[]>([]);

    const { control, register, handleSubmit } = useForm<Step4FormData>({
        defaultValues: {
            invites: [
                { email: '', role: '', permissions: '' },
                { email: '', role: '', permissions: '' },
                { email: '', role: '', permissions: '' }
            ]
        }
    });

    const { fields, append } = useFieldArray({
        control,
        name: "invites"
    });

    const validateEmail = (email: string) => {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

    const onSubmit = async (data: Step4FormData) => {
        setError('');
        setIsLoading(true);
        // Filter out empty invites
        const validInvites = data.invites.filter(invite => invite.email && invite.role);
        
        try {
            let allData: any = {};
            if (typeof window !== 'undefined') {
                allData = JSON.parse(localStorage.getItem('onboarding_data') || '{}');
            }

            // Add Step 4 data: team member invites AND worker CSV emails
            allData.step4 = { 
                invites: validInvites,
                workerEmails: csvEmails
            };

            console.log('Submitting Full Onboarding Data:', allData);

            // Call Server Action
            const { completeOnboarding } = await import('@/app/actions/onboarding-complete');
            const result = await completeOnboarding(allData);

            if (!result.success) {
                setError(result.error || 'Failed to complete onboarding');
                setIsLoading(false);
                return;
            }

            // Clear Storage
            if (typeof window !== 'undefined') {
                localStorage.removeItem('onboarding_data');
                localStorage.removeItem('onboarding_org_id');
            }

            router.push('/onboarding/complete');

        } catch (err) {
            console.error('Error in Step 4 submission:', err);
            setError('An error occurred while saving.');
            setIsLoading(false);
        }
    };

    const handleSkip = async () => {
        // We can just call onSubmit with what we have (even if empty) to trigger completeOnboarding
        onSubmit({ invites: [] });
    };

    return (
        <div className={styles.stepContainer}>
            <Stepper currentStep={4} />

            <h1 className={styles.stepTitle}>Invite Team Members</h1>
            <p className={styles.stepDescription}>
                Invite your team members to your organization to manage your learning system
            </p>

            {error && (
                <div style={{ padding: '12px', marginBottom: '16px', backgroundColor: '#FEE2E2', color: '#DC2626', borderRadius: '6px', fontSize: '14px' }}>
                    {error}
                </div>
            )}

            <form onSubmit={handleSubmit(onSubmit)} className={styles.form}>

                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)', gap: '16px', marginBottom: '8px' }}>
                    <label className={styles.label}>Email</label>
                    <label className={styles.label}>Roles</label>
                    <label className={styles.label}>Permissions</label>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {fields.map((field, index) => (
                        <div key={field.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)', gap: '16px', alignItems: 'start' }}>
                            <Input
                                {...register(`invites.${index}.email`)}
                                placeholder="Enter team member's email"
                                leftIcon={
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#A0AEC0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3" y="5" width="18" height="14" rx="2" ry="2"></rect>
                                        <polyline points="3 7 12 13 21 7"></polyline>
                                    </svg>
                                }
                            />

                            <Controller
                                name={`invites.${index}.role`}
                                control={control}
                                render={({ field }) => (
                                    <Select
                                        value={field.value}
                                        onChange={field.onChange}
                                        options={[
                                            { label: 'Worker', value: 'worker' },
                                            { label: 'Admin', value: 'admin' }
                                        ]}
                                        placeholder="Select role"
                                    />
                                )}
                            />

                            <Controller
                                name={`invites.${index}.permissions`}
                                control={control}
                                render={({ field }) => (
                                    <Select
                                        value={field.value}
                                        onChange={field.onChange}
                                        options={[
                                            { label: 'Full Access', value: 'full' },
                                            { label: 'View Only', value: 'view' },
                                            { label: 'Edit', value: 'edit' }
                                        ]}
                                        placeholder="Permissions"
                                    />
                                )}
                            />
                        </div>
                    ))}
                </div>

                <Button
                    variant="ghost"
                    size="md"
                    onClick={() => append({ email: '', role: '', permissions: '' })}
                    type="button"
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        color: '#4C6EF5',
                        fontWeight: 600,
                        marginTop: '8px',
                        width: 'fit-content'
                    }}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"></circle>
                        <line x1="12" y1="8" x2="12" y2="16"></line>
                        <line x1="8" y1="12" x2="16" y2="12"></line>
                    </svg>
                    Add team member
                </Button>

                <div style={{ marginTop: '24px', marginBottom: '8px', borderTop: '1px solid #E2E8F0', paddingTop: '24px' }}>
                    <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#1A202C', marginBottom: '8px' }}>Invite Multiple Workers</h2>
                    <p style={{ fontSize: '14px', color: '#718096', marginBottom: '16px' }}>Import a .csv file to invite a large list of workers.</p>
                    
                    {!csvFile ? (
                        <Button
                            variant="ghost"
                            size="md"
                            onClick={() => setIsModalOpen(true)}
                            type="button"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                color: '#4C6EF5',
                                fontWeight: 600,
                                width: 'fit-content',
                                paddingLeft: 0,
                                paddingRight: 0
                            }}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="12" y1="8" x2="12" y2="16"></line>
                                <line x1="8" y1="12" x2="16" y2="12"></line>
                            </svg>
                            Import with .csv file instead
                        </Button>
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
                                    background: '#10B981',
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
                                    <span style={{ fontSize: '12px', color: '#10B981' }}>{csvEmails.length} worker email{csvEmails.length !== 1 ? 's' : ''} found</span>
                                </div>
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={removeCsv}
                                style={{ color: '#E53E3E' }}
                                type="button"
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="3 6 5 6 21 6"></polyline>
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                </svg>
                            </Button>
                        </div>
                    )}
                </div>

                <div className={styles.actions}>
                    <Button variant="outline" type="button" onClick={handleSkip} disabled={isLoading}>
                        Skip for now
                    </Button>
                    <Button variant="primary" type="submit" loading={isLoading}>
                        Complete Onboarding
                    </Button>
                </div>
            </form>

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)}>
                <div style={{ padding: '24px', width: '500px', maxWidth: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                        <h2 style={{ fontSize: '20px', fontWeight: 600, color: '#1A202C' }}>Upload .csv file</h2>
                        <Button variant="ghost" size="icon-md" onClick={() => setIsModalOpen(false)}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </Button>
                    </div>

                    <p style={{ fontSize: '14px', color: '#718096', marginBottom: '16px' }}>
                        You can add multiple workers from an uploaded csv file
                    </p>

                    <div style={{ height: '240px' }}>
                        <FileUpload
                            onFilesSelected={handleCsvUpload}
                            multiple={false}
                            accept=".csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                            description=".csv or .xls files only. 10MB max."
                        />
                    </div>
                </div>
            </Modal>
        </div>
    );
}
