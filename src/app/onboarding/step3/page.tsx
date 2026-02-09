'use client';

import React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { Button, Select, Checkbox } from '@/components/ui';
import styles from '@/app/onboarding/onboarding.module.css';
import Stepper from '@/components/onboarding/Stepper';

interface Step3FormData {
    primaryBusinessType: string;
    additionalBusinessType: string;
    services: string[];
}

const PROGRAM_SERVICES = [
    { id: 'aging', label: 'Aging Services' },
    { id: 'behavioral', label: 'Behavioral Health' },
    { id: 'child-youth', label: 'Child & Youth Services' },
    { id: 'employment', label: 'Employment & Community Services' },
    { id: 'medical-rehab', label: 'Medical Rehabilitation' },
    { id: 'opioid', label: 'Opioid Treatment Program' },
    { id: 'vision', label: 'Vision Rehabilitation Services' },
];

export default function OnboardingStep3() {
    const router = useRouter();
    const { control, handleSubmit, formState: { errors } } = useForm<Step3FormData>({
        defaultValues: {
            services: [] // Initialize as empty array
        }
    });

    const onSubmit = async (data: Step3FormData) => {
        try {
            const { updateOrganization } = await import('@/app/actions/organization');
            const result = await updateOrganization({
                primaryBusinessType: data.primaryBusinessType,
                additionalBusinessTypes: data.additionalBusinessType ? [data.additionalBusinessType] : [],
                programServices: data.services
            });

            if (result.success) {
                router.push('/onboarding/step4');
            } else {
                console.error('Failed to update organization:', result.error);
            }
        } catch (error) {
            console.error('Submission error:', error);
        }
    };

    const getError = (fieldName: keyof Step3FormData) => {
        return errors[fieldName]?.message;
    };

    return (
        <div className={styles.stepContainer}>
            <Stepper currentStep={3} />

            <h1 className={styles.stepTitle}>Help us understand your Services</h1>
            <p className={styles.stepDescription}>
                Choose the services that reflect the people you service
            </p>

            <form onSubmit={handleSubmit(onSubmit)} className={styles.form}>

                <div className={styles.row}>
                    <div className={`${styles.formGroup} ${styles.col}`}>
                        <label className={styles.label}>Primary Business Type <span className={styles.required}>*</span></label>
                        <Controller
                            name="primaryBusinessType"
                            control={control}
                            rules={{ required: "Primary Business Type is required" }}
                            render={({ field }) => (
                                <Select
                                    value={field.value}
                                    onChange={field.onChange}
                                    options={[
                                        { label: 'Solo / Independent Provider', value: 'solo' },
                                        { label: 'Group Practice', value: 'group' },
                                        { label: 'Clinic', value: 'clinic' },
                                        { label: 'Hospital', value: 'hospital' }
                                    ]}
                                    placeholder="Select an option"
                                    error={getError('primaryBusinessType')}
                                />
                            )}
                        />
                    </div>
                    <div className={`${styles.formGroup} ${styles.col}`}>
                        <label className={styles.label}>Additional Business Type <span className={styles.required}>*</span></label>
                        <Controller
                            name="additionalBusinessType"
                            control={control}
                            rules={{ required: "Additional Business Type is required" }}
                            render={({ field }) => (
                                <Select
                                    value={field.value}
                                    onChange={field.onChange}
                                    options={[
                                        { label: 'None', value: 'none' },
                                        { label: 'Non-Profit', value: 'non-profit' },
                                        { label: 'Private', value: 'private' },
                                        { label: 'Public', value: 'public' }
                                    ]}
                                    placeholder="Select an option"
                                    error={getError('additionalBusinessType')}
                                />
                            )}
                        />
                    </div>
                </div>

                <div className={styles.formGroup}>
                    <label className={styles.label} style={{ marginBottom: '16px', display: 'block' }}>Program Services</label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        {PROGRAM_SERVICES.map((service) => (
                            <Controller
                                key={service.id}
                                name="services"
                                control={control}
                                render={({ field }) => {
                                    const isChecked = field.value.includes(service.id);
                                    return (
                                        <Checkbox
                                            label={service.label}
                                            checked={isChecked}
                                            onChange={(e) => {
                                                if (e.target.checked) {
                                                    field.onChange([...field.value, service.id]);
                                                } else {
                                                    field.onChange(field.value.filter((v) => v !== service.id));
                                                }
                                            }}
                                        />
                                    );
                                }}
                            />
                        ))}
                    </div>
                    {errors.services && <span className={styles.error} style={{ marginTop: '8px', display: 'block' }}>Please select at least one service/although optional for logic check</span>}
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
