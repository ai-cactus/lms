'use client';

import React, { useState, useEffect } from 'react';
import styles from './ProfileForm.module.css';
import { Button, Input, Select } from '@/components/ui';
import { updateOrganization } from '@/app/actions/organization';
import { useRouter } from 'next/navigation';

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
}

interface OrganizationFormProps {
    initialData: OrganizationData | null;
    isAdmin: boolean;
}

const STAFF_COUNT_OPTIONS = [
    { label: '1-10', value: '1-10' },
    { label: '11-49', value: '11-49' },
    { label: '1-50', value: '1-50' },
    { label: '50-499', value: '50-499' },
    { label: '500+', value: '500+' }
];

const COUNTRY_OPTIONS = [
    { label: 'USA', value: 'US' },
    { label: 'Canada', value: 'CA' },
    { label: 'United Kingdom', value: 'UK' }
];

const STATE_OPTIONS = [
    { label: 'California', value: 'CA' },
    { label: 'Colorado', value: 'CO' },
    { label: 'Florida', value: 'FL' },
    { label: 'New York', value: 'NY' },
    { label: 'North Carolina', value: 'NC' },
    { label: 'Texas', value: 'TX' }
];

const CITY_OPTIONS = [
    { label: 'Denver', value: 'Denver' },
    { label: 'Los Angeles', value: 'Los Angeles' },
    { label: 'Miami', value: 'Miami' },
    { label: 'New York', value: 'New York' },
    { label: 'Raleigh', value: 'Raleigh' },
    { label: 'San Francisco', value: 'San Francisco' }
];

const HIPAA_OPTIONS = [
    { label: 'Yes', value: 'true' },
    { label: 'No', value: 'false' }
];

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
            isHipaaCompliant: false
        }
    );
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const router = useRouter();

    useEffect(() => {
        if (initialData) {
            setFormData(initialData);
        }
    }, [initialData]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSelectChange = (name: string, value: string) => {
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isAdmin) return;

        setIsLoading(true);
        setMessage(null);

        try {
            const result = await updateOrganization({
                name: formData.name,
                dba: formData.dba || undefined,
                ein: formData.ein || undefined,
                staffCount: formData.staffCount || undefined,
                primaryContact: formData.primaryContact || undefined,
                primaryEmail: formData.primaryEmail || undefined,
                phone: formData.phone || undefined,
                address: formData.address || undefined,
                country: formData.country || undefined,
                state: formData.state || undefined,
                zipCode: formData.zipCode || undefined,
                city: formData.city || undefined,
                licenseNumber: formData.licenseNumber || undefined,
                isHipaaCompliant: formData.isHipaaCompliant
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
            setFormData(initialData);
        }
        setMessage(null);
    };

    if (!initialData) {
        return (
            <div className={styles.emptyState}>
                <p>No organization found. Please complete onboarding first.</p>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className={styles.orgForm}>
            {/* Section 1: Basic Organization Information */}
            <div className={styles.section}>
                <div className={styles.sectionHeader}>
                    <span className={styles.sectionNumber}>1.</span>
                    <span>Basic Organization Information</span>
                </div>

                <div className={styles.fieldGroup}>
                    <label className={styles.label}>Legal Business Name</label>
                    <Input
                        name="name"
                        value={formData.name || ''}
                        onChange={handleChange}
                        placeholder="Enter legal business name"
                        disabled={!isAdmin}
                    />
                </div>

                <div className={styles.fieldGroup}>
                    <label className={styles.label}>Doing Business As (DBA)</label>
                    <Input
                        name="dba"
                        value={formData.dba || ''}
                        onChange={handleChange}
                        placeholder="Enter DBA if applicable"
                        disabled={!isAdmin}
                    />
                </div>

                <div className={styles.formGrid}>
                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>Employer Identification Number (EIN)</label>
                        <Input
                            name="ein"
                            value={formData.ein || ''}
                            onChange={handleChange}
                            placeholder="e.g. 47-8912564"
                            disabled={!isAdmin}
                        />
                    </div>
                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>Number of Staff</label>
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
                        <label className={styles.label}>Primary Contact Name</label>
                        <Input
                            name="primaryContact"
                            value={formData.primaryContact || ''}
                            onChange={handleChange}
                            placeholder="Enter contact name"
                            disabled={!isAdmin}
                        />
                    </div>
                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>Primary Contact Email</label>
                        <Input
                            name="primaryEmail"
                            value={formData.primaryEmail || ''}
                            onChange={handleChange}
                            placeholder="Enter contact email"
                            type="email"
                            disabled={!isAdmin}
                        />
                    </div>
                </div>

                <div className={styles.formGrid}>
                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>Country</label>
                        <Select
                            value={formData.country || ''}
                            onChange={(value) => handleSelectChange('country', value)}
                            options={COUNTRY_OPTIONS}
                            placeholder="Select an option"
                            disabled={!isAdmin}
                        />
                    </div>
                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>Phone Number</label>
                        <Input
                            name="phone"
                            value={formData.phone || ''}
                            onChange={handleChange}
                            placeholder="Enter phone number"
                            disabled={!isAdmin}
                        />
                    </div>
                </div>

                <div className={styles.formGrid}>
                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>Street Address</label>
                        <Input
                            name="address"
                            value={formData.address || ''}
                            onChange={handleChange}
                            placeholder="Enter street address"
                            disabled={!isAdmin}
                        />
                    </div>
                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>Zip Code</label>
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
                        <label className={styles.label}>City</label>
                        <Select
                            value={formData.city || ''}
                            onChange={(value) => handleSelectChange('city', value)}
                            options={CITY_OPTIONS}
                            placeholder="Select an option"
                            disabled={!isAdmin}
                        />
                    </div>
                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>State</label>
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

            {/* Section 2: Credentialing & Documentation */}
            <div className={styles.section}>
                <div className={styles.sectionHeader}>
                    <span className={styles.sectionNumber}>2.</span>
                    <span>Credentialing & Documentation</span>
                </div>

                <div className={styles.formGrid}>
                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>State Healthcare License Number</label>
                        <Input
                            name="licenseNumber"
                            value={formData.licenseNumber || ''}
                            onChange={handleChange}
                            placeholder="e.g. CO-TL-9078"
                            disabled={!isAdmin}
                        />
                    </div>
                    <div className={styles.fieldGroup}>
                        <label className={styles.label}>HIPAA Compliance Confirmation:</label>
                        <Select
                            value={formData.isHipaaCompliant ? 'true' : 'false'}
                            onChange={(value) => setFormData(prev => ({ ...prev, isHipaaCompliant: value === 'true' }))}
                            options={HIPAA_OPTIONS}
                            disabled={!isAdmin}
                        />
                    </div>
                </div>

                {/* Placeholder for uploaded documents */}
                <div className={styles.fieldGroup}>
                    <label className={styles.label}>Uploaded compliance certifications:</label>
                    <div className={styles.uploadedDocsList}>
                        <p className={styles.placeholder}>Document uploads will be displayed here when available.</p>
                    </div>
                </div>
            </div>

            {/* Section 3: Organization Services */}
            <div className={styles.section}>
                <div className={styles.sectionHeader}>
                    <span className={styles.sectionNumber}>3.</span>
                    <span>Organization Services</span>
                </div>

                <p className={styles.placeholder}>Service configuration (Primary Business Type, Additional Business Types, Program Services) will be displayed here when available.</p>
            </div>

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
