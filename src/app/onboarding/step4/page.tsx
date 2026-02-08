'use client';

import React, { useState } from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { useRouter } from 'next/navigation';
import { Button, Input, Select } from '@/components/ui';
import styles from '@/app/onboarding/onboarding.module.css';
import Stepper from '@/components/onboarding/Stepper';

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
    const { control, register, handleSubmit } = useForm<Step4FormData>({
        defaultValues: {
            invites: [
                { email: '', role: '', permissions: '' },
                { email: '', role: '', permissions: '' },
                { email: '', role: '', permissions: '' }
            ]
        }
    });

    const { fields, append, remove } = useFieldArray({
        control,
        name: "invites"
    });

    const onSubmit = async (data: Step4FormData) => {
        setError('');
        // Filter out empty invites
        const validInvites = data.invites.filter(invite => invite.email && invite.role);
        console.log('Step 4 Data (Valid Invites):', validInvites);

        if (validInvites.length === 0) {
            router.push('/onboarding/step5');
            return;
        }

        try {
            // Retrieve actual Organization ID from localStorage (set in Step 1)
            let organizationId = '';
            if (typeof window !== 'undefined') {
                organizationId = localStorage.getItem('onboarding_org_id') || '';
            }

            if (!organizationId) {
                console.error('Real Life Check: No Organization ID found in storage.');
                setError('Organization ID missing. Please restart onboarding from Step 1.');
                return;
            }

            const { createInvites } = await import('@/app/actions/invite');

            // Group invites by role to minimize API calls
            const invitesByRole: Record<string, string[]> = {};
            validInvites.forEach(invite => {
                if (!invitesByRole[invite.role]) {
                    invitesByRole[invite.role] = [];
                }
                invitesByRole[invite.role].push(invite.email);
            });

            // Send invites for each role
            const results = await Promise.all(
                Object.entries(invitesByRole).map(async ([role, emails]) => {
                    return createInvites(emails, role, organizationId);
                })
            );

            // Check for failures
            const failures = results.filter(r => !r.success);
            if (failures.length > 0) {
                console.error('Some invites failed:', failures);
                setError('Some invites failed to send. Please try again.');
                return;
            }

            console.log('All Step 4 invites sent successfully');
            router.push('/onboarding/step5');

        } catch (err) {
            console.error('Error in Step 4 submission:', err);
            setError('An error occurred while sending invites.');
        }
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
                                            { label: 'Admin', value: 'admin' },
                                            { label: 'Supervisor', value: 'supervisor' },
                                            { label: 'Manager', value: 'manager' }
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
                                        placeholder="Permissions" // Using placeholder as "Permissions" label in select when empty? Or Select role...
                                    // The design shows "Permissions" as the placeholder text inside the select box
                                    />
                                )}
                            />
                        </div>
                    ))}
                </div>

                <button
                    type="button"
                    onClick={() => append({ email: '', role: '', permissions: '' })}
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
                        padding: '8px 0',
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
                </button>

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
