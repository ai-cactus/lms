'use client';

import React from 'react';
import Image from 'next/image';
import styles from './layout.module.css';

// Feature data (Same as Login/Signup)
const features = [
    {
        icon: (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
            </svg>
        ),
        title: 'Policy Analyzer',
        description: 'Instantly detect non-compliant content in your policy documents with AI-powered analysis.',
    },
    {
        icon: (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 6v6l4 2" />
            </svg>
        ),
        title: 'Compliance Scoring',
        description: 'Receive a percentage-based score for easy evaluation and quick decision-making.',
    },
    {
        icon: (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7" />
                <rect x="14" y="3" width="7" height="7" />
                <rect x="14" y="14" width="7" height="7" />
                <rect x="3" y="14" width="7" height="7" />
            </svg>
        ),
        title: 'Billing & Plan Management',
        description: 'Flexible subscription options designed to fit your needs.',
    },
    {
        icon: (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
            </svg>
        ),
        title: 'Secure Cloud Storage',
        description: 'Keep all your sensitive compliance documents safe and accessible anytime, anywhere.',
    },
];

export default function OnboardingLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className={styles.container}>
            {/* Left Side Content */}
            <div className={styles.contentSection}>
                {children}
            </div>

            {/* Right Side - Hero (Reused) */}
            <div className={styles.heroSection}>
                {/* Background doodle decoration */}
                <Image
                    src="/images/bg-vectors.svg"
                    alt=""
                    fill
                    className={styles.bgDoodle}
                    priority
                />

                {/* Hero Content */}
                <div className={styles.heroContent}>
                    {/* Header */}
                    <div className={styles.heroHeader}>
                        <h2 className={styles.heroTitle}>
                            Take the Stress Out of your Compliance Today
                        </h2>
                        <p className={styles.heroSubtitle}>
                            Powerful tools to simplify, streamline and strengthen your CARF compliance processes, all in one place.
                        </p>
                    </div>

                    {/* Features Grid */}
                    <div className={styles.featuresGrid}>
                        {features.map((feature, index) => (
                            <div key={index} className={styles.featureCard}>
                                <div className={styles.featureIcon}>
                                    {feature.icon}
                                </div>
                                <h3 className={styles.featureTitle}>{feature.title}</h3>
                                <p className={styles.featureDesc}>{feature.description}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
