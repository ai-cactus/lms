'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Logo, Input, Button } from '@/components/ui';
import { useSession } from 'next-auth/react';
import { verifyOrganizationCode, joinOrganization } from '@/app/actions/organization-code';
import styles from './page.module.css';

interface OrgDetails {
    id: string;
    name: string;
    type?: string | null;
    services: string[];
    country?: string | null;
    phone?: string | null;
    contactName?: string | null;
}

export default function WorkerOnboardingPage() {
    const router = useRouter();
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [orgDetails, setOrgDetails] = useState<OrgDetails | null>(null);

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!code || code.length !== 6) {
            setError('Please enter a valid 6-digit code');
            return;
        }

        setLoading(true);
        setError('');

        try {
            const result = await verifyOrganizationCode(code);
            if (result.success && result.organization) {
                setOrgDetails(result.organization);
            } else {
                setError(result.error || 'Invalid code');
            }
        } catch (err) {
            setError('An error occurred. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const { update } = useSession();

    const handleJoin = async () => {
        setLoading(true);
        setError('');

        try {
            const result = await joinOrganization(code);
            if (result.success) {
                // Force session update to reflect new role/org
                await update();
                router.push('/worker');
                router.refresh(); // Ensure server components refresh
            } else {
                setError(result.error || 'Failed to join organization');
            }
        } catch (err) {
            setError('An error occurred. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleDiscard = () => {
        setOrgDetails(null);
        setCode('');
        setError('');
    };

    return (
        <div className={styles.container}>
            {/* Left Side - Form */}
            <div className={styles.formSection}>
                <div className={styles.formContent}>
                    <Logo size="md" />

                    <div className={styles.formHeader}>
                        <h1 className={styles.title}>Join your Organization</h1>
                        <p className={styles.subtitle}>
                            Enter the 6-digit code provided by your administrator to join your team.
                        </p>
                    </div>

                    {!orgDetails ? (
                        <form onSubmit={handleVerify} className={styles.form}>
                            <Input
                                label="Organization Code"
                                placeholder="Enter 6-digit code"
                                value={code}
                                onChange={(e) => {
                                    // Only allow numbers
                                    const val = e.target.value.replace(/[^0-9]/g, '');
                                    if (val.length <= 6) setCode(val);
                                }}
                                error={error}
                                maxLength={6}
                                style={{ fontSize: '24px', letterSpacing: '4px', textAlign: 'center' }}
                            />

                            <Button
                                type="submit"
                                size="lg"
                                fullWidth
                                loading={loading}
                                disabled={code.length !== 6}
                            >
                                Find Organization
                            </Button>
                        </form>
                    ) : (
                        <div className={styles.card}>
                            <div className={styles.cardHeader}>
                                <div className={styles.orgIcon}>
                                    {orgDetails.name.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                    <h3 className={styles.orgName}>{orgDetails.name}</h3>
                                    <span className={styles.orgType}>{orgDetails.type || 'Healthcare Organization'}</span>
                                </div>
                            </div>

                            <div className={styles.detailsGrid}>
                                {orgDetails.contactName && (
                                    <div className={styles.detailItem}>
                                        <span className={styles.detailLabel}>Contact Person</span>
                                        <span className={styles.detailValue}>{orgDetails.contactName}</span>
                                    </div>
                                )}
                                {orgDetails.phone && (
                                    <div className={styles.detailItem}>
                                        <span className={styles.detailLabel}>Phone Number</span>
                                        <a href={`tel:${orgDetails.phone}`} className={styles.detailLink}>{orgDetails.phone}</a>
                                    </div>
                                )}
                                {orgDetails.country && (
                                    <div className={styles.detailItem}>
                                        <span className={styles.detailLabel}>Location</span>
                                        <span className={styles.detailValue}>{orgDetails.country}</span>
                                    </div>
                                )}
                            </div>

                            {orgDetails.services.length > 0 && (
                                <div className={styles.servicesSection}>
                                    <span className={styles.detailLabel}>Services Provided</span>
                                    <div className={styles.servicesList}>
                                        {orgDetails.services.map(s => (
                                            <span key={s} className={styles.serviceTag}>{s}</span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {error && <p className={styles.error}>{error}</p>}

                            <div className={styles.cardActions}>
                                <Button
                                    variant="outline"
                                    onClick={handleDiscard}
                                    fullWidth
                                    disabled={loading}
                                >
                                    Discard
                                </Button>
                                <Button
                                    onClick={handleJoin}
                                    fullWidth
                                    loading={loading}
                                >
                                    Join Organization
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Right Side - Hero Image */}
            <div className={styles.heroSection}>
                <Image
                    src="/images/login-bg.png"
                    alt="Theraptly Training"
                    fill
                    className={styles.heroImage}
                    priority
                    quality={100}
                />

                <div className={styles.heroOverlay}>
                    <div className={styles.heroTextContent}>
                        <h2 className={styles.heroTitle}>
                            Welcome to the team
                        </h2>
                        <p className={styles.heroSubtitle}>
                            Get access to your assigned training, policies, and compliance documents in one place.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
