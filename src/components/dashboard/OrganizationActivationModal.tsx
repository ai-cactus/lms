'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import styles from './OrganizationActivationModal.module.css';
import { Logo } from '@/components/ui';
// import { LayoutDashboard } from 'lucide-react'; // Placeholder icon for logo if needed

interface OrganizationActivationModalProps {
    hasOrganization: boolean;
    mode?: 'welcome' | 'feature_gate'; // 'welcome' for initial onboarding, 'controlled' for external control
    isOpen?: boolean; // For controlled mode
    onClose?: () => void; // For controlled mode
    title?: string;
    description?: string;
    actionLabel?: string;
}

export default function OrganizationActivationModal({
    hasOrganization,
    mode = 'welcome',
    isOpen: controlledIsOpen,
    onClose,
    title,
    description,
    actionLabel
}: OrganizationActivationModalProps) {
    const [internalIsOpen, setInternalIsOpen] = useState(false);
    const router = useRouter();

    const isWelcomeMode = mode === 'welcome';
    const show = isWelcomeMode ? internalIsOpen : controlledIsOpen;

    useEffect(() => {
        // If user has no organization and it's welcome mode, show the modal
        if (isWelcomeMode && !hasOrganization) {
            setInternalIsOpen(true);
        }
    }, [hasOrganization, isWelcomeMode]);

    const handleClose = () => {
        if (isWelcomeMode) {
            setInternalIsOpen(false);
        } else {
            onClose?.();
        }
    };

    if (!show) return null;

    const defaultTitle = isWelcomeMode
        ? "Welcome to Theraptly Learning Management Section"
        : "Organization Required";

    const defaultDesc = isWelcomeMode
        ? "We turn all your long & tedious compliance work into a much shorter and delightful process. Let’s get you started by creating a profile for your organization."
        : "You haven't activated and created an organization yet. Click here to start activating your account to access this feature.";

    const defaultAction = "Activate your account";

    return (
        <div className={styles.overlay}>
            <div className={styles.card}>

                {/* Content Section */}
                <div className={styles.content}>
                    <div className={styles.logoWrapper}>
                        <Logo variant="blue" size="md" />
                    </div>

                    <h2 className={styles.title}>
                        {title || defaultTitle}
                    </h2>

                    <p className={styles.description}>
                        {description || defaultDesc}
                    </p>

                    <div className={styles.actions}>
                        <button
                            onClick={() => router.push('/onboarding')}
                            className={styles.primaryButton}
                        >
                            {actionLabel || defaultAction}
                            {/* Add a notification badge if desired, per screenshot */}
                        </button>

                        <button
                            onClick={handleClose}
                            className={styles.secondaryButton}
                        >
                            Skip for now
                        </button>
                    </div>
                </div>

                {/* Visual Section - Image Right */}
                <div className={styles.imageSection}>
                    <Image
                        src="/images/onboarding-welcome.png"
                        alt="Healthcare Professional Working"
                        fill
                        className={styles.image}
                        priority
                    />
                </div>

            </div>
        </div>
    );
}
