'use client';

import React, { useState, useEffect } from 'react';
import styles from './ProfileForm.module.css';
import { updateOrganization } from '@/app/actions/organization';
import { generateOrganizationCode, getOrganizationCode } from '@/app/actions/organization-code';
import { useRouter } from 'next/navigation';
import { Button, Input, Select, Checkbox } from '@/components/ui';

interface OrganizationData {
    id: string;
    name: string;
    dba?: string | null;
    ein?: string | null;
    staffCount?: string | null;
    primaryContact?: string | null;
    primaryEmail?: string | null;
    phone?: string | null;
    address?: string | null;
    country?: string | null;
    state?: string | null;
    zipCode?: string | null;
    city?: string | null;
    licenseNumber?: string | null;
    isHipaaCompliant?: boolean;
    primaryBusinessType?: string | null;
    additionalBusinessTypes?: string[];
    programServices?: string[];
}

interface OrganizationFormProps {
    initialData: OrganizationData | null;
    isAdmin: boolean;
}

// Exact options from onboarding/step1
const STAFF_COUNT_OPTIONS = [
    { label: '1-10', value: '1-10' },
    { label: '11-49', value: '11-49' },
    { label: '50-499', value: '50-499' },
    { label: '500+', value: '500+' }
];

const COUNTRY_OPTIONS = [
    { label: 'United States', value: 'US' },
    { label: 'Canada', value: 'CA' },
    { label: 'United Kingdom', value: 'UK' }
];

const STATE_OPTIONS = [
    { label: 'California', value: 'CA' },
    { label: 'New York', value: 'NY' },
    { label: 'Texas', value: 'TX' }
];

// Exact options from onboarding/step2
const HIPAA_OPTIONS = [
    { label: 'Yes', value: 'yes' },
    { label: 'No', value: 'no' }
];

// Exact options from onboarding/step3
const PRIMARY_BUSINESS_TYPES = [
    { label: 'Solo / Independent Provider', value: 'solo' },
    { label: 'Group Practice', value: 'group' },
    { label: 'Clinic', value: 'clinic' },
    { label: 'Hospital', value: 'hospital' }
];

const ADDITIONAL_BUSINESS_TYPES = [
    { label: 'None', value: 'none' },
    { label: 'Non-Profit', value: 'non-profit' },
    { label: 'Private', value: 'private' },
    { label: 'Public', value: 'public' }
];

// Exact program services from onboarding/step3
const PROGRAM_SERVICES = [
    { id: 'aging', label: 'Aging Services' },
    { id: 'behavioral', label: 'Behavioral Health' },
    { id: 'child-youth', label: 'Child & Youth Services' },
    { id: 'employment', label: 'Employment & Community Services' },
    { id: 'medical-rehab', label: 'Medical Rehabilitation' },
    { id: 'opioid', label: 'Opioid Treatment Program' },
    { id: 'vision', label: 'Vision Rehabilitation Services' },
];

function OrgCodeGenerator() {
    const [code, setCode] = useState<string | null>(null);
    const [expiresAt, setExpiresAt] = useState<Date | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        loadCode();
    }, []);

    async function loadCode() {
        try {
            const result = await getOrganizationCode();
            if (result.success && result.code) {
                setCode(result.code);
                setExpiresAt(result.expiresAt ? new Date(result.expiresAt) : null);
            }
        } catch (err) {
            console.error(err);
        }
    }

    async function handleGenerate() {
        setLoading(true);
        setError(null);
        try {
            const result = await generateOrganizationCode();
            if (result.success && result.code) {
                setCode(result.code);
                setExpiresAt(result.expiresAt ? new Date(result.expiresAt) : null);
            } else {
                setError(result.error || 'Failed to generate code');
            }
        } catch (err) {
            setError('An error occurred');
        } finally {
            setLoading(false);
        }
    }

    const isExpired = expiresAt && new Date() > expiresAt;
    const timeLeft = expiresAt ? Math.max(0, Math.floor((expiresAt.getTime() - new Date().getTime()) / 60000)) : 0;
    const hoursLeft = Math.floor(timeLeft / 60);
    const minsLeft = timeLeft % 60;

    const copyToClipboard = () => {
        if (code) {
            navigator.clipboard.writeText(code);
            // Could add a toast here
        }
    };

    return (
        <div className={styles.codeGenWrapper}>
            {code ? (
                <div className={`${styles.codeDisplay} ${isExpired ? styles.expired : ''}`}>
                    <div className={styles.codeBox}>
                        <span className={styles.code}>{code}</span>
                        {!isExpired && (
                            <button type="button" onClick={copyToClipboard} className={styles.copyButton} title="Copy Code">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                </svg>
                            </button>
                        )}
                    </div>

                    <div className={styles.codeMeta}>
                        {isExpired ? (
                            <span className={styles.expiredBadge}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                                    <line x1="12" y1="9" x2="12" y2="13"></line>
                                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                                </svg> Expired
                            </span>
                        ) : (
                            <span className={styles.expiresText}>
                                Expires in {hoursLeft}h {minsLeft}m
                            </span>
                        )}

                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleGenerate}
                            disabled={loading}
                            className={styles.regenerateButton}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={loading ? styles.spinning : ''}>
                                <polyline points="23 4 23 10 17 10"></polyline>
                                <polyline points="1 20 1 14 7 14"></polyline>
                                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                            </svg>
                            {isExpired ? 'Regenerate' : 'Generate New'}
                        </Button>
                    </div>
                </div>
            ) : (
                <div className={styles.generateStart}>
                    <p className={styles.generateHelp}>
                        Generate a temporary 6-digit code for workers to join your organization.
                    </p>
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={handleGenerate}
                        loading={loading}
                    >
                        Generate Code
                    </Button>
                </div>
            )}
            {error && <p className={styles.errorText}>{error}</p>}
        </div>
    );
}

export default function OrganizationForm({ initialData, isAdmin }: OrganizationFormProps) {
    const [formData, setFormData] = useState<OrganizationData>(
        initialData || {
            id: '',
            name: '',
            dba: '',
            ein: '',
            staffCount: '',
            primaryContact: '',
            primaryEmail: '',
            phone: '',
            address: '',
            country: '',
            state: '',
            zipCode: '',
            city: '',
            licenseNumber: '',
            isHipaaCompliant: false,
            primaryBusinessType: '',
            additionalBusinessTypes: [],
            programServices: []
        }
    );
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const router = useRouter();

    useEffect(() => {
        if (initialData) {
            setFormData({
                ...initialData,
                additionalBusinessTypes: initialData.additionalBusinessTypes || [],
                programServices: initialData.programServices || []
            });
        }
    }, [initialData]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSelectChange = (name: string, value: string) => {
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleProgramServiceToggle = (serviceId: string) => {
        setFormData(prev => {
            const current = prev.programServices || [];
            if (current.includes(serviceId)) {
                return { ...prev, programServices: current.filter(s => s !== serviceId) };
            } else {
                return { ...prev, programServices: [...current, serviceId] };
            }
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isAdmin) return;

        setIsLoading(true);
        setMessage(null);

        try {
            // Get first value from additionalBusinessTypes array or empty string
            const additionalBizType = (formData.additionalBusinessTypes || [])[0] || '';

            const result = await updateOrganization({
                name: formData.name,
                dba: formData.dba || undefined,
                ein: formData.ein || undefined,
                staffCount: formData.staffCount || undefined,
                primaryContact: formData.primaryContact || undefined,
                primaryEmail: formData.primaryEmail || undefined,
                phone: formData.phone || undefined,
                address: formData.address || undefined,
                city: formData.city || undefined,
                country: formData.country || undefined,
                state: formData.state || undefined,
                zipCode: formData.zipCode || undefined,
                licenseNumber: formData.licenseNumber || undefined,
                isHipaaCompliant: formData.isHipaaCompliant,
                primaryBusinessType: formData.primaryBusinessType || undefined,
                additionalBusinessTypes: additionalBizType ? [additionalBizType] : [],
                programServices: formData.programServices || []
            });

            if (result.success) {
                setMessage({ type: 'success', text: 'Organization updated successfully' });
                router.refresh();
            } else {
                setMessage({ type: 'error', text: result.error || 'Failed to update' });
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'An error occurred' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleDiscard = () => {
        if (initialData) {
            setFormData({
                ...initialData,
                additionalBusinessTypes: initialData.additionalBusinessTypes || [],
                programServices: initialData.programServices || []
            });
        }
        setMessage(null);
    };

    if (!initialData) {
        return (
            <div className={styles.emptyState}>
                <div className={styles.emptyStateContent}>
                    <div className={styles.emptyStateIcon}>
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 21h18" />
                            <path d="M5 21V7l8-4 8 4v14" />
                            <path d="M9 10a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v11H9V10z" />
                        </svg>
                    </div>
                    <h3 className={styles.emptyStateTitle}>No Organization Found</h3>
                    <p className={styles.emptyStateText}>
                        You haven't set up an organization profile yet. Complete the onboarding process to unlock all features.
                    </p>
                    <Button onClick={() => router.push('/onboarding/step1')} style={{ marginTop: '8px' }}>
                        Complete Onboarding
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className={styles.orgForm}>
            {/* Section 1: Basic Organization Information - matches onboarding/step1 */}
            <div className={styles.section}>
                <div className={styles.sectionHeader}>
                    <span className={styles.sectionNumber}>1.</span>
                    <span>Basic Organization Information</span>
                </div>

                <div className={styles.fieldGroup}>
                    <label className={styles.label}>Legal Business Name <span className={styles.required}>*</span></label>
                    <Input
                        name="name"
                        value={formData.name || ''}
                        onChange={handleChange}
                        placeholder="e.g. Zenco Healthcare Ltd"
                        disabled={!isAdmin}
                    />
                </div>

                <div className={styles.fieldGroup}>
                    <label className={styles.label}>Doing Business As (DBA) <span className={styles.required}>*</span></label>
                    <Input
                        name="dba"
                        value={formData.dba || ''}
                        onChange={handleChange}
                        placeholder="Enter business name (if applicable)"
                        disabled={!isAdmin}
                    />
                </div>

                <div className={styles.formGrid}>
                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>Employer Identification Number (EIN) <span className={styles.optional}>(optional)</span></label>
                        <Input
                            name="ein"
                            value={formData.ein || ''}
                            onChange={handleChange}
                            placeholder="Enter your EIN (if applicable)"
                            disabled={!isAdmin}
                        />
                    </div>
                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>Number of Staff <span className={styles.required}>*</span></label>
                        <Select
                            value={formData.staffCount || ''}
                            onChange={(value) => handleSelectChange('staffCount', value)}
                            options={STAFF_COUNT_OPTIONS}
                            placeholder="Select an option"
                            disabled={!isAdmin}
                        />
                    </div>
                </div>

                <div className={styles.formGrid}>
                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>Primary Contact Name <span className={styles.required}>*</span></label>
                        <Input
                            name="primaryContact"
                            value={formData.primaryContact || ''}
                            onChange={handleChange}
                            placeholder="Enter the full name of the main contact"
                            disabled={!isAdmin}
                        />
                    </div>
                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>Primary Contact Email <span className={styles.required}>*</span></label>
                        <Input
                            name="primaryEmail"
                            value={formData.primaryEmail || ''}
                            onChange={handleChange}
                            placeholder="Enter the email address of the main contact"
                            type="email"
                            disabled={!isAdmin}
                        />
                    </div>
                </div>

                <div className={styles.formGrid}>
                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>Country <span className={styles.required}>*</span></label>
                        <Select
                            value={formData.country || ''}
                            onChange={(value) => handleSelectChange('country', value)}
                            options={COUNTRY_OPTIONS}
                            placeholder="Select an option"
                            disabled={!isAdmin}
                        />
                    </div>
                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>Phone Number <span className={styles.required}>*</span></label>
                        <Input
                            name="phone"
                            value={formData.phone || ''}
                            onChange={handleChange}
                            placeholder="Enter the phone number"
                            disabled={!isAdmin}
                        />
                    </div>
                </div>

                <div className={styles.formGrid}>
                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>Street Address <span className={styles.optional}>(optional)</span></label>
                        <Input
                            name="address"
                            value={formData.address || ''}
                            onChange={handleChange}
                            placeholder="Enter business street address"
                            disabled={!isAdmin}
                        />
                    </div>
                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>Zip Code <span className={styles.optional}>(optional)</span></label>
                        <Input
                            name="zipCode"
                            value={formData.zipCode || ''}
                            onChange={handleChange}
                            placeholder="e.g. 27601"
                            disabled={!isAdmin}
                        />
                    </div>
                </div>

                <div className={styles.formGrid}>
                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>City <span className={styles.optional}>(optional)</span></label>
                        <Input
                            name="city"
                            value={formData.city || ''}
                            onChange={handleChange}
                            placeholder="Enter city"
                            disabled={!isAdmin}
                        />
                    </div>
                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>State <span className={styles.optional}>(optional)</span></label>
                        <Select
                            value={formData.state || ''}
                            onChange={(value) => handleSelectChange('state', value)}
                            options={STATE_OPTIONS}
                            placeholder="Select an option"
                            disabled={!isAdmin}
                        />
                    </div>
                </div>
            </div>

            {/* Section 2: Credentialing & Documentation - matches onboarding/step2 */}
            <div className={styles.section}>
                <div className={styles.sectionHeader}>
                    <span className={styles.sectionNumber}>2.</span>
                    <span>Credentialing & Documentation</span>
                </div>

                <div className={styles.formGrid}>
                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>State Healthcare License Number <span className={styles.optional}>(optional)</span></label>
                        <Input
                            name="licenseNumber"
                            value={formData.licenseNumber || ''}
                            onChange={handleChange}
                            placeholder="Enter your official license number"
                            disabled={!isAdmin}
                        />
                    </div>
                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>HIPAA Compliance Confirmation <span className={styles.required}>*</span></label>
                        <Select
                            value={formData.isHipaaCompliant ? 'yes' : 'no'}
                            onChange={(value) => setFormData(prev => ({ ...prev, isHipaaCompliant: value === 'yes' }))}
                            options={HIPAA_OPTIONS}
                            placeholder="Select an option"
                            disabled={!isAdmin}
                        />
                    </div>
                </div>

                {/* Placeholder for uploaded documents - matches step2 file upload */}
                <div className={styles.fieldGroup}>
                    <label className={styles.label}>Upload your compliance certifications <span className={styles.optional}>(optional)</span></label>
                    <div className={styles.uploadedDocsList}>
                        <p className={styles.placeholder}>Document uploads will be available in a future update.</p>
                    </div>
                </div>
            </div>

            {/* Section 3: Organization Services - matches onboarding/step3 */}
            <div className={styles.section}>
                <div className={styles.sectionHeader}>
                    <span className={styles.sectionNumber}>3.</span>
                    <span>Organization Services</span>
                </div>

                <div className={styles.formGrid}>
                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>Primary Business Type <span className={styles.required}>*</span></label>
                        <Select
                            value={formData.primaryBusinessType || ''}
                            onChange={(value) => handleSelectChange('primaryBusinessType', value)}
                            options={PRIMARY_BUSINESS_TYPES}
                            placeholder="Select an option"
                            disabled={!isAdmin}
                        />
                    </div>
                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>Additional Business Type <span className={styles.required}>*</span></label>
                        <Select
                            value={(formData.additionalBusinessTypes || [])[0] || ''}
                            onChange={(value) => setFormData(prev => ({ ...prev, additionalBusinessTypes: value ? [value] : [] }))}
                            options={ADDITIONAL_BUSINESS_TYPES}
                            placeholder="Select an option"
                            disabled={!isAdmin}
                        />
                    </div>
                </div>

                <div className={styles.fieldGroup}>
                    <label className={styles.label} style={{ marginBottom: '16px', display: 'block' }}>Program Services</label>
                    <div className={styles.checkboxGrid}>
                        {PROGRAM_SERVICES.map((service) => (
                            <Checkbox
                                key={service.id}
                                label={service.label}
                                checked={(formData.programServices || []).includes(service.id)}
                                onChange={(e) => {
                                    if (isAdmin) {
                                        handleProgramServiceToggle(service.id);
                                    }
                                }}
                                disabled={!isAdmin}
                            />
                        ))}
                    </div>
                </div>
            </div>

            {/* Section: Worker Onboarding Code */}
            {isAdmin && (
                <div className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionNumber}>4.</span>
                        <span>Worker Onboarding</span>
                    </div>

                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>
                            Organization Join Code
                            <span className={styles.optional}> (Share this code with your workers)</span>
                        </label>

                        <div className={styles.codeContainer}>
                            <OrgCodeGenerator />
                        </div>
                    </div>
                </div>
            )}

            {message && (
                <div className={`${styles.message} ${styles[message.type]}`}>
                    {message.text}
                </div>
            )}

            {isAdmin && (
                <div className={styles.orgActions}>
                    <Button variant="outline" type="button" onClick={handleDiscard}>
                        Discard
                    </Button>
                    <Button variant="primary" type="submit" loading={isLoading}>
                        Save Changes
                    </Button>
                </div>
            )}
        </form>
    );
}
