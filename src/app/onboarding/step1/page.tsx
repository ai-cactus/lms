'use client';

import React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { Button, Input, Select } from '@/components/ui';
import styles from '@/app/onboarding/onboarding.module.css';
import Stepper from '@/components/onboarding/Stepper';

interface Step1FormData {
    legalName: string;
    dba: string;
    ein: string;
    staffCount: string;
    primaryContactName: string;
    primaryContactEmail: string;
    phone: string;
    country: string;
    streetAddress: string;
    zipCode: string;
    city: string;
    state: string;
}

export default function OnboardingStep1() {
    const router = useRouter();
    const { register, handleSubmit, control, formState: { errors } } = useForm<Step1FormData>();

    const onSubmit = async (data: Step1FormData) => {
        console.log('Step 1 Data VALIDATED:', data);

        try {
            const { createOrganization } = await import('@/app/actions/organization');
            const result = await createOrganization(data);

            if (result.success && result.organizationId) {
                // Determine if window is defined (client-side)
                if (typeof window !== 'undefined') {
                    localStorage.setItem('onboarding_org_id', result.organizationId);
                }
                router.push('/onboarding/step2');
            } else {
                console.error('Failed to create org:', result.error);
                // Optionally set form error here
            }
        } catch (error) {
            console.error('Submission error:', error);
        }
    };

    // Helper to get error message safely
    const getError = (fieldName: keyof Step1FormData) => {
        return errors[fieldName]?.message;
    };

    return (
        <div className={styles.stepContainer}>
            <Stepper currentStep={1} />

            <h1 className={styles.stepTitle}>Tell us about your organization</h1>
            <p className={styles.stepDescription}>
                Tell us about your organization so we can tailor the compliance analysis to your needs.
            </p>

            <form onSubmit={handleSubmit(onSubmit)} className={styles.form}>

                <div className={styles.formGroup}>
                    <label className={styles.label}>Legal Business Name <span className={styles.required}>*</span></label>
                    <Input
                        {...register('legalName', { required: "Legal Business Name is required" })}
                        placeholder="e.g. Zenco Healthcare Ltd"
                        error={getError('legalName')}
                    />
                </div>

                <div className={styles.formGroup}>
                    <label className={styles.label}>Doing Business As (DBA) <span className={styles.required}>*</span></label>
                    <Input
                        {...register('dba', { required: "DBA is required" })}
                        placeholder="Enter business name (if applicable)"
                        error={getError('dba')}
                    />
                </div>

                <div className={styles.row}>
                    <div className={`${styles.formGroup} ${styles.col}`}>
                        <label className={styles.label}>Employer Identification Number (EIN) <span className={styles.helperText}>(optional)</span></label>
                        <Input
                            {...register('ein')}
                            placeholder="Enter your EIN (if applicable)"
                        />
                    </div>
                    <div className={`${styles.formGroup} ${styles.col}`}>
                        <label className={styles.label}>Number of Staff <span className={styles.required}>*</span></label>
                        <Controller
                            name="staffCount"
                            control={control}
                            rules={{ required: "Staff Count is required" }}
                            render={({ field }) => (
                                <Select
                                    value={field.value}
                                    onChange={field.onChange}
                                    options={[
                                        { label: '1-10', value: '1-10' },
                                        { label: '11-49', value: '11-49' },
                                        { label: '50-499', value: '50-499' },
                                        { label: '500+', value: '500+' }
                                    ]}
                                    placeholder="Select an option"
                                    error={getError('staffCount')}
                                />
                            )}
                        />
                    </div>
                </div>

                <div className={styles.row}>
                    <div className={`${styles.formGroup} ${styles.col}`}>
                        <label className={styles.label}>Primary Contact Name <span className={styles.required}>*</span></label>
                        <Input
                            {...register('primaryContactName', { required: "Primary Contact Name is required" })}
                            placeholder="Enter the full name of the main contact"
                            error={getError('primaryContactName')}
                        />
                    </div>
                    <div className={`${styles.formGroup} ${styles.col}`}>
                        <label className={styles.label}>Primary Contact Email <span className={styles.required}>*</span></label>
                        <Input
                            {...register('primaryContactEmail', {
                                required: "Primary Contact Email is required",
                                pattern: {
                                    value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
                                    message: "Invalid email address"
                                }
                            })}
                            type="email"
                            placeholder="Enter the email address of the main contact"
                            error={getError('primaryContactEmail')}
                        />
                    </div>
                </div>

                <div className={styles.row}>
                    <div className={`${styles.formGroup} ${styles.col}`}>
                        <label className={styles.label}>Country <span className={styles.required}>*</span></label>
                        <Controller
                            name="country"
                            control={control}
                            rules={{ required: "Country is required" }}
                            render={({ field }) => (
                                <Select
                                    value={field.value}
                                    onChange={field.onChange}
                                    options={[
                                        { label: 'United States', value: 'US' },
                                        { label: 'Canada', value: 'CA' },
                                        { label: 'United Kingdom', value: 'UK' }
                                    ]}
                                    placeholder="Select an option"
                                    error={getError('country')}
                                />
                            )}
                        />
                    </div>
                    <div className={`${styles.formGroup} ${styles.col}`}>
                        <label className={styles.label}>Phone Number <span className={styles.required}>*</span></label>
                        <Input
                            {...register('phone', { required: "Phone Number is required" })}
                            placeholder="Enter the phone number"
                            error={getError('phone')}
                        />
                    </div>
                </div>

                <div className={styles.row}>
                    <div className={`${styles.formGroup} ${styles.col}`}>
                        <label className={styles.label}>Street Address <span className={styles.helperText}>(optional)</span></label>
                        <Input
                            {...register('streetAddress')}
                            placeholder="Enter business street address"
                        />
                    </div>
                    <div className={`${styles.formGroup} ${styles.col}`}>
                        <label className={styles.label}>Zip Code <span className={styles.helperText}>(optional)</span></label>
                        <Input
                            {...register('zipCode')}
                            placeholder="e.g. 27601"
                        />
                    </div>
                </div>

                <div className={styles.row}>
                    <div className={`${styles.formGroup} ${styles.col}`}>
                        <label className={styles.label}>City <span className={styles.helperText}>(optional)</span></label>
                        <Input
                            {...register('city')}
                            placeholder="Enter city"
                        />
                    </div>
                    <div className={`${styles.formGroup} ${styles.col}`}>
                        <label className={styles.label}>State <span className={styles.helperText}>(optional)</span></label>
                        <Controller
                            name="state"
                            control={control}
                            render={({ field }) => (
                                <Select
                                    value={field.value}
                                    onChange={field.onChange}
                                    options={[
                                        { label: 'California', value: 'CA' },
                                        { label: 'New York', value: 'NY' },
                                        { label: 'Texas', value: 'TX' }
                                        // Add more as needed
                                    ]}
                                    placeholder="Select an option"
                                />
                            )}
                        />
                    </div>
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
