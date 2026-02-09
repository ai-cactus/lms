'use client';

import React, { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { Button, Input, Select, FileUpload } from '@/components/ui';
import styles from '@/app/onboarding/onboarding.module.css'; // Reusing existing styles
import Stepper from '@/components/onboarding/Stepper';

interface Step2FormData {
    licenseNumber: string;
    hipaaCompliant: string;
}

export default function OnboardingStep2() {
    const router = useRouter();
    const { register, handleSubmit, control, formState: { errors } } = useForm<Step2FormData>();
    const [files, setFiles] = useState<File[]>([]);

    const onSubmit = async (data: Step2FormData) => {
        try {
            const { updateOrganization } = await import('@/app/actions/organization');
            const result = await updateOrganization({
                licenseNumber: data.licenseNumber,
                isHipaaCompliant: data.hipaaCompliant === 'yes'
            });

            if (result.success) {
                router.push('/onboarding/step3');
            } else {
                console.error('Failed to update organization:', result.error);
                // Handle error (could add a toast or form error)
            }
        } catch (error) {
            console.error('Submission error:', error);
        }
    };

    const handleFilesSelected = (newFiles: File[]) => {
        setFiles(prev => [...prev, ...newFiles]);
    };

    const removeFile = (index: number) => {
        setFiles(prev => prev.filter((_, i) => i !== index));
    };

    const formatFileSize = (bytes: number) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const getError = (fieldName: keyof Step2FormData) => {
        return errors[fieldName]?.message;
    };

    const getFileIconColor = (file: File) => {
        if (file.type === 'application/pdf') return '#E53E3E'; // Red for PDF
        if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || file.type === 'application/msword') return '#3182CE'; // Blue for DOCX
        return '#718096'; // Gray for others
    };

    const getFileIcon = (file: File) => {
        if (file.type === 'application/pdf') {
            return (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
            );
        }
        if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || file.type === 'application/msword') {
            return (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <path d="M10 13l2 4 2-4"></path> {/* Fake 'W' shape */}
                </svg>
            );
        }
        return (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
        );
    };

    return (
        <div className={styles.stepContainer}>
            <Stepper currentStep={2} />

            <h1 className={styles.stepTitle}>Credentialing & Documentation</h1>
            <p className={styles.stepDescription}>
                Provide key details about your licenses and documentation to ensure accurate assessments.
            </p>

            <form onSubmit={handleSubmit(onSubmit)} className={styles.form}>

                <div className={styles.row}>
                    <div className={`${styles.formGroup} ${styles.col}`}>
                        <label className={styles.label}>State Healthcare License Number <span className={styles.helperText}>(optional)</span></label>
                        <Input
                            {...register('licenseNumber')}
                            placeholder="Enter your official license number"
                        />
                    </div>
                    <div className={`${styles.formGroup} ${styles.col}`}>
                        <label className={styles.label}>HIPAA Compliance Confirmation <span className={styles.required}>*</span></label>
                        <Controller
                            name="hipaaCompliant"
                            control={control}
                            rules={{ required: "Compliance confirmation is required" }}
                            render={({ field }) => (
                                <Select
                                    value={field.value}
                                    onChange={field.onChange}
                                    options={[
                                        { label: 'Yes', value: 'yes' },
                                        { label: 'No', value: 'no' }
                                    ]}
                                    placeholder="Select an option"
                                    error={getError('hipaaCompliant')}
                                />
                            )}
                        />
                    </div>
                </div>

                <div className={styles.formGroup}>
                    <label className={styles.label}>Upload your compliance certifications <span className={styles.helperText}>(optional)</span></label>
                    <FileUpload onFilesSelected={handleFilesSelected} multiple={true} accept=".pdf,.docx,.jpg,.png" />

                    {files.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
                            {files.map((file, index) => {
                                const iconColor = getFileIconColor(file);
                                // Create a transparent version of the color in hex. 
                                // Since we return standard hex codes, we can append '1A' for ~10% opacity if it's 6 digits.
                                // Or use rgba. For simplicity, we'll assume 6 digit hex.
                                const bgColor = `${iconColor}1A`;

                                return (
                                    <div key={index} style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        padding: '16px',
                                        background: 'white',
                                        border: '1px solid #E2E8F0',
                                        borderRadius: '8px',
                                        justifyContent: 'space-between'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <div style={{
                                                width: '32px',
                                                height: '32px',
                                                background: bgColor,
                                                borderRadius: '6px',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                color: iconColor
                                            }}>
                                                {getFileIcon(file)}
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                <span style={{ fontSize: '14px', fontWeight: 500, color: '#2D3748' }}>{file.name}</span>
                                                <span style={{ fontSize: '12px', color: '#A0AEC0' }}>{formatFileSize(file.size)}</span>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => removeFile(index)}
                                            style={{
                                                color: '#A0AEC0',
                                                padding: '8px',
                                                cursor: 'pointer',
                                                background: 'none',
                                                border: 'none'
                                            }}
                                        >
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="3 6 5 6 21 6"></polyline>
                                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                            </svg>
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className={styles.actions}>
                    <Button variant="outline" type="button" onClick={() => router.push('/dashboard')}>
                        Skip for now
                    </Button>
                    <Button variant="primary" type="submit">
                        Next
                    </Button>
                </div>

            </form>
        </div>
    );
}
